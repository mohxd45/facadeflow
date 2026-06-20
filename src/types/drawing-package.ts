/**
 * Drawing Package Intelligence — Phase 1 / 1B
 *
 * Types for multi-drawing package analysis, classification, and evidence tracking.
 */

// ---------------------------------------------------------------------------
// Drawing type classification
// ---------------------------------------------------------------------------

export type DrawingPackageType =
  | "plan"
  | "elevation"
  | "section"
  | "schedule"
  | "detail"
  | "balustrade_detail"
  | "cad_dxf"
  | "general"
  | "unknown";

export const DRAWING_PACKAGE_TYPE_LABELS: Record<DrawingPackageType, string> = {
  plan:              "Floor Plan",
  elevation:         "Elevation",
  section:           "Section",
  schedule:          "Schedule",
  detail:            "Detail",
  balustrade_detail: "Balustrade/Railing Detail",
  cad_dxf:           "CAD / DXF",
  general:           "General / Drawing List",
  unknown:           "Unknown",
};

// ---------------------------------------------------------------------------
// Drawing analysis status — Phase 1B
// ---------------------------------------------------------------------------

export type DrawingAnalysisStatus =
  | "not_analysed"
  | "text_extractable"
  | "scanned_or_image_pdf"
  | "extraction_failed"
  | "unsupported_format"
  | "duplicate_skipped";

export const DRAWING_ANALYSIS_STATUS_LABELS: Record<DrawingAnalysisStatus, string> = {
  not_analysed:        "Not analysed",
  text_extractable:    "Analysed",
  scanned_or_image_pdf:"Scanned / OCR Needed",
  extraction_failed:   "Extraction failed",
  unsupported_format:  "Unsupported format",
  duplicate_skipped:   "Duplicate (skipped)",
};

import type { OcrStatus } from "./ocr";

export type { OcrStatus } from "./ocr";
export { OCR_STATUS_LABELS } from "./ocr";

// ---------------------------------------------------------------------------
// Classification result
// ---------------------------------------------------------------------------

export interface ClassifiedDrawing {
  drawingId: string;
  drawingName: string;
  fileType: string;
  drawingType: DrawingPackageType;
  sheetTitle: string | null;
  confidence: "high" | "medium" | "low";
  reasons: string[];

  // ── Phase 1B: extraction / OCR metadata ──────────────────────────────────
  /** Status of text extraction for this drawing */
  analysisStatus: DrawingAnalysisStatus;
  /** Whether OCR is needed (scanned/image PDF) */
  needsOcr: boolean;
  /** Placeholder for future OCR pipeline status */
  ocrStatus: OcrStatus;
  /** Human-readable notes about extraction (e.g. "Scanned PDF detected") */
  extractionNotes: string[];
}

// ---------------------------------------------------------------------------
// Evidence — what was extracted from a single drawing
// ---------------------------------------------------------------------------

export interface DrawingEvidence {
  drawingId: string;
  drawingName: string;
  drawingType: DrawingPackageType;
  classificationConfidence: "high" | "medium" | "low";
  sheetTitle: string | null;
  rawText: string;
  /** Where the text came from — pdf_text or ocr_text (Phase 3) */
  textSource?: import("./ocr").DrawingTextSource;
  /** Item-level candidates extracted from this drawing */
  candidates: import("./drawing-takeoff").DrawingTakeoffCandidate[];
}

// ---------------------------------------------------------------------------
// Full package analysis result (transient — not persisted)
// ---------------------------------------------------------------------------

export interface PackageAnalysisResult {
  projectId: string;
  analyzedAt: string;
  classifiedDrawings: ClassifiedDrawing[];
  evidence: DrawingEvidence[];
  warnings: string[];
}
