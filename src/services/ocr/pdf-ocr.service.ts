/**
 * PDF OCR Service — Phase 3
 *
 * Renders scanned PDF pages to canvas images and runs browser OCR (Tesseract.js).
 * Modular design: rendered images are stored for future AI vision integration.
 *
 * Constraints:
 * - Browser-only (pdfjs + canvas + Tesseract worker).
 * - Max pages per OCR run to avoid memory/performance issues.
 * - OCR results are never auto-verified — low/medium confidence only.
 */

import type { DrawingFile } from "@/types/drawing";
import type {
  BestAvailableTextResult,
  CreateDrawingOcrResultInput,
  DrawingOcrResult,
  OcrStatus,
  RenderedPdfPage,
} from "@/types/ocr";
import { extractPdfText, type PdfExtractionResult } from "@/services/pdf/pdf-text-extractor";
import { resolveDrawingBlob } from "@/services/file/drawing-blob-resolver";
import { generateId } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum pages to render/OCR per drawing (safety limit) */
export const MAX_OCR_PAGES = 5;

/** Canvas render scale — 1.5 balances OCR quality vs memory */
const RENDER_SCALE = 1.5;

/** JPEG quality for stored page images */
const IMAGE_JPEG_QUALITY = 0.72;

/** Minimum chars from OCR to consider extraction successful */
const MIN_OCR_TEXT_LENGTH = 30;

/** Build a single failed OCR row for persistence when the pipeline throws. */
export function createFailedOcrResultInput(
  drawing: DrawingFile,
  errorMessage: string
): CreateDrawingOcrResultInput {
  return {
    drawingId: drawing.id,
    projectId: drawing.projectId,
    pageNumber: 1,
    extractedText: "",
    status: "failed",
    warnings: [`OCR failed: ${errorMessage}`],
  };
}

/** Warnings from failed OCR rows for a drawing (for UI display). */
export function getOcrFailureWarnings(
  drawingId: string,
  ocrResults: DrawingOcrResult[]
): string[] {
  return ocrResults
    .filter((r) => r.drawingId === drawingId && r.status === "failed")
    .flatMap((r) => r.warnings)
    .filter(Boolean);
}

function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

let pdfjsInitialised = false;

async function getPdfjs() {
  let pdfjs: typeof import("pdfjs-dist");
  try {
    // Legacy bundle avoids modern runtime helpers that are unavailable in some
    // embedded browser environments used during local QA automation.
    pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as typeof import("pdfjs-dist");
  } catch {
    pdfjs = await import("pdfjs-dist");
  }
  if (!pdfjsInitialised) {
    // Keep OCR render path aligned with package review extractor setup.
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    pdfjsInitialised = true;
  }
  return pdfjs;
}

// ---------------------------------------------------------------------------
// 1. detectScannedPdf
// ---------------------------------------------------------------------------

export interface ScannedPdfDetection {
  isScanned: boolean;
  hasTextLayer: boolean;
  textLength: number;
  pageCount: number;
  error?: string;
}

export async function detectScannedPdf(
  drawing: DrawingFile
): Promise<ScannedPdfDetection> {
  if (drawing.fileType !== "pdf") {
    return { isScanned: false, hasTextLayer: false, textLength: 0, pageCount: 0 };
  }

  try {
    const file = await resolveDrawingBlob(drawing);
    const result = await extractPdfText(file);
    return {
      isScanned: result.isLikelyScanned || result.text.trim().length < 50,
      hasTextLayer: result.text.trim().length >= 50,
      textLength: result.text.length,
      pageCount: result.pageCount,
      error: result.error,
    };
  } catch (err) {
    return {
      isScanned: true,
      hasTextLayer: false,
      textLength: 0,
      pageCount: 0,
      error: err instanceof Error ? err.message : "Could not load PDF.",
    };
  }
}

// ---------------------------------------------------------------------------
// 2. renderPdfPagesToImages
// ---------------------------------------------------------------------------

export interface RenderPdfOptions {
  maxPages?: number;
  scale?: number;
}

export async function renderPdfPagesToImages(
  file: File,
  options: RenderPdfOptions = {}
): Promise<RenderedPdfPage[]> {
  if (!isBrowserEnvironment()) {
    throw new Error("PDF page render requires a browser environment.");
  }

  const maxPages = options.maxPages ?? MAX_OCR_PAGES;
  const scale = options.scale ?? RENDER_SCALE;

  try {
    const pdfjs = await getPdfjs();
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(arrayBuffer),
      disableRange: true,
      disableStream: true,
    });

    const pdf = await loadingTask.promise;
    const pageCount = Math.min(pdf.numPages, maxPages);
    const pages: RenderedPdfPage[] = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        page.cleanup();
        continue;
      }

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const imageDataUrl = canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY);
      pages.push({
        pageNumber: pageNum,
        imageDataUrl,
        width: viewport.width,
        height: viewport.height,
      });
      page.cleanup();
    }

    await loadingTask.destroy();

    if (pages.length === 0) {
      throw new Error("PDF page render failed: no pages could be rendered.");
    }

    return pages;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Unknown render error.";
    throw new Error(
      detail.startsWith("PDF page render failed")
        ? detail
        : `PDF page render failed: ${detail}`
    );
  }
}

// ---------------------------------------------------------------------------
// 3. runOcrOnPageImage (Tesseract.js — dynamic import)
// ---------------------------------------------------------------------------

interface OcrPageOutput {
  text: string;
  confidence: number;
  warnings: string[];
}

async function runOcrOnPageImage(imageDataUrl: string): Promise<OcrPageOutput> {
  if (!isBrowserEnvironment()) {
    return {
      text: "",
      confidence: 0,
      warnings: ["OCR failed: Tesseract requires a browser environment."],
    };
  }

  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      logger: () => {},
    });

    try {
      const { data } = await worker.recognize(imageDataUrl);
      const text = data.text.trim();
      const confidence = data.confidence ?? 0;
      const warnings: string[] = [];

      if (confidence < 60) {
        warnings.push("Low OCR confidence — verify text manually.");
      }
      if (text.length === 0) {
        warnings.push("No text recognized on this page.");
      } else if (text.length < MIN_OCR_TEXT_LENGTH) {
        warnings.push("Very little text extracted — drawing may be low quality or mostly graphics.");
      }

      return { text, confidence, warnings };
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Tesseract worker failed.";
    return {
      text: "",
      confidence: 0,
      warnings: [`OCR failed: Tesseract worker failed to load — ${message}`],
    };
  }
}

// ---------------------------------------------------------------------------
// 4. runOcrOnPdf — full pipeline for one drawing
// ---------------------------------------------------------------------------

export interface RunOcrProgress {
  stage: "loading" | "rendering" | "ocr" | "done" | "error";
  message: string;
  currentPage?: number;
  totalPages?: number;
}

export async function runOcrOnPdf(
  drawing: DrawingFile,
  onProgress?: (p: RunOcrProgress) => void
): Promise<CreateDrawingOcrResultInput[]> {
  if (drawing.fileType !== "pdf") {
    throw new Error("OCR is only supported for PDF drawings.");
  }

  if (!isBrowserEnvironment()) {
    throw new Error("OCR requires a browser environment.");
  }

  onProgress?.({ stage: "loading", message: `Loading ${drawing.fileName}…` });

  let file: File;
  try {
    file = await resolveDrawingBlob(drawing);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load drawing file.";
    throw new Error(`Could not load PDF: ${message}`);
  }

  onProgress?.({ stage: "rendering", message: "Rendering PDF pages to images…" });

  const renderedPages = await renderPdfPagesToImages(file, { maxPages: MAX_OCR_PAGES });

  const results: CreateDrawingOcrResultInput[] = [];

  for (let i = 0; i < renderedPages.length; i++) {
    const page = renderedPages[i];
    onProgress?.({
      stage: "ocr",
      message: `Running OCR on page ${page.pageNumber}…`,
      currentPage: i + 1,
      totalPages: renderedPages.length,
    });

    const ocr = await runOcrOnPageImage(page.imageDataUrl);
    const pageFailed = ocr.text.trim().length === 0;
    const pageWarnings = [...ocr.warnings];
    if (pageFailed && !pageWarnings.some((w) => w.startsWith("OCR failed"))) {
      pageWarnings.unshift("OCR failed: no text recognized on this page.");
    }

    results.push({
      drawingId: drawing.id,
      projectId: drawing.projectId,
      pageNumber: page.pageNumber,
      imageDataUrl: page.imageDataUrl,
      extractedText: ocr.text,
      confidence: ocr.confidence,
      status: pageFailed ? "failed" : "completed",
      warnings: pageWarnings,
    });
  }

  onProgress?.({ stage: "done", message: "OCR complete." });
  return results;
}

/** True when at least one saved page has non-empty extracted text. */
export function ocrInputsHaveCompletedText(
  inputs: CreateDrawingOcrResultInput[]
): boolean {
  return inputs.some(
    (r) => r.status === "completed" && r.extractedText.trim().length > 0
  );
}

// ---------------------------------------------------------------------------
// 5. getBestAvailableTextForDrawing
// ---------------------------------------------------------------------------

export function getBestAvailableTextForDrawing(
  drawing: DrawingFile,
  pdfResult: PdfExtractionResult | null,
  ocrResults: DrawingOcrResult[]
): BestAvailableTextResult {
  const drawingOcr = ocrResults
    .filter((r) => r.drawingId === drawing.id && r.status === "completed")
    .sort((a, b) => a.pageNumber - b.pageNumber);

  const pdfText = pdfResult?.text?.trim() ?? "";
  const hasPdfText = pdfText.length >= 50 && !pdfResult?.isLikelyScanned;

  if (hasPdfText) {
    return {
      text: pdfText,
      source: "pdf_text",
      isScanned: false,
      needsOcr: false,
      ocrStatus: "not_needed",
      pageCount: pdfResult?.pageCount ?? 0,
      warnings: [],
    };
  }

  if (drawingOcr.length > 0) {
    const ocrText = drawingOcr
      .map((r) => r.extractedText)
      .filter(Boolean)
      .join("\n\n--- PAGE BREAK ---\n\n")
      .trim();

    const avgConfidence =
      drawingOcr.reduce((sum, r) => sum + (r.confidence ?? 0), 0) / drawingOcr.length;

    const warnings = [
      "Text extracted via OCR — verify all quantities manually.",
      ...drawingOcr.flatMap((r) => r.warnings),
    ];

    if (ocrText.length >= MIN_OCR_TEXT_LENGTH) {
      return {
        text: ocrText,
        source: "ocr_text",
        isScanned: true,
        needsOcr: false,
        ocrStatus: "completed",
        pageCount: drawingOcr.length,
        ocrConfidence: avgConfidence,
        warnings: [...new Set(warnings)],
      };
    }
  }

  // Scanned but no OCR yet
  const isScanned =
    pdfResult?.isLikelyScanned ||
    (pdfResult !== null && pdfText.length < 50) ||
    drawing.fileType === "pdf";

  return {
    text: pdfText,
    source: "none",
    isScanned: isScanned && drawing.fileType === "pdf",
    needsOcr: isScanned && drawing.fileType === "pdf",
    ocrStatus: isScanned ? "needed" : "not_needed",
    pageCount: pdfResult?.pageCount ?? 0,
    warnings: isScanned
      ? ["Scanned PDF — run OCR to extract text for analysis."]
      : [],
  };
}

// ---------------------------------------------------------------------------
// Helpers — OCR status from stored results
// ---------------------------------------------------------------------------

export function getOcrStatusForDrawing(
  drawing: DrawingFile,
  ocrResults: DrawingOcrResult[],
  pdfResult?: PdfExtractionResult | null
): OcrStatus {
  const drawingOcr = ocrResults.filter((r) => r.drawingId === drawing.id);

  if (drawing.fileType !== "pdf") return "not_needed";

  const hasPdfText =
    pdfResult &&
    pdfResult.text.trim().length >= 50 &&
    !pdfResult.isLikelyScanned;

  if (hasPdfText) return "not_needed";

  const completed = drawingOcr.filter(
    (r) => r.status === "completed" && r.extractedText.trim().length > 0
  );
  if (completed.length > 0) {
    return "completed";
  }

  const failed = drawingOcr.filter((r) => r.status === "failed");
  if (failed.length > 0 && completed.length === 0) return "failed";

  if (pdfResult?.isLikelyScanned || (pdfResult && pdfResult.text.trim().length < 50)) {
    return "needed";
  }

  // Scanned PDF (no text layer) — OCR needed when no store results yet
  if (!pdfResult && drawingOcr.length === 0) {
    return "not_needed";
  }

  return "not_needed";
}

/** True when the store has any OCR rows for this drawing. */
export function hasStoredOcrForDrawing(
  drawingId: string,
  ocrResults: DrawingOcrResult[]
): boolean {
  return ocrResults.some((r) => r.drawingId === drawingId);
}

/**
 * Prefer live OCR store results over stale analysis snapshot.
 * Used by Package Review UI after Run OCR without re-analysis.
 */
export function resolveDrawingOcrStatus(
  drawing: DrawingFile,
  ocrResults: DrawingOcrResult[],
  fromAnalysis?: OcrStatus
): OcrStatus {
  if (hasStoredOcrForDrawing(drawing.id, ocrResults)) {
    return getOcrStatusForDrawing(drawing, ocrResults);
  }
  return fromAnalysis ?? getOcrStatusForDrawing(drawing, ocrResults);
}

/** Count project drawings with completed OCR in the store. */
export function countOcrCompletedDrawings(
  drawings: DrawingFile[],
  ocrResults: DrawingOcrResult[]
): number {
  return drawings.filter(
    (d) => resolveDrawingOcrStatus(d, ocrResults) === "completed"
  ).length;
}

/** Cap confidence for OCR-sourced evidence — never high */
export function capOcrConfidence(
  confidence: "high" | "medium" | "low"
): "high" | "medium" | "low" {
  if (confidence === "high") return "medium";
  return confidence;
}

/** Apply OCR source tagging and confidence cap to extraction candidates */
export function applyOcrCandidateAdjustments<
  T extends { confidence: "high" | "medium" | "low"; sourceType: string; warnings: string[] }
>(candidates: T[]): T[] {
  return candidates.map((c) => ({
    ...c,
    sourceType: "ocr_text",
    confidence: capOcrConfidence(c.confidence),
    warnings: [
      ...c.warnings,
      "OCR extraction — verify manually before accepting.",
    ],
  }));
}

/** Build persisted OCR result records from create inputs */
export function toPersistedOcrResults(
  inputs: CreateDrawingOcrResultInput[]
): DrawingOcrResult[] {
  const now = new Date().toISOString();
  return inputs.map((input) => ({
    ...input,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  }));
}
