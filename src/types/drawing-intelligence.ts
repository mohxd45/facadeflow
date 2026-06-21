/**
 * Drawing Intelligence — Phase 6A Foundation
 *
 * Unified types for multi-format façade drawing analysis.
 *
 * Design principles (never violated by this phase or any future phase):
 *  - AI detections are ALWAYS "possible_*" or "needs_verification" — never final.
 *  - Reconciliation is advisory: system calculates, AI suggests, estimator decides.
 *  - All quantity-affecting values must come from system (OCR/DXF/PDF) not AI alone.
 *  - AI-only detections must never auto-populate width/height/count/totalArea.
 *
 * Drawing formats supported in this model (parsing depth varies by phase):
 *   PDF (text layer)  →  Phase 3 / current
 *   Scanned PDF (OCR) →  Phase 3 / current
 *   DXF               →  Phase 4 / current
 *   DWG               →  Phase 6+ (converter TBD)
 *   ZIP package       →  Phase 3 / current
 */

// ---------------------------------------------------------------------------
// Source format
// ---------------------------------------------------------------------------

export type DrawingSourceFormat =
  | "pdf_text"      // native PDF with embedded text layer
  | "pdf_ocr"       // scanned PDF processed via Tesseract OCR
  | "dxf"           // AutoCAD DXF (directly parsed)
  | "dwg"           // AutoCAD DWG (future — requires converter)
  | "zip_package"   // multiple files from a ZIP upload
  | "manual";       // estimator-entered data

// ---------------------------------------------------------------------------
// Drawing page / sheet reference
// ---------------------------------------------------------------------------

/** Identifies one sheet/page within a drawing package. */
export interface DrawingSheetRef {
  drawingId: string;
  drawingName: string;
  sourceFormat: DrawingSourceFormat;
  /** 1-based page number for PDF; 0 for single-sheet DXF. */
  page: number;
  /** Sheet title if detected (e.g. "ELEVATION - NORTH FACADE"). */
  sheetTitle?: string;
}

// ---------------------------------------------------------------------------
// Coordinate / bounding region (format-agnostic)
// ---------------------------------------------------------------------------

/**
 * Approximate location of a detected element.
 * For PDF: relative fractions [0–1] of page width/height.
 * For DXF/DWG: drawing-unit coordinates (may be very large numbers).
 */
export interface DrawingRegion {
  /** Normalised X of top-left corner [0–1] for PDF; raw coordinate for CAD. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** "relative" = PDF/image fractions, "drawing_units" = CAD units */
  coordinateSpace: "relative" | "drawing_units";
}

// ---------------------------------------------------------------------------
// System detections
// (produced deterministically from structured data — text, DXF, OCR)
// ---------------------------------------------------------------------------

/** One item code (e.g. "W-01") found in structured drawing data. */
export interface SystemCodeDetection {
  id: string;
  sheet: DrawingSheetRef;
  rawText: string;
  /** Normalised code: "W-01", "CW-03", etc. */
  normalizedCode: string;
  confidence: "high" | "medium" | "low";
  source: "pdf_text" | "ocr_text" | "dxf_text" | "dxf_block_name" | "schedule_row";
  region?: DrawingRegion;
  detectedAt: string;
}

/** One explicit dimension found in structured drawing data. */
export interface SystemDimensionDetection {
  id: string;
  sheet: DrawingSheetRef;
  rawText: string;
  /** Width in metres if parsed; null if unresolvable. */
  widthM: number | null;
  /** Height in metres if parsed; null if unresolvable. */
  heightM: number | null;
  /** Running length in metres if applicable. */
  lengthM: number | null;
  confidence: "high" | "medium" | "low";
  source: "pdf_text" | "ocr_text" | "dxf_dimension_entity" | "dxf_text";
  region?: DrawingRegion;
  detectedAt: string;
}

/** Structural evidence from a DXF layer or block. */
export interface SystemDxfDetection {
  id: string;
  sheet: DrawingSheetRef;
  layerName: string;
  blockName?: string;
  entityCount: number;
  /** Best-guess element category from layer name heuristics. */
  inferredCategory?: string;
  /** Total area of closed polylines on this layer (sqm if units known). */
  estimatedAreaSqm?: number;
  /** Total length of lines on this layer (lm if units known). */
  estimatedLengthLm?: number;
  confidence: "high" | "medium" | "low";
  detectedAt: string;
}

/** One row of system detections aggregated for a single drawing sheet. */
export interface SystemSheetEvidence {
  sheet: DrawingSheetRef;
  codeDetections: SystemCodeDetection[];
  dimensionDetections: SystemDimensionDetection[];
  dxfDetections: SystemDxfDetection[];
}

// ---------------------------------------------------------------------------
// AI visual detections
// (always advisory — never final, never auto-verified)
// ---------------------------------------------------------------------------

/**
 * Element types that AI vision may detect in a façade drawing image.
 * Prefixed "possible_" to make advisory status structurally explicit.
 */
export type AiVisualDetectionType =
  | "possible_window"
  | "possible_door"
  | "possible_sliding_door"
  | "possible_curtain_wall"
  | "possible_acp"
  | "possible_railing"
  | "possible_louver"
  | "possible_uncoded_opening"
  | "unknown_facade_element";

/** Single AI visual detection in a drawing. */
export interface AiVisualDetection {
  id: string;
  sheet: DrawingSheetRef;
  detectionType: AiVisualDetectionType;
  /**
   * Confidence from AI model [0–1].
   * Values below 0.5 should be displayed as low-confidence hints only.
   */
  aiConfidence: number;
  /** AI-estimated rough width in metres — advisory only, never auto-saved. */
  estimatedWidthM?: number;
  /** AI-estimated rough height in metres — advisory only, never auto-saved. */
  estimatedHeightM?: number;
  /** Region in the drawing image where element was detected. */
  region?: DrawingRegion;
  /** Free-form note from AI (e.g. "appears to be thermally broken frame"). */
  note?: string;
  /**
   * Status of this detection.
   * "possible" and "needs_verification" are the only allowed initial states.
   * AI detections NEVER start as "verified" or "final".
   */
  status: "possible" | "needs_verification";
  detectedAt: string;
}

/** Aggregated AI visual analysis for one drawing sheet. */
export interface AiVisualSheetAnalysis {
  sheet: DrawingSheetRef;
  detections: AiVisualDetection[];
  /** Raw summary text from the AI model (advisory). */
  modelSummary?: string;
  /** AI model identifier — for traceability. */
  modelId?: string;
  analysedAt: string;
}

// ---------------------------------------------------------------------------
// Reconciliation result
// ---------------------------------------------------------------------------

/**
 * How one reconciled element compares between system data and AI vision.
 * "matched"          — both system and AI found the same element
 * "system_only"      — found by system (text/DXF) but not by AI
 * "ai_only"          — suggested by AI only; no system code/dimension evidence
 * "conflict"         — both found it but key values disagree (e.g. width mismatch)
 * "needs_verification" — insufficient evidence to classify; estimator must decide
 */
export type ReconciliationMatchStatus =
  | "matched"
  | "system_only"
  | "ai_only"
  | "conflict"
  | "needs_verification";

/**
 * Reconciliation confidence band.
 * "high"   — strong evidence on both sides, consistent
 * "medium" — some evidence, minor discrepancy
 * "low"    — weak evidence, significant uncertainty
 */
export type ReconciliationConfidence = "high" | "medium" | "low";

/** One reconciled element — the core output of Phase 6 analysis. */
export interface ReconciledElement {
  id: string;
  sheet: DrawingSheetRef;
  matchStatus: ReconciliationMatchStatus;
  confidence: ReconciliationConfidence;

  // ── System side ─────────────────────────────────────────────────────────
  systemCodeDetection?: SystemCodeDetection;
  systemDimensionDetection?: SystemDimensionDetection;
  systemDxfDetection?: SystemDxfDetection;

  // ── AI side (always advisory) ────────────────────────────────────────────
  aiDetection?: AiVisualDetection;

  /**
   * Best-guess element type combining system + AI evidence.
   * Never "final" — always carries uncertainty from the AI side.
   */
  inferredType?: AiVisualDetectionType | string;

  // ── Derived dimension hints (advisory — never auto-saved as verified) ────
  /** Best width estimate combining system dimension + AI hint (metres). */
  hintWidthM?: number;
  /** Best height estimate combining system dimension + AI hint (metres). */
  hintHeightM?: number;

  // ── Estimator action items ────────────────────────────────────────────────
  /** Human-readable list of issues the estimator should review. */
  flaggedIssues: string[];
  /** Recommended next step for the estimator. */
  estimatorAction?:
    | "accept_system_values"
    | "verify_dimensions"
    | "check_ai_suggestion"
    | "add_item_code"
    | "resolve_conflict"
    | "ignore";

  reconciledAt: string;
}

/** Complete reconciliation result for one drawing sheet. */
export interface DrawingSheetReconciliation {
  sheet: DrawingSheetRef;
  reconciledElements: ReconciledElement[];
  /** Summary stats for quick display. */
  stats: {
    matched: number;
    systemOnly: number;
    aiOnly: number;
    conflicts: number;
    needsVerification: number;
    total: number;
  };
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Input to the reconciliation service
// ---------------------------------------------------------------------------

export interface ReconciliationInput {
  projectId: string;
  systemEvidence: SystemSheetEvidence[];
  aiAnalyses: AiVisualSheetAnalysis[];
}

// ---------------------------------------------------------------------------
// Safety constants (compile-time assertions — never narrowable away)
// ---------------------------------------------------------------------------

/** The only statuses an AI detection may have when first created. */
export const AI_DETECTION_ALLOWED_INITIAL_STATUSES = [
  "possible",
  "needs_verification",
] as const satisfies ReadonlyArray<AiVisualDetection["status"]>;

/** Statuses that AI alone can never assign to a reconciled element. */
export const AI_FORBIDDEN_ELEMENT_STATUSES = [
  "verified",
  "final",
  "approved",
] as const;
