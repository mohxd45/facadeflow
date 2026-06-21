/**
 * Phase 6B QA fixture — Drawing Visual Evidence Pipeline
 *
 * Verifies safe visual input construction for AI vision review.
 * Deterministic: no browser rendering, no network, no repository I/O.
 */

import type { DrawingFile } from "../../src/types/drawing";
import type {
  VisualAdapter,
  VisualAdapterResult,
} from "../../src/services/drawing-intelligence/drawing-visual-evidence.service";
import {
  buildAiVisualReviewInput,
  visualEvidenceInputHasOnlyRenderedImages,
  visualPipelineCannotCreateFinalQuantityStatus,
} from "../../src/services/drawing-intelligence/drawing-visual-evidence.service";

interface Row {
  scenario: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL";
}
const rows: Row[] = [];

function check(scenario: string, expected: string, actual: string, pass: boolean) {
  rows.push({ scenario, expected, actual, status: pass ? "PASS" : "FAIL" });
}

const NOW = new Date().toISOString();
const PROJECT_ID = "proj-6b";

function makeDrawing(id: string, fileType: DrawingFile["fileType"], fileName?: string): DrawingFile {
  return {
    id,
    projectId: PROJECT_ID,
    fileName: fileName ?? `${id}.${fileType}`,
    fileType,
    fileSize: 100_000,
    drawingViewType: "elevation",
    category: "elevation",
    uploadedAt: NOW,
    status: "ready",
  };
}

function createMockAdapter(
  kind: VisualAdapter["kind"],
  supportsType: DrawingFile["fileType"],
  renderFn: (drawing: DrawingFile) => Promise<VisualAdapterResult>
): VisualAdapter {
  return {
    kind,
    supports(drawing) {
      return drawing.fileType === supportsType;
    },
    render(drawing) {
      return renderFn(drawing);
    },
  };
}

async function run() {
  // -------------------------------------------------------------------------
  // 6B-01: PDF evidence is created from rendered pages
  // -------------------------------------------------------------------------
  {
    const pdfDrawing = makeDrawing("pdf-1", "pdf", "A1.pdf");
    const pdfAdapter = createMockAdapter("pdf", "pdf", async () => ({
      ok: true,
      pages: [
        {
          pageOrView: 1,
          imageDataUrl: "data:image/jpeg;base64,AAAA",
          width: 1200,
          height: 900,
        },
        {
          pageOrView: 2,
          imageDataUrl: "data:image/jpeg;base64,BBBB",
          width: 1200,
          height: 900,
        },
      ],
      warnings: [],
    }));
    const dxfAdapter = createMockAdapter("dxf", "dxf", async () => ({
      ok: false,
      reason: "placeholder",
    }));
    const dwgAdapter = createMockAdapter("dwg", "dwg", async () => ({
      ok: false,
      reason: "placeholder",
    }));

    const out = await buildAiVisualReviewInput({
      projectId: PROJECT_ID,
      drawings: [pdfDrawing],
      adapters: [pdfAdapter, dxfAdapter, dwgAdapter],
      limits: { maxPagesPerRun: 5, maxImageDimensionPx: 2000, imageQuality: 0.7 },
    });

    check("6B-01: pdf pages become visual evidence rows", "2", String(out.evidence.length), out.evidence.length === 2);
    check("6B-01b: failures are empty for successful pdf", "0", String(out.failures.length), out.failures.length === 0);
    check(
      "6B-01c: evidence source type stays pdf",
      "pdf",
      out.evidence[0]?.sourceFileType ?? "none",
      out.evidence[0]?.sourceFileType === "pdf"
    );
  }

  // -------------------------------------------------------------------------
  // 6B-02: failed render is reported safely
  // -------------------------------------------------------------------------
  {
    const pdfDrawing = makeDrawing("pdf-fail", "pdf");
    const pdfAdapter = createMockAdapter("pdf", "pdf", async () => ({
      ok: false,
      reason: "render pipeline error",
    }));
    const out = await buildAiVisualReviewInput({
      projectId: PROJECT_ID,
      drawings: [pdfDrawing],
      adapters: [pdfAdapter],
      limits: { maxPagesPerRun: 3 },
    });

    check("6B-02: no evidence when render fails", "0", String(out.evidence.length), out.evidence.length === 0);
    check("6B-02b: one failure is captured", "1", String(out.failures.length), out.failures.length === 1);
    check(
      "6B-02c: failure status is failed",
      "failed",
      out.failures[0]?.renderStatus ?? "none",
      out.failures[0]?.renderStatus === "failed"
    );
  }

  // -------------------------------------------------------------------------
  // 6B-03: max pages per run is respected
  // -------------------------------------------------------------------------
  {
    const pdfDrawingA = makeDrawing("pdf-a", "pdf");
    const pdfDrawingB = makeDrawing("pdf-b", "pdf");
    const pdfAdapter = createMockAdapter("pdf", "pdf", async (drawing) => ({
      ok: true,
      pages: [1, 2, 3, 4].map((p) => ({
        pageOrView: p,
        imageDataUrl: `data:image/jpeg;base64,${drawing.id}-${p}`,
        width: 1000,
        height: 800,
      })),
      warnings: [],
    }));

    const out = await buildAiVisualReviewInput({
      projectId: PROJECT_ID,
      drawings: [pdfDrawingA, pdfDrawingB],
      adapters: [pdfAdapter],
      limits: { maxPagesPerRun: 3, maxImageDimensionPx: 2000 },
    });

    check("6B-03: evidence is capped by maxPagesPerRun", "3", String(out.evidence.length), out.evidence.length === 3);
    const hasLimitFailure = out.failures.some((f) => f.reason.includes("Global page limit reached"));
    check("6B-03b: limit overflow is recorded as safe failure", "true", String(hasLimitFailure), hasLimitFailure);
  }

  // -------------------------------------------------------------------------
  // 6B-04: oversized images are skipped safely
  // -------------------------------------------------------------------------
  {
    const pdfDrawing = makeDrawing("pdf-oversized", "pdf");
    const pdfAdapter = createMockAdapter("pdf", "pdf", async () => ({
      ok: true,
      pages: [
        {
          pageOrView: 1,
          imageDataUrl: "data:image/jpeg;base64,SMALL",
          width: 1500,
          height: 1100,
        },
        {
          pageOrView: 2,
          imageDataUrl: "data:image/jpeg;base64,HUGE",
          width: 5000,
          height: 5000,
        },
      ],
      warnings: [],
    }));

    const out = await buildAiVisualReviewInput({
      projectId: PROJECT_ID,
      drawings: [pdfDrawing],
      adapters: [pdfAdapter],
      limits: { maxPagesPerRun: 5, maxImageDimensionPx: 2400 },
    });

    check("6B-04: only safe-size page is kept", "1", String(out.evidence.length), out.evidence.length === 1);
    const oversizedSkipped = out.failures.some((f) => f.reason.includes("Image dimensions exceed safe limit"));
    check("6B-04b: oversized page is skipped with reason", "true", String(oversizedSkipped), oversizedSkipped);
  }

  // -------------------------------------------------------------------------
  // 6B-05: DXF/DWG raw files are not sent as AI images
  // -------------------------------------------------------------------------
  {
    const dxf = makeDrawing("dxf-1", "dxf");
    const dwg = makeDrawing("dwg-1", "dwg");

    const dxfPlaceholder = createMockAdapter("dxf", "dxf", async () => ({
      ok: false,
      reason: "DXF visual adapter placeholder: render a view/snapshot first; raw DXF is not sent to AI.",
    }));
    const dwgPlaceholder = createMockAdapter("dwg", "dwg", async () => ({
      ok: false,
      reason: "DWG visual adapter placeholder: conversion/render required before AI visual review.",
    }));

    const out = await buildAiVisualReviewInput({
      projectId: PROJECT_ID,
      drawings: [dxf, dwg],
      adapters: [dxfPlaceholder, dwgPlaceholder],
      limits: { maxPagesPerRun: 4 },
    });

    check("6B-05: no raw dxf/dwg evidence entries are emitted", "0", String(out.evidence.length), out.evidence.length === 0);
    check("6B-05b: two placeholder failures are recorded", "2", String(out.failures.length), out.failures.length === 2);
    const reasonsContainRawGuard = out.failures.every(
      (f) => f.reason.includes("placeholder") || f.reason.includes("required")
    );
    check("6B-05c: failures explain render/conversion requirement", "true", String(reasonsContainRawGuard), reasonsContainRawGuard);
  }

  // -------------------------------------------------------------------------
  // 6B-06: output remains safe for AI Vision input
  // -------------------------------------------------------------------------
  {
    const pdfDrawing = makeDrawing("pdf-safe", "pdf");
    const pdfAdapter = createMockAdapter("pdf", "pdf", async () => ({
      ok: true,
      pages: [
        { pageOrView: 1, imageDataUrl: "data:image/png;base64,ABC", width: 900, height: 700 },
      ],
      warnings: [],
    }));
    const out = await buildAiVisualReviewInput({
      projectId: PROJECT_ID,
      drawings: [pdfDrawing],
      adapters: [pdfAdapter],
    });
    check(
      "6B-06: visualEvidenceInputHasOnlyRenderedImages",
      "true",
      String(visualEvidenceInputHasOnlyRenderedImages(out)),
      visualEvidenceInputHasOnlyRenderedImages(out)
    );
    check(
      "6B-06b: no quantity finalization helper remains true",
      "true",
      String(visualPipelineCannotCreateFinalQuantityStatus()),
      visualPipelineCannotCreateFinalQuantityStatus() === true
    );
  }

  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.length - pass;

  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  console.log(
    "\n" + pad("Scenario", 58) + pad("Status", 10) + pad("Expected", 32) + "Actual"
  );
  console.log("─".repeat(120));
  for (const row of rows) {
    const icon = row.status === "PASS" ? "✓" : "✗";
    console.log(
      pad(row.scenario, 58) +
        pad(`${icon} ${row.status}`, 10) +
        pad(row.expected, 32) +
        row.actual
    );
  }
  console.log(`\nPhase 6B QA: ${pass} passed, ${fail} failed out of ${rows.length} checks.\n`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Phase 6B QA fatal error:", err);
  process.exit(1);
});

