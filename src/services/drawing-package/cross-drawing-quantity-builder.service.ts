/**
 * Cross-Drawing Quantity Builder — Phase 4C
 *
 * Phase 4C adds source-aware per-field value selection:
 *   • Each field (count, width, height, thickness, length, area …) is resolved
 *     independently using a drawing-type priority table.
 *   • Conflicting values across sources are detected and surfaced as warnings
 *     rather than silently choosing one.
 *   • Drawing-type-aware reasoning explains which drawing provided each field.
 *   • possibleValues arrays track all candidates for debug/display.
 *
 * Safety rules (unchanged from Phase 4A):
 *   • Values are never invented.
 *   • OCR-sourced evidence never elevates to high confidence.
 *   • Generic codes (W, SD, CW …) stay needs_verification.
 *   • totalArea only when width + height + count are all explicitly present.
 *   • Estimator approval required before any candidate becomes final.
 */

import { v4 as uuidv4 } from "uuid";
import type {
  CrossDrawingBuildInput,
  CrossDrawingBuildResult,
  CrossDrawingBuildStats,
  CrossDrawingBuildSummary,
  CrossDrawingQuantityCandidate,
  CrossDrawingSourceType,
  CrossDrawingValueSource,
  ClassifiedDrawingRef,
  EvidenceItemRef,
  TakeoffCandidateRef,
} from "@/types/cross-drawing-quantity";

const SUSPICIOUS_DIMENSION_M = 20;
const SUSPICIOUS_LOW_CONF_AREA_SQM = 50;
const SUSPICIOUS_CATEGORY_TOKENS = ["window", "door", "curtain_wall", "glass_panel"];
const WEAK_TEXT_SOURCE_TYPES = new Set<CrossDrawingSourceType>([
  "ocr_text",
  "pdf_text",
  "package_evidence",
  "unknown",
]);
export const SUSPICIOUS_DIMENSION_WARNING_TEXT =
  "Suspicious dimension detected. This may be a grid/drawing dimension, not the item size. Verify from schedule/detail before pricing.";

// ---------------------------------------------------------------------------
// Code normalisation helpers (unchanged)
// ---------------------------------------------------------------------------

/**
 * Normalise an item code to the canonical hyphenated-zero-padded form:
 *   W01 → W-01   W1 → W-01   WIN01 → WIN-01   CW5 → CW-05   SD1 → SD-01
 */
export function normalizeItemCode(code: string): string {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return trimmed;
  const match = trimmed.match(/^([A-Z]{1,5}(?:\/[A-Z]+)?)-?(\d{1,3})$/);
  if (!match) return trimmed;
  const prefix = match[1];
  const digits = match[2].padStart(2, "0");
  return `${prefix}-${digits}`;
}

/**
 * Returns true for bare generic prefixes that have no item number:
 * "W", "SD", "CW", "D", "WIN", "V", "KP" etc.
 */
export function isGenericCode(code: string): boolean {
  const upper = code.trim().toUpperCase();
  if (!upper) return false;
  if (/-\d/.test(upper)) return false;
  return /^[A-Z]+(?:\/[A-Z]+)?$/.test(upper);
}

// ---------------------------------------------------------------------------
// Source-role priority table  — Phase 4C
// ---------------------------------------------------------------------------

/**
 * Priority scores for each (field, sourceType) pair.
 * Higher = preferred when multiple sources provide the same field.
 *
 * Design principles:
 *  • Schedule is the gold standard for dimensions (W × H) and item size.
 *  • Plan is best for counting items in-situ.
 *  • Section/detail owns thickness, depth, glass spec.
 *  • CAD/DXF is authoritative for measured length and area.
 *  • OCR gets a floor of 2 — usable but never top pick.
 */
const SOURCE_PRIORITY: Record<string, Record<CrossDrawingSourceType, number>> = {
  count: {
    schedule: 10, plan: 8, elevation: 5, detail: 4, section: 4,
    pdf_text: 3, package_evidence: 3, ocr_text: 2, unknown: 1,
    manual: 9, dxf: 6, cad: 6,
  },
  width: {
    schedule: 10, elevation: 8, detail: 7, section: 6,
    pdf_text: 4, plan: 3, package_evidence: 3, ocr_text: 2, unknown: 1,
    manual: 9, dxf: 7, cad: 7,
  },
  height: {
    schedule: 10, elevation: 8, detail: 7, section: 6,
    pdf_text: 4, plan: 3, package_evidence: 3, ocr_text: 2, unknown: 1,
    manual: 9, dxf: 7, cad: 7,
  },
  thickness: {
    section: 10, detail: 10, schedule: 7, pdf_text: 4,
    elevation: 3, plan: 2, package_evidence: 3, ocr_text: 2, unknown: 1,
    manual: 9, dxf: 8, cad: 8,
  },
  depthOrProjection: {
    section: 10, detail: 10, schedule: 7, elevation: 5,
    pdf_text: 4, plan: 2, package_evidence: 3, ocr_text: 2, unknown: 1,
    manual: 9, dxf: 8, cad: 8,
  },
  length: {
    dxf: 10, cad: 10, plan: 8, elevation: 6,
    pdf_text: 4, schedule: 4, detail: 4, section: 4,
    package_evidence: 3, ocr_text: 2, unknown: 1, manual: 9,
  },
  area: {
    dxf: 10, cad: 10, elevation: 8, schedule: 6,
    pdf_text: 4, plan: 4, detail: 4, section: 4,
    package_evidence: 3, ocr_text: 2, unknown: 1, manual: 9,
  },
  material: {
    schedule: 10, detail: 8, section: 8, pdf_text: 5,
    elevation: 3, plan: 2, package_evidence: 3, ocr_text: 2, unknown: 1,
    manual: 9, dxf: 4, cad: 4,
  },
  glassType: {
    schedule: 10, detail: 10, section: 9, pdf_text: 5,
    elevation: 3, plan: 2, package_evidence: 3, ocr_text: 2, unknown: 1,
    manual: 9, dxf: 4, cad: 4,
  },
  frameType: {
    schedule: 10, detail: 10, section: 9, pdf_text: 5,
    elevation: 3, plan: 2, package_evidence: 3, ocr_text: 2, unknown: 1,
    manual: 9, dxf: 4, cad: 4,
  },
};

/**
 * Returns the priority score for a given (field, sourceType) pair.
 * Returns 1 (minimum) for any unrecognised combination.
 */
export function getSourceRolePriorityForField(
  field: string,
  sourceType: CrossDrawingSourceType
): number {
  return SOURCE_PRIORITY[field]?.[sourceType] ?? 1;
}

// ---------------------------------------------------------------------------
// Required-fields helper (unchanged)
// ---------------------------------------------------------------------------

export function getRequiredFieldsForUnit(
  unit: string,
  category: string
): string[] {
  const u = unit.toLowerCase();
  const c = category.toLowerCase();

  const areaCategories = [
    "windows", "doors", "curtain_wall_glass_panel", "canopy",
    "acp_cladding", "screen", "louvers", "glass_partitions",
  ];
  if (u === "sqm" || areaCategories.some((ac) => c.includes(ac.split("_")[0]))) {
    return ["width", "height", "count"];
  }
  if (u === "lm") return ["length"];
  if (u === "nos" || u === "set") return ["count"];
  return ["count"];
}

// ---------------------------------------------------------------------------
// Quantity calculation (safe — unchanged)
// ---------------------------------------------------------------------------

export function calculateQuantity(
  candidate: CrossDrawingQuantityCandidate
): CrossDrawingQuantityCandidate {
  const result = { ...candidate };
  const unit = (candidate.unit ?? "").toLowerCase();

  if (unit === "sqm") {
    if (
      typeof candidate.width === "number" &&
      typeof candidate.height === "number"
    ) {
      result.areaEach = parseFloat((candidate.width * candidate.height).toFixed(4));
      if (typeof candidate.count === "number" && candidate.count > 0) {
        result.totalArea = parseFloat(
          (result.areaEach * candidate.count).toFixed(4)
        );
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Confidence scoring (updated for Phase 4C conflict awareness)
// ---------------------------------------------------------------------------

export function scoreCrossDrawingConfidence(
  candidate: CrossDrawingQuantityCandidate
): "low" | "medium" | "high" {
  const required = getRequiredFieldsForUnit(candidate.unit, candidate.category);
  const missingRequired = required.filter((f) => {
    const v = candidate[f as keyof CrossDrawingQuantityCandidate];
    return v === undefined || v === null;
  });

  if (isGenericCode(candidate.itemCode) || isGenericCode(candidate.normalizedItemCode)) {
    return "low";
  }
  if (missingRequired.length > 0) return "low";

  // Any conflict warning → cap at low
  const hasConflict = candidate.warnings.some((w) =>
    w.toLowerCase().includes("conflict") || w.toLowerCase().includes("multiple possible")
  );
  if (hasConflict) return "low";

  const sourcesAreOcrOnly = isOcrOnlyCandidate(candidate);
  const onlyOneDrawing = candidate.sourceDrawingIds.length <= 1;

  const baseConfidence: "low" | "medium" | "high" = sourcesAreOcrOnly
    ? "medium"
    : onlyOneDrawing
      ? "medium"
      : "high";

  if (candidateHasSuspiciousDimensionSignals(candidate, baseConfidence)) {
    return "low";
  }
  return baseConfidence;
}

function isOcrOnlyCandidate(c: CrossDrawingQuantityCandidate): boolean {
  const sources: Array<CrossDrawingValueSource | undefined> = [
    c.countSource, c.widthSource, c.heightSource, c.thicknessSource,
    c.lengthSource, c.areaSource, c.materialSource, c.glassTypeSource, c.frameTypeSource,
  ];
  const defined = sources.filter(Boolean) as CrossDrawingValueSource[];
  if (defined.length === 0) return false;
  return defined.every((s) => s.sourceType === "ocr_text");
}

function isFacadeDimensionCategory(category: string): boolean {
  const normalized = category.toLowerCase();
  return SUSPICIOUS_CATEGORY_TOKENS.some((token) => normalized.includes(token));
}

function isWeakTextValueSource(src?: CrossDrawingValueSource): boolean {
  if (!src) return false;
  return WEAK_TEXT_SOURCE_TYPES.has(src.sourceType) && src.confidence === "low";
}

export function candidateHasSuspiciousDimensionSignals(
  c: CrossDrawingQuantityCandidate,
  confidenceForAreaThreshold: "low" | "medium" | "high" = c.confidence
): boolean {
  if (!isFacadeDimensionCategory(c.category)) return false;

  const oversizedDimension =
    (typeof c.width === "number" && c.width >= SUSPICIOUS_DIMENSION_M) ||
    (typeof c.height === "number" && c.height >= SUSPICIOUS_DIMENSION_M);

  const largeLowConfidenceArea =
    typeof c.areaEach === "number" &&
    c.areaEach >= SUSPICIOUS_LOW_CONF_AREA_SQM &&
    confidenceForAreaThreshold === "low";

  const weakTextSignal =
    (typeof c.width === "number" && isWeakTextValueSource(c.widthSource)) ||
    (typeof c.height === "number" && isWeakTextValueSource(c.heightSource)) ||
    (typeof c.areaEach === "number" && isWeakTextValueSource(c.areaSource));

  return oversizedDimension || largeLowConfidenceArea || weakTextSignal;
}

// ---------------------------------------------------------------------------
// Value-source builder (unchanged)
// ---------------------------------------------------------------------------

export function createValueSourceFromEvidence(
  candidate: TakeoffCandidateRef,
  evidence: EvidenceItemRef,
  classifiedDrawing: ClassifiedDrawingRef | undefined
): CrossDrawingValueSource {
  const rawSrc = (candidate.sourceType ?? evidence.textSource ?? "unknown") as string;
  const sourceType = mapLegacySourceType(rawSrc, evidence.drawingType as string);

  let confidence: "low" | "medium" | "high" = candidate.confidence ?? "low";
  if (sourceType === "ocr_text" && confidence === "high") {
    confidence = "medium";
  }

  return {
    drawingId: evidence.drawingId,
    drawingName: evidence.drawingName,
    drawingType: classifiedDrawing?.drawingType ?? evidence.drawingType,
    pageNumber: candidate.sourcePage,
    sourceType,
    evidenceId: candidate._tempId,
    rawText: candidate.rawSnippet ?? undefined,
    confidence,
  };
}

function mapLegacySourceType(
  src: string,
  drawingType: string
): CrossDrawingValueSource["sourceType"] {
  switch (src) {
    case "ocr_text":       return "ocr_text";
    case "drawing_schedule": return "schedule";
    case "dxf_geometry":   return "dxf";
    case "manual_verify":  return "manual";
    case "drawing_annotation":
    case "pdf_text":
      switch (drawingType) {
        case "elevation":        return "elevation";
        case "section":          return "section";
        case "detail":
        case "balustrade_detail":return "detail";
        case "schedule":         return "schedule";
        case "plan":             return "plan";
        case "cad_dxf":          return "dxf";
        default:                 return "pdf_text";
      }
    default: return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Phase 4C — Per-field source-aware value resolution
// ---------------------------------------------------------------------------

type EntryGroup = Array<{
  candidate: TakeoffCandidateRef;
  evidence:  EvidenceItemRef;
  classified:ClassifiedDrawingRef | undefined;
}>;

/**
 * Compute the CrossDrawingSourceType for an entry (needed for priority lookup).
 */
function sourceTypeForEntry(entry: EntryGroup[0]): CrossDrawingSourceType {
  const rawSrc = (entry.candidate.sourceType ?? entry.evidence.textSource ?? "unknown") as string;
  return mapLegacySourceType(rawSrc, entry.evidence.drawingType as string);
}

/**
 * For a numeric field, collect all values present across the entry group.
 * Returns them sorted ascending by value.
 */
function gatherNumericValues(
  field: "width" | "height" | "count" | "length" | "areaEach" | "thickness",
  entries: EntryGroup
): Array<{ value: number; entry: EntryGroup[0] }> {
  const results: Array<{ value: number; entry: EntryGroup[0] }> = [];
  for (const e of entries) {
    const v = e.candidate[field];
    if (typeof v === "number") {
      results.push({ value: v, entry: e });
    }
  }
  results.sort((a, b) => a.value - b.value);
  return results;
}

/**
 * Detect a conflict among numeric values:
 *  • count: any two values differ → conflict
 *  • dimensions: max/min ratio > 1.5 → conflict
 *  • area/length: max/min ratio > 2.0 → conflict
 */
function detectNumericConflict(
  field: string,
  values: number[]
): boolean {
  if (values.length < 2) return false;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === 0) return max !== 0;
  if (field === "count") return min !== max;
  if (field === "width" || field === "height") return max / min > 1.5;
  return max / min > 2.0;
}

function hasExplicitCodeAndDimension(rawText: string | undefined, itemCode: string): boolean {
  if (!rawText || !itemCode) return false;
  const upper = rawText.toUpperCase();
  const normalizedCode = normalizeItemCode(itemCode);
  const hasCode = upper.includes(normalizedCode) || upper.includes(itemCode.toUpperCase());
  const hasDims = /(\d+(?:\.\d+)?)\s*(?:x|×)\s*(\d+(?:\.\d+)?)/i.test(rawText);
  return hasCode && hasDims;
}

function hasCadObjectReference(rawText: string | undefined): boolean {
  if (!rawText) return false;
  return /(obj(?:ect)?[_\s-]*ref|entity|handle|block)\s*[:=#]/i.test(rawText);
}

function isWeakTextDimensionSource(sourceType: CrossDrawingSourceType): boolean {
  return (
    sourceType === "pdf_text" ||
    sourceType === "ocr_text" ||
    sourceType === "plan" ||
    sourceType === "elevation" ||
    sourceType === "section" ||
    sourceType === "detail" ||
    sourceType === "package_evidence" ||
    sourceType === "unknown"
  );
}

function isUnsafeDimensionEntry(
  field: "width" | "height",
  value: number,
  entry: EntryGroup[0],
  itemCode: string
): { unsafe: boolean; reason?: string } {
  const sourceType = sourceTypeForEntry(entry);
  const isScheduleLike = entry.evidence.drawingType === "schedule" || sourceType === "manual";
  const rawText = entry.candidate.rawSnippet ?? "";
  const explicitCodeAndDim = hasExplicitCodeAndDimension(rawText, itemCode);
  const strongNearbyEvidence =
    explicitCodeAndDim &&
    entry.candidate.confidence === "high" &&
    (entry.candidate.linkedEvidenceIds?.length ?? 0) > 0;
  const cadReliable = (sourceType === "dxf" || sourceType === "cad") && hasCadObjectReference(rawText);

  // Schedule/table-like and reliably referenced CAD dimensions are accepted.
  if (isScheduleLike || cadReliable) return { unsafe: false };

  // Weak text sources are unsafe by default unless explicit strong evidence exists.
  if (isWeakTextDimensionSource(sourceType) && !explicitCodeAndDim && !strongNearbyEvidence) {
    return {
      unsafe: true,
      reason:
        `${field}=${value} rejected from weak text source (${sourceType}) without explicit code+dimension evidence.`,
    };
  }

  // Hard safety guard for facade dimensions likely caused by grid/scale noise.
  if (value >= SUSPICIOUS_DIMENSION_M && !isScheduleLike && !cadReliable) {
    return {
      unsafe: true,
      reason: `${field}=${value} rejected as suspicious large text-derived dimension.`,
    };
  }

  return { unsafe: false };
}

interface FieldResolution {
  value: number | undefined;
  source: CrossDrawingValueSource | undefined;
  possible: number[];
  hasConflict: boolean;
  reasoning: string[];
  warnings: string[];
}

/**
 * Resolve the best value for a single numeric field across all entries.
 *
 * 1. Gather all available values.
 * 2. Detect conflicts (diverging sources).
 * 3. Sort by source role priority; pick the highest-priority non-suspicious value.
 * 4. Emit rich reasoning and conflict warnings.
 */
function resolveFieldWithPriority(
  field: "width" | "height" | "count" | "length" | "areaEach" | "thickness",
  entries: EntryGroup,
  itemCode: string
): FieldResolution {
  const gathered = gatherNumericValues(field, entries);
  const warnings: string[] = [];
  const filteredGathered =
    field === "width" || field === "height"
      ? gathered.filter((g) => {
          const safety = isUnsafeDimensionEntry(field, g.value, g.entry, itemCode);
          if (safety.unsafe) {
            const pairedDims =
              typeof g.entry.candidate.width === "number" && typeof g.entry.candidate.height === "number"
                ? `${g.entry.candidate.width} x ${g.entry.candidate.height}`
                : String(g.value);
            warnings.push(
              `Suspicious dimension ignored: ${pairedDims}. ${safety.reason ?? "Unsafe dimension source."}`
            );
            return false;
          }
          return true;
        })
      : gathered;
  const possible = [...new Set(filteredGathered.map((g) => g.value))];

  if (filteredGathered.length === 0) {
    if (gathered.length > 0 && (field === "width" || field === "height")) {
      warnings.push(`All ${field} values were rejected by strict safety filtering.`);
    }
    return { value: undefined, source: undefined, possible: [], hasConflict: false, reasoning: [], warnings };
  }

  const hasConflict = detectNumericConflict(field, possible);
  const reasoning: string[] = [];

  if (hasConflict) {
    warnings.push(
      `Multiple possible ${field}s found for ${itemCode}: ${possible.join(", ")} — verify manually.`
    );
    // Do not auto-select; leave value undefined so it goes to missingFields
    return { value: undefined, source: undefined, possible, hasConflict: true, reasoning, warnings };
  }

  // Sort by: (1) source priority desc, (2) non-OCR first, (3) confidence desc
  const sorted = [...filteredGathered].sort((a, b) => {
    const aSrc = sourceTypeForEntry(a.entry);
    const bSrc = sourceTypeForEntry(b.entry);
    const aPri = getSourceRolePriorityForField(field, aSrc);
    const bPri = getSourceRolePriorityForField(field, bSrc);
    if (bPri !== aPri) return bPri - aPri;
    // Non-OCR preferred
    const aOcr = aSrc === "ocr_text" ? 1 : 0;
    const bOcr = bSrc === "ocr_text" ? 1 : 0;
    if (aOcr !== bOcr) return aOcr - bOcr;
    // Higher confidence preferred
    const confRank = { high: 3, medium: 2, low: 1 };
    return (confRank[b.entry.candidate.confidence] ?? 1) - (confRank[a.entry.candidate.confidence] ?? 1);
  });

  const best = sorted[0];
  const bestSrcType = sourceTypeForEntry(best.entry);
  const source = createValueSourceFromEvidence(
    best.entry.candidate,
    best.entry.evidence,
    best.entry.classified
  );

  // Suspicious dimension warning (≥ 20 m for width/height of a single element)
  if ((field === "width" || field === "height") && best.value >= 20) {
    warnings.push(
      `${field} ${best.value} m for ${itemCode} is unusually large — verify measurement.`
    );
  }

  // OCR note
  if (bestSrcType === "ocr_text") {
    warnings.push(`${field} for ${itemCode} is OCR-derived — verify manually.`);
  }

  // Reasoning line
  const drawingLabel = drawingTypePretty(bestSrcType, best.entry.evidence.drawingType);
  reasoning.push(
    `${capitalize(field)} ${best.value} selected from ${drawingLabel} (${best.entry.evidence.drawingName}).`
  );

  return { value: best.value, source, possible, hasConflict: false, reasoning, warnings };
}

// ---------------------------------------------------------------------------
// Drawing-type reasoning helpers
// ---------------------------------------------------------------------------

function drawingTypePretty(sourceType: CrossDrawingSourceType, rawDrawingType: string): string {
  const labels: Partial<Record<CrossDrawingSourceType, string>> = {
    plan: "floor plan", schedule: "schedule sheet", elevation: "elevation drawing",
    section: "section drawing", detail: "detail drawing", dxf: "CAD/DXF",
    cad: "CAD model", ocr_text: "OCR scan", pdf_text: "PDF text",
    manual: "manual entry", package_evidence: "package evidence",
  };
  return labels[sourceType] ?? rawDrawingType ?? sourceType;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Produce drawing-type-aware reasoning about a plan-source occurrence count. */
function planOccurrenceReasoning(occurrenceCount: number, itemCode: string): string {
  return (
    `Item ${itemCode} appears ${occurrenceCount} time(s) in plan evidence. ` +
    "Count requires estimator verification — floor plan labels may not equal installed quantity."
  );
}

/** Elevation confirmation note. */
function elevationConfirmationNote(itemCode: string, hasUsableDims: boolean): string {
  return hasUsableDims
    ? `Elevation drawing confirms presence of ${itemCode} with readable dimensions.`
    : `Elevation confirms item presence for ${itemCode} but size source is unclear.`;
}

// ---------------------------------------------------------------------------
// Grouping key
// ---------------------------------------------------------------------------

function groupKey(normalized: string, category: string, unit: string): string {
  return `${normalized}|${category.toLowerCase()}|${unit.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Main builder function — Phase 4C
// ---------------------------------------------------------------------------

export function buildCrossDrawingQuantities(
  input: CrossDrawingBuildInput
): CrossDrawingBuildResult {
  const now = new Date().toISOString();
  const buildWarnings: string[] = [];

  const classifiedByDrawingId = new Map<string, ClassifiedDrawingRef>(
    input.classifiedDrawings.map((cd) => [cd.drawingId, cd])
  );

  // Collect all candidates
  const allEntries: EntryGroup = [];

  for (const ev of input.evidenceItems) {
    const classified = classifiedByDrawingId.get(ev.drawingId);
    for (const cand of ev.candidates) {
      allEntries.push({ candidate: cand, evidence: ev, classified });
    }
  }

  // Fold in orphan drawingTakeoffCandidates not already in evidenceItems
  const evidenceCandidateIds = new Set(allEntries.map((a) => a.candidate._tempId));
  for (const cand of input.drawingTakeoffCandidates) {
    if (evidenceCandidateIds.has(cand._tempId)) continue;
    const matchingEv = input.evidenceItems.find((ev) => ev.drawingId === cand.drawingId);
    if (matchingEv) {
      allEntries.push({
        candidate: cand,
        evidence: matchingEv,
        classified: classifiedByDrawingId.get(matchingEv.drawingId),
      });
    }
  }

  // Group by (normalizedItemCode + category + unit)
  const groups = new Map<string, EntryGroup>();
  for (const entry of allEntries) {
    if (!entry.candidate.itemCode?.trim()) continue;
    const normalized = normalizeItemCode(entry.candidate.itemCode);
    const key = groupKey(normalized, entry.candidate.category, entry.candidate.unit);
    const existing = groups.get(key);
    if (existing) existing.push(entry);
    else groups.set(key, [entry]);
  }

  const crossCandidates: CrossDrawingQuantityCandidate[] = [];

  for (const [, entries] of groups.entries()) {
    const { candidate: firstCand } = entries[0];
    const normalized = normalizeItemCode(firstCand.itemCode!);
    const reasoning: string[] = [];
    const warningsLocal: string[] = [];
    let hasAnyConflict = false;

    // ── Linkage aggregation ──────────────────────────────────────────────────
    const linkedEvidenceIds = unique(
      entries.flatMap((e) => [e.candidate._tempId, ...(e.candidate.linkedEvidenceIds ?? [])])
    );
    const sourceDrawingIds   = unique(entries.map((e) => e.evidence.drawingId));
    const sourceDrawingNames = unique(entries.map((e) => e.evidence.drawingName));
    const sourcePages = unique(
      entries.map((e) => e.candidate.sourcePage).filter((p): p is number => typeof p === "number")
    );
    const rawOccurrence = entries.reduce((acc, e) => acc + (e.candidate.occurrenceCount ?? 1), 0);

    reasoning.push(
      `Grouped ${entries.length} evidence item(s) under ${normalized} across ` +
      `${sourceDrawingIds.length} drawing(s).`
    );

    // ── Use best description from highest-scored entry ───────────────────────
    const bestDescEntry = pickBestOverallEntry(entries);

    // ── Generic-code guard ───────────────────────────────────────────────────
    const generic = isGenericCode(firstCand.itemCode!);
    if (generic) {
      warningsLocal.push(
        `Generic item code "${firstCand.itemCode}" — assign a specific numbered code before finalising.`
      );
      reasoning.push(
        `Generic/unnumbered code detected. Status forced to needs_verification. ` +
        `Do not merge generic ${firstCand.itemCode} with numbered variants.`
      );
    }

    // ── Detect drawing types contributing to this group ──────────────────────
    const drawingTypesPresent = unique(
      entries.map((e) => (e.classified?.drawingType ?? e.evidence.drawingType) as string)
    );
    const hasPlan     = drawingTypesPresent.some((t) => t === "plan");
    const hasSchedule = drawingTypesPresent.some((t) => t === "schedule");
    const hasElevation= drawingTypesPresent.some((t) => t === "elevation");
    const hasSection  = drawingTypesPresent.some((t) => t === "section");
    const hasDetail   = drawingTypesPresent.some((t) => t === "detail" || t === "balustrade_detail");

    // ── Per-field resolution (Phase 4C) ──────────────────────────────────────

    const widthRes     = resolveFieldWithPriority("width",     entries, normalized);
    const heightRes    = resolveFieldWithPriority("height",    entries, normalized);
    const countRes     = resolveFieldWithPriority("count",     entries, normalized);
    const lengthRes    = resolveFieldWithPriority("length",    entries, normalized);
    const thicknessRes = resolveFieldWithPriority("thickness", entries, normalized);

    // Collect conflicts
    for (const res of [widthRes, heightRes, countRes, lengthRes, thicknessRes]) {
      if (res.hasConflict) hasAnyConflict = true;
      warningsLocal.push(...res.warnings);
      reasoning.push(...res.reasoning);
    }

    // ── Plan-specific count reasoning ────────────────────────────────────────
    if (hasPlan && countRes.value === undefined && !countRes.hasConflict) {
      reasoning.push(planOccurrenceReasoning(rawOccurrence, normalized));
    }
    if (hasSchedule && countRes.value !== undefined) {
      reasoning.push(`Count sourced from schedule — most reliable for this item type.`);
    }

    // ── Elevation confirmation ───────────────────────────────────────────────
    if (hasElevation) {
      const elevationHasDims = widthRes.value !== undefined || heightRes.value !== undefined;
      reasoning.push(elevationConfirmationNote(normalized, elevationHasDims));
    }

    // ── Section / detail note ────────────────────────────────────────────────
    if ((hasSection || hasDetail) && thicknessRes.value !== undefined) {
      reasoning.push(
        `Thickness/depth sourced from section or detail drawing — preferred for profile specification.`
      );
    }

    // ── OCR carry-through warnings ───────────────────────────────────────────
    for (const e of entries) {
      for (const w of e.candidate.warnings ?? []) {
        if (!warningsLocal.includes(w)) warningsLocal.push(w);
      }
    }

    // ── Total calculation reasoning ──────────────────────────────────────────
    const hasCount  = countRes.value !== undefined;
    const hasWidth  = widthRes.value !== undefined;
    const hasHeight = heightRes.value !== undefined;
    const unit = bestDescEntry.candidate.unit?.toLowerCase() ?? "";

    if (unit === "sqm" && (!hasWidth || !hasHeight || !hasCount)) {
      const missing = [
        !hasWidth  && "width",
        !hasHeight && "height",
        !hasCount  && "count",
      ].filter(Boolean).join(", ");
      reasoning.push(`Total not calculated — missing: ${missing}.`);
    }

    // ── Build candidate ──────────────────────────────────────────────────────
    let candidate: CrossDrawingQuantityCandidate = {
      id: uuidv4(),
      projectId: input.projectId,
      itemCode: firstCand.itemCode!,
      normalizedItemCode: normalized,
      description: bestDescEntry.candidate.description,
      category: bestDescEntry.candidate.category,
      unit: bestDescEntry.candidate.unit,
      count:     countRes.value,
      width:     widthRes.value,
      height:    heightRes.value,
      thickness: thicknessRes.value,
      depthOrProjection: undefined,
      length:    lengthRes.value,
      areaEach:  undefined,
      totalArea: undefined,
      material:  undefined,
      glassType: undefined,
      frameType: undefined,
      countSource:    countRes.source,
      widthSource:    widthRes.source,
      heightSource:   heightRes.source,
      thicknessSource:thicknessRes.source,
      lengthSource:   lengthRes.source,
      areaSource:     undefined,
      materialSource: undefined,
      glassTypeSource:undefined,
      frameTypeSource:undefined,
      linkedEvidenceIds,
      sourceDrawingIds,
      sourceDrawingNames,
      sourcePages,
      occurrenceCount: rawOccurrence,
      possibleWidths:  widthRes.possible.length  > 1 ? widthRes.possible  : undefined,
      possibleHeights: heightRes.possible.length > 1 ? heightRes.possible : undefined,
      possibleCounts:  countRes.possible.length  > 1 ? countRes.possible  : undefined,
      possibleLengths: lengthRes.possible.length > 1 ? lengthRes.possible : undefined,
      possibleAreas:   undefined,
      missingFields: [],
      warnings: warningsLocal,
      reasoning,
      confidence: "low",
      status: "needs_verification",
      createdAt: now,
      updatedAt: now,
    };

    // ── Safe quantity derivation ─────────────────────────────────────────────
    candidate = calculateQuantity(candidate);

    // ── Detect missing required fields ───────────────────────────────────────
    const required = getRequiredFieldsForUnit(candidate.unit, candidate.category);
    const missing = required.filter((f) => {
      const v = candidate[f as keyof CrossDrawingQuantityCandidate];
      return v === undefined || v === null;
    });
    candidate.missingFields = missing;
    if (missing.length > 0) {
      reasoning.push(`Missing required field(s): ${missing.join(", ")}. Marked needs_verification.`);
    }

    // ── Confidence scoring ───────────────────────────────────────────────────
    candidate.confidence = scoreCrossDrawingConfidence(candidate);

    if (candidateHasSuspiciousDimensionSignals(candidate, candidate.confidence)) {
      if (!candidate.warnings.includes(SUSPICIOUS_DIMENSION_WARNING_TEXT)) {
        candidate.warnings.push(SUSPICIOUS_DIMENSION_WARNING_TEXT);
      }
      candidate.reasoning.push(
        "Suspicious dimension signal flagged. Width/height values remain possible until schedule/detail verification."
      );
    }

    // ── Status assignment ────────────────────────────────────────────────────
    const isComplete =
      missing.length === 0 &&
      !generic &&
      !hasAnyConflict &&
      candidate.confidence === "high";
    candidate.status = isComplete ? "draft" : "needs_verification";

    crossCandidates.push(candidate);
  }

  // ── Build-level unresolved issues ────────────────────────────────────────
  const unresolvedIssueIds = input.missingInfoItems
    .filter((mi) => mi.status === "open")
    .map((mi) => mi.id);
  if (unresolvedIssueIds.length > 0) {
    buildWarnings.push(
      `${unresolvedIssueIds.length} Missing Info issue(s) remain open.`
    );
  }

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats: CrossDrawingBuildStats = {
    totalEvidence:      allEntries.length,
    groupedItems:       crossCandidates.length,
    completeCandidates: crossCandidates.filter((c) => c.status === "draft").length,
    needsVerification:  crossCandidates.filter((c) => c.status === "needs_verification").length,
    missingInfoCreated: 0,
    highConfidence:     crossCandidates.filter((c) => c.confidence === "high").length,
    mediumConfidence:   crossCandidates.filter((c) => c.confidence === "medium").length,
    lowConfidence:      crossCandidates.filter((c) => c.confidence === "low").length,
    conflictingValues:  crossCandidates.filter((c) =>
      c.warnings.some((w) => w.includes("Multiple possible"))
    ).length,
    genericCodes:       crossCandidates.filter((c) => isGenericCode(c.itemCode)).length,
    ocrSourcedCandidates: crossCandidates.filter((c) => isOcrOnlyCandidate(c)).length,
  };

  return {
    projectId: input.projectId,
    candidates: crossCandidates,
    unresolvedIssueIds,
    warnings: buildWarnings,
    stats,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/**
 * Pick the single "best overall" entry for description/category/unit when we
 * cannot do per-field resolution (non-numeric fields).
 */
function pickBestOverallEntry(entries: EntryGroup): EntryGroup[0] {
  const scored = entries.map((e) => {
    const c = e.candidate;
    const srcType = sourceTypeForEntry(e);
    let score = 0;
    if (c.sourceType !== "ocr_text") score += 4;
    if (c.confidence === "high") score += 3;
    if (c.confidence === "medium") score += 2;
    score += getSourceRolePriorityForField("width", srcType);
    if (typeof c.width  === "number") score += 1;
    if (typeof c.height === "number") score += 1;
    if (typeof c.count  === "number") score += 1;
    if (typeof c.length === "number") score += 1;
    return { entry: e, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].entry;
}

// ---------------------------------------------------------------------------
// Phase 4D — Candidate eligibility helpers (exported for UI use)
// ---------------------------------------------------------------------------

/**
 * Returns true if the candidate has at least one warning indicating conflicting
 * values were detected by the Phase 4C per-field resolution.
 */
export function candidateHasValueConflict(
  c: CrossDrawingQuantityCandidate
): boolean {
  return c.warnings.some((w) => w.includes("Multiple possible"));
}

/**
 * Returns true when every defined value source on the candidate is OCR-derived.
 * OCR-only candidates can never be marked Verified.
 */
export function candidateIsOcrOnly(
  c: CrossDrawingQuantityCandidate
): boolean {
  const sources: Array<CrossDrawingValueSource | undefined> = [
    c.countSource, c.widthSource, c.heightSource, c.thicknessSource,
    c.lengthSource, c.areaSource, c.materialSource, c.glassTypeSource, c.frameTypeSource,
  ];
  const defined = sources.filter(Boolean) as CrossDrawingValueSource[];
  if (defined.length === 0) return false;
  return defined.every((s) => s.sourceType === "ocr_text");
}

/**
 * Full eligibility check for the "Mark Verified" action.
 * A candidate is verifiable when ALL of:
 *  - confidence is high
 *  - no required fields are missing
 *  - no value conflict detected
 *  - item code is not a bare generic (W, SD, CW …)
 *  - not OCR-only sourced
 *  - status is not already rejected
 */
export function candidateIsVerifiable(
  c: CrossDrawingQuantityCandidate
): boolean {
  return (
    c.confidence === "high" &&
    c.missingFields.length === 0 &&
    !candidateHasValueConflict(c) &&
    !isGenericCode(c.itemCode) &&
    !candidateIsOcrOnly(c) &&
    c.status !== "rejected"
  );
}

/**
 * Classify a candidate's "row state" for UI badge display.
 * Multiple states may apply; returns the most severe first.
 */
export type CandidateRowState =
  | "verified_eligible"   // complete, high confidence, no issues
  | "conflict"            // has unresolved conflicting values
  | "generic"             // bare generic code
  | "ocr_verify"          // OCR-only — needs manual verification
  | "missing_info"        // has missing required fields
  | "needs_verification"  // all fields present but confidence < high
  | "rejected";           // estimator rejected

export function getCandidateRowState(c: CrossDrawingQuantityCandidate): CandidateRowState {
  if (c.status === "rejected") return "rejected";
  if (candidateHasValueConflict(c)) return "conflict";
  if (isGenericCode(c.itemCode)) return "generic";
  if (candidateIsOcrOnly(c)) return "ocr_verify";
  if (c.missingFields.length > 0) return "missing_info";
  if (c.confidence === "high" && c.missingFields.length === 0) return "verified_eligible";
  return "needs_verification";
}

// ---------------------------------------------------------------------------
// Debug helper (updated to include Phase 4C stats)
// ---------------------------------------------------------------------------

export function summarizeCrossDrawingBuild(
  result: CrossDrawingBuildResult
): CrossDrawingBuildSummary {
  return {
    groupedItems:       result.stats.groupedItems,
    completeCandidates: result.stats.completeCandidates,
    needsVerification:  result.stats.needsVerification,
    highConfidence:     result.stats.highConfidence,
    mediumConfidence:   result.stats.mediumConfidence,
    lowConfidence:      result.stats.lowConfidence,
    warnings:           result.warnings,
  };
}
