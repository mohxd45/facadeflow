/**
 * Code-Based Takeoff Calculation Service — Phase 2
 *
 * Calculates the final quantity and confidence for a CodeTakeoffItem
 * based on the matched ItemCodeRule and the entered dimensions.
 *
 * Drawing units: millimetres (mm) converted to metres (m) before calculation.
 * All output quantities are in SI base units (sqm or lm).
 */

import type {
  ItemCodeRule,
  CalculationMethod,
  CodeTakeoffUnit,
  CreateCodeTakeoffItemInput,
} from "@/types/code-takeoff";
import type { TakeoffCategory } from "@/types/takeoff";

// ---------------------------------------------------------------------------
// Input to the calculator
// ---------------------------------------------------------------------------

export interface CalculationInput {
  itemCode: string;
  matchedRule: ItemCodeRule | null;
  description?: string;
  /** Width as entered (metres) */
  width?: number;
  /** Height as entered (metres) */
  height?: number;
  /** Count of identical items */
  count?: number;
  /** Raw quantity entered by user (for area / length / manual methods) */
  manualQuantity?: number;
  /** User-overridden unit (may differ from rule default) */
  unitOverride?: CodeTakeoffUnit;
  /** User-overridden calculation method */
  methodOverride?: CalculationMethod;
  projectId: string;
  sourceType?: CreateCodeTakeoffItemInput["sourceType"];
  sourceDrawingId?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface CalculationResult {
  calculatedQuantity: number;
  unit: CodeTakeoffUnit;
  calculationMethod: CalculationMethod;
  category: TakeoffCategory;
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Default fallback
// ---------------------------------------------------------------------------

const FALLBACK_CATEGORY: TakeoffCategory = "windows";

// ---------------------------------------------------------------------------
// Main calculation function
// ---------------------------------------------------------------------------

export function calculateCodeTakeoff(input: CalculationInput): CalculationResult {
  const warnings: string[] = [];
  const rule = input.matchedRule;

  // Resolve effective unit and method (user override > rule default > fallback)
  const unit: CodeTakeoffUnit =
    input.unitOverride ?? rule?.defaultUnit ?? "sqm";
  const method: CalculationMethod =
    input.methodOverride ?? rule?.calculationMethod ?? "manual_quantity";
  const category: TakeoffCategory =
    rule?.category ?? FALLBACK_CATEGORY;

  // ── Perform calculation ─────────────────────────────────────────────────
  let qty = 0;

  switch (method) {
    case "width_height_qty": {
      const w = input.width;
      const h = input.height;
      const n = input.count ?? 1;

      if (w == null || h == null) {
        warnings.push("Width and height are required for W×H calculation.");
      } else if (w <= 0 || h <= 0) {
        warnings.push("Width and height must be positive values.");
      } else if (n <= 0) {
        warnings.push("Count must be a positive number.");
      } else {
        qty = w * h * n;
      }
      break;
    }
    case "entered_area": {
      const q = input.manualQuantity;
      if (q == null) {
        warnings.push("Enter area (sqm) directly.");
      } else if (q <= 0) {
        warnings.push("Area must be positive.");
      } else {
        qty = q;
      }
      break;
    }
    case "entered_length": {
      const q = input.manualQuantity;
      if (q == null) {
        warnings.push("Enter length (lm) directly.");
      } else if (q <= 0) {
        warnings.push("Length must be positive.");
      } else {
        qty = q;
      }
      break;
    }
    case "manual_quantity": {
      const q = input.manualQuantity;
      if (q == null) {
        warnings.push("Enter quantity.");
      } else if (q < 0) {
        warnings.push("Quantity must not be negative.");
      } else {
        qty = q;
      }
      break;
    }
  }

  // ── Sanity checks ────────────────────────────────────────────────────────
  if (unit === "sqm" && qty > 5_000) {
    warnings.push(`Quantity ${qty.toFixed(1)} sqm is unusually large — verify dimensions.`);
  }
  if (unit === "lm" && qty > 2_000) {
    warnings.push(`Quantity ${qty.toFixed(1)} lm is unusually large — verify length.`);
  }

  // ── Confidence ───────────────────────────────────────────────────────────
  let confidence: "high" | "medium" | "low";

  if (!rule) {
    confidence = "low";
    if (!warnings.some((w) => w.includes("No matching"))) {
      warnings.push("No matching code rule found. Review manually.");
    }
  } else if (warnings.length > 0 || qty === 0) {
    confidence = "low";
  } else if (input.unitOverride || input.methodOverride) {
    // User overrode defaults — medium because intention is clear but override applied
    confidence = "medium";
  } else {
    confidence = "high";
  }

  return { calculatedQuantity: qty, unit, calculationMethod: method, category, confidence, warnings };
}

// ---------------------------------------------------------------------------
// Build a CreateCodeTakeoffItemInput from raw input + calculation result
// ---------------------------------------------------------------------------

export function buildCodeTakeoffItemInput(
  input: CalculationInput,
  result: CalculationResult
): CreateCodeTakeoffItemInput {
  return {
    projectId: input.projectId,
    itemCode: input.itemCode,
    ruleId: input.matchedRule?.id,
    description: input.description,
    category: result.category,
    width: input.width,
    height: input.height,
    count: input.count,
    manualQuantity: input.manualQuantity,
    calculatedQuantity: result.calculatedQuantity,
    unit: result.unit,
    calculationMethod: result.calculationMethod,
    sourceType: input.sourceType ?? "manual",
    sourceDrawingId: input.sourceDrawingId,
    notes: input.notes,
    confidence: result.confidence,
    warnings: result.warnings.length > 0 ? result.warnings : undefined,
  };
}
