/**
 * Drawing Takeoff Data Model — Phase 4
 *
 * DrawingTakeoffItem is the primary output of the drawing-only takeoff workflow.
 * Items are sourced from:
 *   - drawing_annotation : text/codes detected in a PDF drawing
 *   - drawing_schedule   : table/schedule rows parsed from a PDF
 *   - dxf_geometry       : DXF entity measurements (future)
 *   - manual_verify      : estimator-added verified row
 *
 * Area-based items (sqm): store count + width + height + areaEach + totalArea
 * Running-meter items (lm): store length
 *
 * AI-ready fields are present but intentionally unused until Phase N.
 */

// ---------------------------------------------------------------------------
// Unit and source type
// ---------------------------------------------------------------------------

export type DrawingTakeoffUnit = "sqm" | "lm" | "nos" | "set";

export type DrawingTakeoffSourceType =
  | "drawing_annotation"   // code/size detected from PDF annotation text
  | "drawing_schedule"     // row parsed from a PDF table/schedule
  | "ocr_text"             // extracted from scanned PDF via OCR (Phase 3)
  | "dxf_geometry"         // measured from DXF entity geometry
  | "manual_verify";       // manually added/verified by estimator

// ---------------------------------------------------------------------------
// Category (reuses existing TakeoffCategory strings)
// ---------------------------------------------------------------------------

export type DrawingItemCategory =
  | "windows"
  | "doors"
  | "glass_balustrade"
  | "balcony_railing"
  | "acp_cladding"
  | "curtain_wall_glass_panel"
  | "aluminium_fins"
  | "canopy"
  | "glass_partitions"
  | "louvers"
  | "screen"
  | "other";

export const DRAWING_ITEM_CATEGORY_LABELS: Record<DrawingItemCategory, string> = {
  windows:                  "Window",
  doors:                    "Door",
  glass_balustrade:         "Glass Balustrade",
  balcony_railing:          "Balcony Railing",
  acp_cladding:             "ACP Cladding",
  curtain_wall_glass_panel: "Curtain Wall",
  aluminium_fins:           "Aluminium Fins",
  canopy:                   "Canopy",
  glass_partitions:         "Glass Partitions",
  louvers:                  "Louver",
  screen:                   "Screen",
  other:                    "Other",
};

// ---------------------------------------------------------------------------
// Main item type
// ---------------------------------------------------------------------------

export interface DrawingTakeoffItem {
  id: string;
  projectId: string;

  /** Drawing file this item was detected from */
  drawingId?: string;
  /** Page number within the drawing (1-based) */
  sourcePage?: number;
  /** Sheet/drawing title if detected (e.g. "ELEVATION - NORTH") */
  sheetTitle?: string;

  /** Company item code, e.g. W-01, BL-R */
  itemCode?: string;
  description: string;
  category: DrawingItemCategory;

  /** Number of identical items (nos) */
  count?: number;
  /** Width in metres */
  width?: number;
  /** Height in metres */
  height?: number;
  /** Area per unit = width × height (sqm) */
  areaEach?: number;
  /** Total area = areaEach × count (sqm) */
  totalArea?: number;
  /** Running length (lm) */
  length?: number;

  /** Thickness in metres (e.g. glass 12mm → 0.012) */
  thickness?: number;
  /** Depth or projection (e.g. canopy depth, fin depth) */
  depthOrProjection?: number;
  /** Material description (e.g. "Powder coated aluminium") */
  material?: string;
  /** Glass specification (e.g. "10mm tempered") */
  glassType?: string;
  /** Frame type (e.g. "Thermally broken aluminium") */
  frameType?: string;

  unit: DrawingTakeoffUnit;
  sourceType: DrawingTakeoffSourceType;

  // ── Source tracking (Phase 1) — which drawing provided each value ─────────
  /** Name of source drawing (for display without resolving drawingId) */
  sourceDrawingName?: string;
  /** Which drawing/page the item code was found on */
  itemSource?: string;
  /** Which drawing/page the count was found on */
  countSource?: string;
  /** Which drawing/page the width was found on */
  widthSource?: string;
  /** Which drawing/page the height was found on */
  heightSource?: string;
  /** Which drawing/page the thickness was found on */
  thicknessSource?: string;
  /** Which drawing/page the length was found on */
  lengthSource?: string;
  /** Which drawing/page the area was found on */
  areaSource?: string;
  /** Which drawing/page material info came from */
  materialSource?: string;

  /** Fields that are still missing / unverified */
  missingFields?: string[];

  /**
   * Estimator-facing status.
   * draft             — auto-extracted, not reviewed
   * needs_verification — has data but estimator must check
   * verified          — estimator has reviewed and approved
   * rejected          — estimator rejected this row
   * final             — approved for export
   */
  status?: "draft" | "needs_verification" | "verified" | "rejected" | "final";

  confidence: "high" | "medium" | "low";
  warnings: string[];
  notes?: string;

  // ── AI-ready fields (unused until Phase N) ──────────────────────────────
  /** Review status set by a future AI agent */
  aiReviewStatus?: "not_reviewed" | "reviewed" | "approved" | "flagged";
  /** Notes added by AI review */
  aiNotes?: string;
  /** Which AI model or system produced this item */
  systemSource?: string;

  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Create input (omits generated fields)
// ---------------------------------------------------------------------------

export type CreateDrawingTakeoffItemInput = Omit<
  DrawingTakeoffItem,
  "id" | "createdAt" | "updatedAt"
>;

// ---------------------------------------------------------------------------
// Candidate row shown in review table (before saving)
// ---------------------------------------------------------------------------

export interface DrawingTakeoffCandidate {
  /** Auto-generated temp id for keying the review table */
  _tempId: string;
  /** Raw text snippet extracted from the PDF for traceability */
  rawSnippet: string;

  /** Source drawing id (Package Review traceability) */
  drawingId?: string;

  itemCode?: string;
  description: string;
  category: DrawingItemCategory;
  count?: number;
  width?: number;
  height?: number;
  areaEach?: number;
  totalArea?: number;
  length?: number;
  unit: DrawingTakeoffUnit;
  sourceType: DrawingTakeoffSourceType;
  sourcePage?: number;
  sheetTitle?: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  notes?: string;

  /** Grouped duplicate occurrences on same drawing/page */
  occurrenceCount?: number;
  /** Temp ids of merged duplicate rows */
  linkedEvidenceIds?: string[];
  /** Generic/unnumbered code — not safe as final quantity */
  needsVerification?: boolean;
  /** Fields still missing for a verified quantity */
  missingFields?: string[];
}

// ---------------------------------------------------------------------------
// Company code → category mapping (used by extraction service)
// ---------------------------------------------------------------------------

export interface DrawingCodeRule {
  /** Code prefix, e.g. "W", "SD", "BL-R" */
  prefix: string;
  category: DrawingItemCategory;
  unit: DrawingTakeoffUnit;
  label: string;
}

export const DRAWING_CODE_RULES: DrawingCodeRule[] = [
  { prefix: "W",     category: "windows",                  unit: "sqm", label: "Window" },
  { prefix: "SD",    category: "doors",                    unit: "sqm", label: "Sliding Door" },
  { prefix: "D",     category: "doors",                    unit: "sqm", label: "Door" },
  { prefix: "ED",    category: "doors",                    unit: "sqm", label: "Entrance Door" },
  { prefix: "CW",    category: "curtain_wall_glass_panel", unit: "sqm", label: "Curtain Wall" },
  { prefix: "V",     category: "windows",                  unit: "sqm", label: "Ventilator" },
  { prefix: "KP",    category: "canopy",                   unit: "sqm", label: "Canopy" },
  { prefix: "BL-R",  category: "glass_balustrade",         unit: "lm",  label: "Glass Balustrade/Railing" },
  { prefix: "SCR",   category: "screen",                   unit: "sqm", label: "Screen" },
  { prefix: "ACP",   category: "acp_cladding",             unit: "sqm", label: "ACP Cladding" },
  { prefix: "LUR",   category: "louvers",                  unit: "sqm", label: "Louver" },
  { prefix: "A/FIN", category: "aluminium_fins",           unit: "lm",  label: "Aluminium Fins" },
];

// ---------------------------------------------------------------------------
// Drawing Issue Item — tracks missing / incomplete information
// ---------------------------------------------------------------------------

export type DrawingIssueType =
  | "missing_code"
  | "missing_width"
  | "missing_height"
  | "missing_thickness"
  | "missing_count"
  | "missing_unit"
  | "uncoded_opening"
  | "unclear_item"
  | "needs_section"
  | "needs_elevation"
  | "needs_schedule"
  | "manual_measurement_required";

export const DRAWING_ISSUE_TYPE_LABELS: Record<DrawingIssueType, string> = {
  missing_code:                 "Missing item code",
  missing_width:                "Missing width",
  missing_height:               "Missing height",
  missing_thickness:            "Missing thickness",
  missing_count:                "Missing count",
  missing_unit:                 "Missing unit",
  uncoded_opening:              "Uncoded opening detected",
  unclear_item:                 "Unclear item",
  needs_section:                "Needs section drawing",
  needs_elevation:              "Needs elevation drawing",
  needs_schedule:               "Needs schedule",
  manual_measurement_required:  "Manual measurement required",
};

export type DrawingIssueStatus =
  | "open"
  | "filled"
  | "converted_to_takeoff"
  | "ignored";

export interface DrawingIssueItem {
  id: string;
  projectId: string;

  sourceDrawingId?: string;
  sourceDrawingName?: string;
  sourcePage?: number;
  sourceSheetTitle?: string;

  issueType: DrawingIssueType;
  possibleCategory?: DrawingItemCategory;
  possibleDescription?: string;
  /** Summary of what was detected (e.g. "Code W-01, no size found") */
  detectedEvidence?: string;
  missingFields: string[];
  suggestedUnit?: DrawingTakeoffUnit;

  confidence: "high" | "medium" | "low";
  reason: string;
  recommendation: string;

  status: DrawingIssueStatus;

  // ── Manual fill values (estimator-entered) ─────────────────────────────────
  manualItemCode?: string;
  manualDescription?: string;
  manualCount?: string;
  manualWidth?: string;
  manualHeight?: string;
  manualThickness?: string;
  manualLength?: string;
  manualArea?: string;
  manualUnit?: DrawingTakeoffUnit;
  manualNotes?: string;

  /** DrawingTakeoffItem id created when this issue was converted */
  convertedItemId?: string;

  createdAt: string;
  updatedAt: string;
}

export type CreateDrawingIssueItemInput = Omit<
  DrawingIssueItem,
  "id" | "createdAt" | "updatedAt"
>;
