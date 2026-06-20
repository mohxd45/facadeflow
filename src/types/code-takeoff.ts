/**
 * Code-Based Takeoff Types — Phase 2
 *
 * The primary company workflow is:
 *   item code (e.g. W-01, SD-03, BL-R) → matched rule → dimensions/qty → calculated quantity
 *
 * Drawing units are typically mm; the app converts to meters for display.
 */

import type { TakeoffCategory } from "./takeoff";

// ---------------------------------------------------------------------------
// Units & methods
// ---------------------------------------------------------------------------

export type CodeTakeoffUnit = "sqm" | "lm" | "nos" | "set";

export type CalculationMethod =
  | "width_height_qty"  // width (m) × height (m) × count = sqm
  | "entered_area"      // user enters area directly (sqm)
  | "entered_length"    // user enters length directly (lm)
  | "manual_quantity";  // user enters raw quantity, any unit

// ---------------------------------------------------------------------------
// Item Code Rule
// ---------------------------------------------------------------------------

export interface ItemCodeRule {
  id: string;
  /** The prefix to match against item codes (e.g. "W", "SD", "BL-R", "A/FIN") */
  codePrefix: string;
  /** Human-readable label (e.g. "Window", "Sliding Door") */
  label: string;
  /** Maps to TakeoffCategory for downstream grouping */
  category: TakeoffCategory;
  /** Default unit for this item type */
  defaultUnit: CodeTakeoffUnit;
  /** How quantity is calculated */
  calculationMethod: CalculationMethod;
  /** Optional notes shown in the rules editor */
  description?: string;
  /** Whether this rule is used in matching */
  isActive: boolean;
  /** True for built-in company defaults (cannot be deleted, only toggled) */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Code Takeoff Item — one row in the project's code-based takeoff
// ---------------------------------------------------------------------------

export interface CodeTakeoffItem {
  id: string;
  projectId: string;
  /** Full item code as entered (e.g. "W-01", "SD-03", "BL-R") */
  itemCode: string;
  /** Matched rule ID, if found */
  ruleId?: string;
  description?: string;
  category: TakeoffCategory;
  /** Width in metres (converted from mm if drawing units are mm) */
  width?: number;
  /** Height in metres */
  height?: number;
  /** Count / number of identical items */
  count?: number;
  /** Raw quantity entered directly by user (for entered_area / entered_length / manual) */
  manualQuantity?: number;
  /** Final computed quantity */
  calculatedQuantity: number;
  unit: CodeTakeoffUnit;
  calculationMethod: CalculationMethod;
  /** Where this row originated */
  sourceType: "manual" | "boq" | "quotation" | "schedule" | "drawing";
  sourceDrawingId?: string;
  notes?: string;
  confidence: "high" | "medium" | "low";
  /** Validation warnings (non-blocking) */
  warnings?: string[];
  createdAt: string;
  updatedAt: string;
}

export type CreateCodeTakeoffItemInput = Omit<
  CodeTakeoffItem,
  "id" | "createdAt" | "updatedAt"
>;

// ---------------------------------------------------------------------------
// BOQ parser output — one row before user review
// ---------------------------------------------------------------------------

export interface ParsedBoqRow {
  /** Original text line */
  rawText: string;
  itemCode: string;
  matchedRule: ItemCodeRule | null;
  description?: string;
  width?: number;
  height?: number;
  count?: number;
  manualQuantity?: number;
  unit: CodeTakeoffUnit;
  calculationMethod: CalculationMethod;
  calculatedQuantity: number;
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Default seed rules (company standard)
// ---------------------------------------------------------------------------

function mkRule(
  id: string,
  codePrefix: string,
  label: string,
  category: TakeoffCategory,
  defaultUnit: CodeTakeoffUnit,
  calculationMethod: CalculationMethod,
  description?: string
): ItemCodeRule {
  const now = "2024-01-01T00:00:00.000Z";
  return {
    id,
    codePrefix,
    label,
    category,
    defaultUnit,
    calculationMethod,
    description,
    isActive: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

export const DEFAULT_CODE_RULES: ItemCodeRule[] = [
  mkRule("default-W",     "W",     "Window",              "windows",                 "sqm", "width_height_qty", "Standard window opening. W × H × count."),
  mkRule("default-SD",    "SD",    "Sliding Door",        "doors",                   "sqm", "width_height_qty", "Sliding door panel. W × H × count."),
  mkRule("default-D",     "D",     "Door",                "doors",                   "sqm", "width_height_qty", "Standard door. W × H × count."),
  mkRule("default-ED",    "ED",    "Entrance Door",       "doors",                   "sqm", "width_height_qty", "Entrance door (larger or double). W × H × count."),
  mkRule("default-CW",    "CW",    "Curtain Wall",        "curtain_wall_glass_panel","sqm", "width_height_qty", "Curtain wall glazing. W × H × count."),
  mkRule("default-V",     "V",     "Ventilator",          "louvers",                 "sqm", "width_height_qty", "Ventilated item. Default sqm; override to lm if needed."),
  mkRule("default-KP",    "KP",    "Canopy",              "canopy",                  "sqm", "entered_area",     "Canopy / awning. Enter area directly."),
  mkRule("default-BL-R",  "BL-R",  "Glass Balustrade / Railing", "glass_balustrade","lm",  "entered_length",   "Glass balustrade or handrail. Enter running metres."),
  mkRule("default-SCR",   "SCR",   "Screen",              "screen",                  "sqm", "entered_area",     "Architectural screen panel. Enter area directly."),
  mkRule("default-ACP",   "ACP",   "ACP Cladding",        "acp_cladding",            "sqm", "entered_area",     "Aluminium Composite Panel cladding. Enter area."),
  mkRule("default-LUR",   "LUR",   "Louver",              "louvers",                 "sqm", "entered_area",     "Louvred panel — sqm or lm, override per item."),
  mkRule("default-AFIN",  "A/FIN", "Aluminium Fins",      "aluminium_fins",          "lm",  "entered_length",   "Aluminium vertical/horizontal fins. Enter running metres."),
];
