/**
 * File availability QA for AI Vision rendering
 */

import {
  getDrawingFileAvailabilityNote,
  getDrawingFileAvailabilityStatus,
} from "../../src/services/file/drawing-file-availability.service";
import { buildAiVisualReviewInput } from "../../src/services/drawing-intelligence/drawing-visual-evidence.service";
import type { DrawingFile } from "../../src/types/drawing";

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

function makeDrawing(overrides?: Partial<DrawingFile>): DrawingFile {
  return {
    id: overrides?.id ?? "d-1",
    projectId: overrides?.projectId ?? "proj-file-qa",
    fileName: overrides?.fileName ?? "A-101.pdf",
    fileType: overrides?.fileType ?? "pdf",
    fileSize: overrides?.fileSize ?? 1024 * 1024,
    drawingViewType: overrides?.drawingViewType ?? "plan",
    category: overrides?.category ?? "general",
    floorOrLocation: overrides?.floorOrLocation,
    uploadedAt: overrides?.uploadedAt ?? NOW,
    previewUrl: overrides?.previewUrl,
    storagePath: overrides?.storagePath,
    status: overrides?.status ?? "ready",
    notes: overrides?.notes,
    hasLocalBlob: overrides?.hasLocalBlob ?? false,
    errorMessage: overrides?.errorMessage,
  };
}

async function run() {
  const renderablePdf = makeDrawing({
    id: "pdf-available",
    fileName: "LIVE-ELEVATION.pdf",
    fileType: "pdf",
    hasLocalBlob: true,
    status: "ready",
  });
  check(
    "FA-01: newly uploaded PDF is file_available",
    "file_available",
    getDrawingFileAvailabilityStatus(renderablePdf),
    getDrawingFileAvailabilityStatus(renderablePdf) === "file_available"
  );

  const metadataOnlyPdf = makeDrawing({
    id: "pdf-metadata-only",
    fileName: "LEGACY-ELEVATION.pdf",
    fileType: "pdf",
    hasLocalBlob: false,
    previewUrl: undefined,
    storagePath: "queued/proj-file-qa/pdf-metadata-only/LEGACY-ELEVATION.pdf",
    status: "queued",
  });
  const metadataStatus = getDrawingFileAvailabilityStatus(metadataOnlyPdf);
  const metadataNote = getDrawingFileAvailabilityNote(metadataOnlyPdf);
  check(
    "FA-02: metadata-only drawing is flagged for re-upload",
    "metadata_only",
    metadataStatus,
    metadataStatus === "metadata_only"
  );
  check(
    "FA-02b: metadata-only note is explicit",
    "contains Re-upload required for AI Vision",
    metadataNote,
    metadataNote.includes("Re-upload required for AI Vision")
  );

  const visualInputWithMetadataOnly = await buildAiVisualReviewInput({
    projectId: "proj-file-qa",
    drawings: [metadataOnlyPdf],
    blobResolver: async () => {
      throw new Error("Should not attempt blob resolve for metadata-only drawing.");
    },
    pdfRenderer: async () => {
      throw new Error("Should not render metadata-only drawing.");
    },
  });
  check(
    "FA-03: metadata-only drawing is skipped with clear failure reason",
    "failure contains re-upload required",
    visualInputWithMetadataOnly.failures[0]?.reason ?? "missing",
    (visualInputWithMetadataOnly.failures[0]?.reason ?? "")
      .toLowerCase()
      .includes("re-upload required")
  );

  const visualInputWithPdf = await buildAiVisualReviewInput({
    projectId: "proj-file-qa",
    drawings: [renderablePdf],
    blobResolver: async () =>
      new File(["%PDF-1.7"], "LIVE-ELEVATION.pdf", { type: "application/pdf" }),
    pdfRenderer: async () => [
      {
        pageNumber: 1,
        imageDataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAtMB9qZ6nW0AAAAASUVORK5CYII=",
        width: 1600,
        height: 1200,
      },
    ],
  });
  check(
    "FA-04: renderable PDF produces at least one visual evidence image",
    ">= 1 evidence image",
    String(visualInputWithPdf.evidence.length),
    visualInputWithPdf.evidence.length >= 1
  );

  const dwg = makeDrawing({
    id: "dwg-1",
    fileName: "FACADE-RAW.dwg",
    fileType: "dwg",
    hasLocalBlob: true,
    status: "queued",
  });
  check(
    "FA-05: DWG returns conversion_required availability",
    "conversion_required",
    getDrawingFileAvailabilityStatus(dwg),
    getDrawingFileAvailabilityStatus(dwg) === "conversion_required"
  );

  const unsupported = {
    ...makeDrawing({
      id: "unsupported-1",
      fileName: "FACADE-NOTES.txt",
      fileType: "pdf",
      status: "uploaded",
      hasLocalBlob: false,
      previewUrl: undefined,
      storagePath: undefined,
    }),
    fileType: "txt",
  } as unknown as DrawingFile;
  check(
    "FA-06: unsupported file is classified safely",
    "unsupported_file",
    getDrawingFileAvailabilityStatus(unsupported),
    getDrawingFileAvailabilityStatus(unsupported) === "unsupported_file"
  );

  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.length - pass;
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  console.log("\n" + pad("Scenario", 68) + pad("Status", 10) + pad("Expected", 34) + "Actual");
  console.log("─".repeat(136));
  for (const row of rows) {
    const icon = row.status === "PASS" ? "✓" : "✗";
    console.log(
      pad(row.scenario, 68) +
        pad(`${icon} ${row.status}`, 10) +
        pad(row.expected, 34) +
        row.actual
    );
  }
  console.log(`\nFile availability QA: ${pass} passed, ${fail} failed out of ${rows.length} checks.\n`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error("File availability QA fatal error:", err);
  process.exit(1);
});
