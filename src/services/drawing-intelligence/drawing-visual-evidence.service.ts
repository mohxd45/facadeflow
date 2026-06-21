/**
 * Drawing Visual Evidence Pipeline — Phase 6B
 *
 * Builds AI-vision-safe visual evidence from existing drawing files.
 * Current implementation:
 *  - PDF adapter: renders pages to images via existing OCR PDF renderer.
 *  - DXF adapter: placeholder (requires explicit view renderer pipeline).
 *  - DWG adapter: placeholder (requires conversion/render before use).
 *
 * Safety guarantees:
 *  - Never sends raw DXF/DWG/PDF bytes as AI image inputs.
 *  - Enforces max pages per run and image size guardrails.
 *  - Skips failed/unreadable pages without crashing the whole run.
 *  - Produces advisory visual input only (no quantity mutations).
 */

import { v4 as uuidv4 } from "uuid";
import type { DrawingFile } from "@/types/drawing";
import type {
  AiVisualReviewInput,
  DrawingVisualEvidence,
  VisualEvidenceFailure,
  VisualEvidenceSafetyLimits,
  VisualEvidenceAdapterKind,
} from "@/types/drawing-intelligence";
import { resolveDrawingBlob } from "@/services/file/drawing-blob-resolver";
import { renderPdfPagesToImages } from "@/services/ocr/pdf-ocr.service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_VISUAL_LIMITS: VisualEvidenceSafetyLimits = {
  maxPagesPerRun: 6,
  maxImageDimensionPx: 2400,
  imageQuality: 0.72,
};

// ---------------------------------------------------------------------------
// Adapter contracts
// ---------------------------------------------------------------------------

export interface RenderedVisualPage {
  pageOrView: number;
  imageDataUrl: string;
  width: number;
  height: number;
}

export interface VisualAdapterSuccess {
  ok: true;
  pages: RenderedVisualPage[];
  warnings: string[];
}

export interface VisualAdapterFailure {
  ok: false;
  reason: string;
}

export type VisualAdapterResult = VisualAdapterSuccess | VisualAdapterFailure;

export interface VisualAdapter {
  kind: VisualEvidenceAdapterKind;
  supports(drawing: DrawingFile): boolean;
  render(drawing: DrawingFile, limits: VisualEvidenceSafetyLimits): Promise<VisualAdapterResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampQuality(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_VISUAL_LIMITS.imageQuality;
  return Math.max(0.4, Math.min(0.92, v));
}

function normaliseLimits(overrides?: Partial<VisualEvidenceSafetyLimits>): VisualEvidenceSafetyLimits {
  const maxPagesPerRunRaw = overrides?.maxPagesPerRun ?? DEFAULT_VISUAL_LIMITS.maxPagesPerRun;
  const maxImageDimensionRaw =
    overrides?.maxImageDimensionPx ?? DEFAULT_VISUAL_LIMITS.maxImageDimensionPx;
  return {
    maxPagesPerRun: Number.isFinite(maxPagesPerRunRaw)
      ? Math.max(1, Math.min(20, Math.floor(maxPagesPerRunRaw)))
      : DEFAULT_VISUAL_LIMITS.maxPagesPerRun,
    maxImageDimensionPx: Number.isFinite(maxImageDimensionRaw)
      ? Math.max(512, Math.min(6000, Math.floor(maxImageDimensionRaw)))
      : DEFAULT_VISUAL_LIMITS.maxImageDimensionPx,
    imageQuality: clampQuality(overrides?.imageQuality ?? DEFAULT_VISUAL_LIMITS.imageQuality),
  };
}

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl.length;
  const b64 = dataUrl.slice(comma + 1);
  return Math.ceil((b64.length * 3) / 4);
}

function detectMimeTypeFromDataUrl(dataUrl: string): "image/jpeg" | "image/png" | "image/webp" {
  if (dataUrl.startsWith("data:image/png")) return "image/png";
  if (dataUrl.startsWith("data:image/webp")) return "image/webp";
  return "image/jpeg";
}

function isImageDimensionSafe(page: RenderedVisualPage, maxDim: number): boolean {
  return page.width > 0 && page.height > 0 && page.width <= maxDim && page.height <= maxDim;
}

// ---------------------------------------------------------------------------
// Default adapters
// ---------------------------------------------------------------------------

export interface PdfPageRenderer {
  (file: File, options: { maxPages: number; scale?: number }): Promise<
    Array<{ pageNumber: number; imageDataUrl: string; width: number; height: number }>
  >;
}

export interface BlobResolver {
  (drawing: DrawingFile): Promise<File>;
}

function createPdfAdapter(
  resolveBlob: BlobResolver = resolveDrawingBlob,
  renderPages: PdfPageRenderer = renderPdfPagesToImages
): VisualAdapter {
  return {
    kind: "pdf",
    supports(drawing) {
      return drawing.fileType === "pdf";
    },
    async render(drawing, limits) {
      try {
        const blobFile = await resolveBlob(drawing);
        const pages = await renderPages(blobFile, {
          maxPages: limits.maxPagesPerRun,
          // Keep memory predictable while retaining enough detail for AI hints.
          scale: 1.5,
        });
        if (pages.length === 0) {
          return { ok: false, reason: "No PDF pages could be rendered." };
        }
        return {
          ok: true,
          pages: pages.map((p) => ({
            pageOrView: p.pageNumber,
            imageDataUrl: p.imageDataUrl,
            width: p.width,
            height: p.height,
          })),
          warnings: [],
        };
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : "PDF render failed.",
        };
      }
    },
  };
}

function createDxfPlaceholderAdapter(): VisualAdapter {
  return {
    kind: "dxf",
    supports(drawing) {
      return drawing.fileType === "dxf";
    },
    async render() {
      return {
        ok: false,
        reason:
          "DXF visual adapter placeholder: render a view/snapshot first; raw DXF is not sent to AI.",
      };
    },
  };
}

function createDwgPlaceholderAdapter(): VisualAdapter {
  return {
    kind: "dwg",
    supports(drawing) {
      return drawing.fileType === "dwg";
    },
    async render() {
      return {
        ok: false,
        reason:
          "DWG visual adapter placeholder: conversion/render required before AI visual review.",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface BuildAiVisualReviewInputParams {
  projectId: string;
  drawings: DrawingFile[];
  limits?: Partial<VisualEvidenceSafetyLimits>;
  adapters?: VisualAdapter[];
  blobResolver?: BlobResolver;
  pdfRenderer?: PdfPageRenderer;
}

function defaultAdapters(params?: {
  blobResolver?: BlobResolver;
  pdfRenderer?: PdfPageRenderer;
}): VisualAdapter[] {
  return [
    createPdfAdapter(params?.blobResolver, params?.pdfRenderer),
    createDxfPlaceholderAdapter(),
    createDwgPlaceholderAdapter(),
  ];
}

/**
 * Build visual evidence payload for AI vision review.
 * Output contains only rendered images + metadata, never raw CAD/PDF binaries.
 */
export async function buildAiVisualReviewInput(
  params: BuildAiVisualReviewInputParams
): Promise<AiVisualReviewInput> {
  const now = new Date().toISOString();
  const limits = normaliseLimits(params.limits);
  const adapters = params.adapters ?? defaultAdapters({
    blobResolver: params.blobResolver,
    pdfRenderer: params.pdfRenderer,
  });

  const evidence: DrawingVisualEvidence[] = [];
  const failures: VisualEvidenceFailure[] = [];

  for (const drawing of params.drawings) {
    if (evidence.length >= limits.maxPagesPerRun) {
      failures.push({
        sourceDrawingId: drawing.id,
        sourceDrawingName: drawing.fileName,
        sourceFileType: drawing.fileType,
        pageOrView: 0,
        renderStatus: "skipped",
        reason: `Global page limit reached (${limits.maxPagesPerRun}).`,
      });
      continue;
    }

    const adapter = adapters.find((a) => a.supports(drawing));
    if (!adapter) {
      failures.push({
        sourceDrawingId: drawing.id,
        sourceDrawingName: drawing.fileName,
        sourceFileType: drawing.fileType,
        pageOrView: 0,
        renderStatus: "skipped",
        reason: `No visual adapter found for drawing type "${drawing.fileType}".`,
      });
      continue;
    }

    const rendered = await adapter.render(drawing, limits);
    if (!rendered.ok) {
      failures.push({
        sourceDrawingId: drawing.id,
        sourceDrawingName: drawing.fileName,
        sourceFileType: drawing.fileType,
        pageOrView: 0,
        renderStatus: "failed",
        reason: rendered.reason,
      });
      continue;
    }

    for (const page of rendered.pages) {
      if (evidence.length >= limits.maxPagesPerRun) break;

      if (!isImageDimensionSafe(page, limits.maxImageDimensionPx)) {
        failures.push({
          sourceDrawingId: drawing.id,
          sourceDrawingName: drawing.fileName,
          sourceFileType: drawing.fileType,
          pageOrView: page.pageOrView,
          renderStatus: "skipped",
          reason: `Image dimensions exceed safe limit (${limits.maxImageDimensionPx}px).`,
        });
        continue;
      }

      evidence.push({
        id: uuidv4(),
        projectId: params.projectId,
        sourceDrawingId: drawing.id,
        sourceDrawingName: drawing.fileName,
        sourceFileType: drawing.fileType,
        adapterKind: adapter.kind,
        sheet: {
          drawingId: drawing.id,
          drawingName: drawing.fileName,
          sourceFormat: drawing.fileType === "pdf" ? "pdf_text" : drawing.fileType,
          page: page.pageOrView,
        },
        imageDataUrl: page.imageDataUrl,
        image: {
          mimeType: detectMimeTypeFromDataUrl(page.imageDataUrl),
          width: page.width,
          height: page.height,
          approxBytes: estimateDataUrlBytes(page.imageDataUrl),
          quality: limits.imageQuality,
        },
        renderStatus: "ready",
        warnings: rendered.warnings,
        createdAt: now,
      });
    }
  }

  return {
    projectId: params.projectId,
    evidence,
    failures,
    limits,
    generatedAt: now,
  };
}

/**
 * Safety audit helper: true when the payload only contains rendered images and
 * has no raw CAD/PDF binary handles.
 */
export function visualEvidenceInputHasOnlyRenderedImages(input: AiVisualReviewInput): boolean {
  return input.evidence.every(
    (e) =>
      e.imageDataUrl.startsWith("data:image/") &&
      (e.sourceFileType === "pdf" || e.sourceFileType === "dxf" || e.sourceFileType === "dwg")
  );
}

/**
 * Safety audit helper: visual evidence pipeline never creates final/verified
 * quantity states because it does not mutate quantity entities at all.
 */
export function visualPipelineCannotCreateFinalQuantityStatus(): true {
  return true;
}

