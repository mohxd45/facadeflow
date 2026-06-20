/**
 * OCR / AI Vision Ready Types — Phase 3
 *
 * Stores per-page OCR results from scanned PDFs.
 * Rendered page images are kept for future AI vision integration.
 */

// ---------------------------------------------------------------------------
// OCR pipeline status
// ---------------------------------------------------------------------------

export type OcrStatus =
  | "not_needed"
  | "needed"
  | "running"
  | "completed"
  | "failed";

export const OCR_STATUS_LABELS: Record<OcrStatus, string> = {
  not_needed: "Not needed",
  needed:     "OCR needed",
  running:    "OCR running…",
  completed:  "OCR completed",
  failed:     "OCR failed",
};

// ---------------------------------------------------------------------------
// Per-page OCR result (persisted)
// ---------------------------------------------------------------------------

export type DrawingOcrPageStatus = "completed" | "failed" | "placeholder";

export interface DrawingOcrResult {
  id: string;
  drawingId: string;
  projectId: string;
  pageNumber: number;
  /** Rendered page image (JPEG data URL) — for AI vision / manual review */
  imageDataUrl?: string;
  extractedText: string;
  /** Tesseract confidence 0–100, if available */
  confidence?: number;
  status: DrawingOcrPageStatus;
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

export type CreateDrawingOcrResultInput = Omit<
  DrawingOcrResult,
  "id" | "createdAt" | "updatedAt"
>;

// ---------------------------------------------------------------------------
// Text source for package analysis
// ---------------------------------------------------------------------------

export type DrawingTextSource = "pdf_text" | "ocr_text" | "none";

export interface BestAvailableTextResult {
  text: string;
  source: DrawingTextSource;
  isScanned: boolean;
  needsOcr: boolean;
  ocrStatus: OcrStatus;
  pageCount: number;
  ocrConfidence?: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Rendered PDF page (transient — not persisted separately)
// ---------------------------------------------------------------------------

export interface RenderedPdfPage {
  pageNumber: number;
  imageDataUrl: string;
  width: number;
  height: number;
}
