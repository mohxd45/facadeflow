/**
 * DXF Takeoff Suggestion Service — Phase 5, updated Phase 15
 *
 * Phase 15 additions:
 *  – Noise layer filtering (isNoiseLayer). Skipped unless a saved enabled
 *    mapping explicitly whitelists the layer.
 *  – Manual scale calibration: DrawingScaleCalibration overrides $INSUNITS.
 *  – Confidence downgrade when units/scale are unknown.
 *  – Suspicious quantity thresholds trigger low confidence + warning note.
 */

import type { TakeoffCategory } from "@/types/takeoff";
import type { DrawingViewType } from "@/types/drawing";
import type {
  ParsedDxfDrawing,
  CadEntity,
  CadLayerMapping,
  LayerMeasurementMode,
} from "@/types/cad";
import type { DrawingScaleCalibration } from "@/types/calibration";
import { TAKEOFF_CATEGORY_LABELS } from "@/lib/constants";
import type { TakeoffSuggestion } from "@/services/analysis/rule-based-takeoff";
import { getEntityMeasurement } from "@/services/cad/geometry-measurement.service";
import {
  getUnitLabel,
  getMetersPerDrawingUnit,
} from "@/services/cad/cad-unit-conversion.service";
import { isNoiseLayer } from "./dxf-noise-filter";

// ---------------------------------------------------------------------------
// Suspicious-quantity thresholds
// ---------------------------------------------------------------------------

const SUSPICIOUS_AREA_SQM = 10_000;     // > 10 000 sqm on one layer → flag
const SUSPICIOUS_LENGTH_LM = 10_000;    // > 10 000 lm on one layer → flag
const SUSPICIOUS_WINDOW_COUNT = 500;    // > 500 windows → flag
const SUSPICIOUS_DOOR_COUNT = 300;      // > 300 doors → flag

// ---------------------------------------------------------------------------
// Layer → category inference rules
// ---------------------------------------------------------------------------

interface LayerCategoryRule {
  test: RegExp;
  category: TakeoffCategory;
  elementName: string;
  drawingViewType: DrawingViewType;
}

/** Rules ordered most-specific → least-specific. First match wins. */
const LAYER_RULES: LayerCategoryRule[] = [
  { test: /GLASS[\s_-]*BAL/i,           category: "glass_balustrade",         elementName: "Glass balustrade",              drawingViewType: "detail"    },
  { test: /GL[\s_-]*BAL/i,              category: "glass_balustrade",         elementName: "Glass balustrade",              drawingViewType: "detail"    },
  { test: /BALUSTRAD/i,                 category: "glass_balustrade",         elementName: "Balustrade",                    drawingViewType: "detail"    },
  { test: /BALCONY[\s_-]*RAIL/i,        category: "balcony_railing",          elementName: "Balcony railing",               drawingViewType: "elevation" },
  { test: /RAILING/i,                   category: "balcony_railing",          elementName: "Balcony railing",               drawingViewType: "elevation" },
  { test: /HANDRAIL/i,                  category: "balcony_railing",          elementName: "Handrail",                      drawingViewType: "elevation" },
  { test: /BALCONY/i,                   category: "balcony_railing",          elementName: "Balcony",                       drawingViewType: "elevation" },
  { test: /ALUMIN\w*[\s_-]*COMPOSITE/i, category: "acp_cladding",             elementName: "ACP (Aluminium Composite Panel)", drawingViewType: "elevation" },
  { test: /\bACP\b/i,                   category: "acp_cladding",             elementName: "ACP cladding",                  drawingViewType: "elevation" },
  { test: /CLADDING/i,                  category: "acp_cladding",             elementName: "Cladding panel",                drawingViewType: "elevation" },
  { test: /COMPOSITE[\s_-]*PANEL/i,     category: "acp_cladding",             elementName: "Composite panel",               drawingViewType: "elevation" },
  { test: /CURTAIN[\s_-]*WALL/i,        category: "curtain_wall_glass_panel", elementName: "Curtain wall",                  drawingViewType: "elevation" },
  { test: /\bCW[\b_-]/i,                category: "curtain_wall_glass_panel", elementName: "Curtain wall",                  drawingViewType: "elevation" },
  { test: /\bCWGP\b/i,                  category: "curtain_wall_glass_panel", elementName: "Curtain wall glass panel",      drawingViewType: "elevation" },
  { test: /ALU[\w]*[\s_-]*FIN/i,        category: "aluminium_fins",           elementName: "Aluminium fin",                 drawingViewType: "elevation" },
  { test: /\bFIN(S)?\b/i,               category: "aluminium_fins",           elementName: "Aluminium fin",                 drawingViewType: "elevation" },
  { test: /CANOPY/i,                    category: "canopy",                   elementName: "Canopy",                        drawingViewType: "plan"      },
  { test: /GLASS[\s_-]*PARTITION/i,     category: "glass_partitions",         elementName: "Glass partition",               drawingViewType: "plan"      },
  { test: /PARTITION/i,                 category: "glass_partitions",         elementName: "Partition",                     drawingViewType: "plan"      },
  { test: /WINDOW/i,                    category: "windows",                  elementName: "Window",                        drawingViewType: "plan"      },
  { test: /\bWIN\b/i,                   category: "windows",                  elementName: "Window",                        drawingViewType: "plan"      },
  { test: /\bW-/i,                      category: "windows",                  elementName: "Window",                        drawingViewType: "plan"      },
  { test: /DOOR/i,                      category: "doors",                    elementName: "Door",                          drawingViewType: "plan"      },
  { test: /\bD-/i,                      category: "doors",                    elementName: "Door",                          drawingViewType: "plan"      },
  { test: /LOUV/i,                      category: "louvers",                  elementName: "Louvre",                        drawingViewType: "elevation" },
];

export function defaultUnitForCategory(
  category: TakeoffCategory | null
): "sqm" | "lm" | "nos" {
  switch (category) {
    case "acp_cladding":
    case "curtain_wall_glass_panel":
    case "canopy":
    case "glass_partitions":
      return "sqm";
    case "glass_balustrade":
    case "balcony_railing":
    case "aluminium_fins":
      return "lm";
    case "windows":
    case "doors":
    case "louvers":
      return "nos";
    default:
      return "sqm";
  }
}

export function inferTakeoffCategoryFromLayer(
  layerName: string
): { category: TakeoffCategory; elementName: string; drawingViewType: DrawingViewType } | null {
  for (const rule of LAYER_RULES) {
    if (rule.test.test(layerName)) {
      return {
        category: rule.category,
        elementName: rule.elementName,
        drawingViewType: rule.drawingViewType,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Suggestion ID counter
// ---------------------------------------------------------------------------

let _counter = 0;
function nextSuggestionId(): string {
  return `dxf-sug-${Date.now()}-${++_counter}`;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DxfSuggestionOptions {
  drawingId: string;
  projectId: string;
  existingItemCodes: string[];
  maxSuggestions?: number;
  /** If provided, saved mappings override auto-inference for matched layers */
  layerMappings?: CadLayerMapping[];
  /** If provided, overrides $INSUNITS scale for this drawing */
  calibration?: DrawingScaleCalibration;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function generateDxfTakeoffSuggestions(
  parsed: ParsedDxfDrawing,
  options: DxfSuggestionOptions
): TakeoffSuggestion[] {
  const { existingItemCodes, layerMappings = [], calibration } = options;
  const max = options.maxSuggestions ?? 50;

  let codeNum = existingItemCodes.length;
  const nextCode = () => `TKF-${String(++codeNum).padStart(3, "0")}`;

  // ── Scale resolution ──────────────────────────────────────────────────────
  // Priority: manual calibration > $INSUNITS > null (unknown)
  const calibrationScale =
    calibration && calibration.sourceUnit !== "unknown"
      ? calibration.metersPerDrawingUnit
      : null;

  const insunitsScale = getMetersPerDrawingUnit(parsed.unitsCode);
  const effectiveScale: number | null = calibrationScale ?? insunitsScale;
  const hasKnownScale = effectiveScale !== null;

  const scaleSource = calibration && calibration.sourceUnit !== "unknown"
    ? `manual calibration (${calibration.sourceUnit})`
    : `$INSUNITS=${parsed.unitsCode} (${getUnitLabel(parsed.unitsCode)})`;

  const unknownScaleNote = hasKnownScale
    ? `Converted from ${scaleSource}.`
    : "Scale not verified. Drawing units unknown — manual review required.";

  const calibrationNote = calibration && calibration.sourceUnit !== "unknown"
    ? " Used manual scale calibration."
    : "";

  // ── Saved mapping lookup ──────────────────────────────────────────────────
  const mappingByLayer = new Map<string, CadLayerMapping>(
    layerMappings.map((m) => [m.layerName, m])
  );

  // ── Group entities by layer ───────────────────────────────────────────────
  const byLayer = new Map<string, CadEntity[]>();
  for (const e of parsed.entities) {
    if (!byLayer.has(e.layer)) byLayer.set(e.layer, []);
    byLayer.get(e.layer)!.push(e);
  }

  const suggestions: TakeoffSuggestion[] = [];

  // ── Process each layer ────────────────────────────────────────────────────
  for (const [layerName, entities] of byLayer) {
    if (suggestions.length >= max) break;

    const savedMapping = mappingByLayer.get(layerName);

    // Saved mapping disabled → always skip
    if (savedMapping && !savedMapping.enabled) continue;

    // No saved mapping + noise layer → skip
    if (!savedMapping && isNoiseLayer(layerName)) continue;

    // Resolve category info
    const categoryInfo = savedMapping
      ? {
          category: savedMapping.category,
          elementName:
            TAKEOFF_CATEGORY_LABELS[savedMapping.category] ?? layerName,
          drawingViewType:
            inferTakeoffCategoryFromLayer(layerName)?.drawingViewType ??
            "elevation",
        }
      : inferTakeoffCategoryFromLayer(layerName);

    const effectiveMode: LayerMeasurementMode =
      savedMapping?.measurementMode ?? "auto";
    const mappingNote = savedMapping ? " Used saved layer mapping." : "";

    // ── Accumulate measurements ─────────────────────────────────────────────
    let totalAreaRaw = 0;
    let totalLengthRaw = 0;
    let insertCount = 0;
    let areaEntityCount = 0;
    let lengthEntityCount = 0;
    const areaSources: string[] = [];
    const lengthSources: string[] = [];

    for (const e of entities) {
      const m = getEntityMeasurement(e);
      switch (m.type) {
        case "area":
          if (
            m.value > 0 &&
            (effectiveMode === "auto" || effectiveMode === "area")
          ) {
            totalAreaRaw += m.value;
            areaEntityCount++;
            if (!areaSources.includes(m.source)) areaSources.push(m.source);
          }
          break;
        case "length":
          if (
            m.value > 0 &&
            (effectiveMode === "auto" || effectiveMode === "length")
          ) {
            totalLengthRaw += m.value;
            lengthEntityCount++;
            if (!lengthSources.includes(m.source)) lengthSources.push(m.source);
          }
          break;
        case "count":
          if (effectiveMode === "auto" || effectiveMode === "count") {
            insertCount++;
          }
          break;
      }
    }

    if (totalAreaRaw === 0 && totalLengthRaw === 0 && insertCount === 0)
      continue;

    // ── Confidence base ─────────────────────────────────────────────────────
    // saved mapping + known scale → high
    // known category OR known scale → medium
    // neither                       → low
    // unknown scale always caps at medium (except counts which don't need it)
    const knownCategory = categoryInfo !== null;
    const hasSavedMapping = savedMapping !== undefined;
    const baseConfidence =
      (hasSavedMapping || knownCategory) && hasKnownScale
        ? "high"
        : knownCategory || hasSavedMapping
        ? "medium"
        : "low";

    // ── Area suggestion ─────────────────────────────────────────────────────
    if (totalAreaRaw > 0) {
      const converted =
        effectiveScale !== null
          ? totalAreaRaw * effectiveScale * effectiveScale
          : null;
      const quantity =
        converted !== null
          ? Math.round(converted * 100) / 100
          : Math.round(totalAreaRaw * 100) / 100;

      const unit =
        savedMapping?.unit === "lm"
          ? "lm"
          : savedMapping?.unit === "nos"
          ? "nos"
          : "sqm";

      // Suspicious-quantity downgrade
      let confidenceForArea: "high" | "medium" | "low" = baseConfidence;
      let suspiciousNote = "";
      if (!hasKnownScale) {
        confidenceForArea = "low";
      }
      if (quantity > SUSPICIOUS_AREA_SQM) {
        confidenceForArea = "low";
        suspiciousNote = ` ⚠ Quantity ${quantity.toLocaleString()} sqm exceeds ${SUSPICIOUS_AREA_SQM.toLocaleString()} sqm — verify scale.`;
      }

      const sourceDesc = areaSources.join(" + ");
      const notes =
        `${areaEntityCount} ${sourceDesc}(s) on layer "${layerName}". ` +
        `Total area: ${quantity.toLocaleString()} ${unit}. ` +
        unknownScaleNote +
        calibrationNote +
        mappingNote +
        suspiciousNote;

      suggestions.push({
        suggestionId: nextSuggestionId(),
        itemCode: nextCode(),
        elementName: categoryInfo?.elementName ?? layerName,
        category: categoryInfo?.category ?? "acp_cladding",
        drawingViewType: categoryInfo?.drawingViewType ?? "elevation",
        locationFloor: "",
        quantity,
        unit,
        confidence: confidenceForArea,
        notes,
        matchedText: `Layer: ${layerName}`,
        pageNumber: 0,
      });
    }

    // ── Length suggestion ───────────────────────────────────────────────────
    if (totalLengthRaw > 0) {
      const converted =
        effectiveScale !== null
          ? totalLengthRaw * effectiveScale
          : null;
      const quantity =
        converted !== null
          ? Math.round(converted * 100) / 100
          : Math.round(totalLengthRaw * 100) / 100;

      const unit =
        savedMapping?.unit === "sqm"
          ? "sqm"
          : savedMapping?.unit === "nos"
          ? "nos"
          : "lm";

      let confidenceForLength: "high" | "medium" | "low" = baseConfidence;
      let suspiciousNote = "";
      if (!hasKnownScale) {
        confidenceForLength = "low";
      }
      if (quantity > SUSPICIOUS_LENGTH_LM) {
        confidenceForLength = "low";
        suspiciousNote = ` ⚠ Quantity ${quantity.toLocaleString()} lm exceeds ${SUSPICIOUS_LENGTH_LM.toLocaleString()} lm — verify scale.`;
      }

      const sourceDesc = lengthSources.join(" + ");
      const notes =
        `${lengthEntityCount} ${sourceDesc}(s) on layer "${layerName}". ` +
        `Total length: ${quantity.toLocaleString()} ${unit}. ` +
        unknownScaleNote +
        calibrationNote +
        mappingNote +
        suspiciousNote;

      suggestions.push({
        suggestionId: nextSuggestionId(),
        itemCode: nextCode(),
        elementName: categoryInfo?.elementName ?? layerName,
        category: categoryInfo?.category ?? "acp_cladding",
        drawingViewType: categoryInfo?.drawingViewType ?? "elevation",
        locationFloor: "",
        quantity,
        unit,
        confidence: confidenceForLength,
        notes,
        matchedText: `Layer: ${layerName}`,
        pageNumber: 0,
      });
    }

    // ── Count suggestion (INSERT) ───────────────────────────────────────────
    if (insertCount > 0) {
      // Counts don't need scale — confidence only depends on category knowledge
      let confidenceForCount: "high" | "medium" | "low" =
        knownCategory || hasSavedMapping ? "high" : "medium";

      let suspiciousNote = "";
      const isWindows = categoryInfo?.category === "windows";
      const isDoors = categoryInfo?.category === "doors";
      if (isWindows && insertCount > SUSPICIOUS_WINDOW_COUNT) {
        confidenceForCount = "low";
        suspiciousNote = ` ⚠ Count ${insertCount} exceeds ${SUSPICIOUS_WINDOW_COUNT} — verify layer.`;
      } else if (isDoors && insertCount > SUSPICIOUS_DOOR_COUNT) {
        confidenceForCount = "low";
        suspiciousNote = ` ⚠ Count ${insertCount} exceeds ${SUSPICIOUS_DOOR_COUNT} — verify layer.`;
      }

      const notes =
        `${insertCount} block reference(s) (INSERT) on layer "${layerName}". ` +
        `Units not applicable for count.` +
        calibrationNote +
        mappingNote +
        suspiciousNote;

      suggestions.push({
        suggestionId: nextSuggestionId(),
        itemCode: nextCode(),
        elementName: categoryInfo?.elementName ?? layerName,
        category: categoryInfo?.category ?? "windows",
        drawingViewType: categoryInfo?.drawingViewType ?? "plan",
        locationFloor: "",
        quantity: insertCount,
        unit: "nos",
        confidence: confidenceForCount,
        notes,
        matchedText: `Layer: ${layerName}`,
        pageNumber: 0,
      });
    }

    if (suggestions.length >= max) break;
  }

  // Sort: high → medium → low
  const ORDER = { high: 0, medium: 1, low: 2, manual: 3 };
  suggestions.sort(
    (a, b) =>
      (ORDER[a.confidence as keyof typeof ORDER] ?? 3) -
      (ORDER[b.confidence as keyof typeof ORDER] ?? 3)
  );

  return suggestions;
}
