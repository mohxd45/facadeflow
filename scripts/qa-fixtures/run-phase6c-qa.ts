/**
 * Phase 6C QA fixture — AI Visual Facade Element Detection
 */

import type {
  AiVisualReviewInput,
  DrawingVisualEvidence,
} from "../../src/types/drawing-intelligence";
import {
  runAiVisualDetection,
  aiVisualDetectionsAreAdvisoryOnly,
} from "../../src/services/drawing-intelligence/ai-visual-detection.service";

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

function makeEvidence(overrides?: Partial<DrawingVisualEvidence>): DrawingVisualEvidence {
  return {
    id: overrides?.id ?? "ev-1",
    projectId: overrides?.projectId ?? "proj-6c",
    sourceDrawingId: overrides?.sourceDrawingId ?? "drw-1",
    sourceDrawingName: overrides?.sourceDrawingName ?? "NORTH-ELEV.pdf",
    sourceFileType: overrides?.sourceFileType ?? "pdf",
    adapterKind: overrides?.adapterKind ?? "pdf",
    sheet: overrides?.sheet ?? {
      drawingId: "drw-1",
      drawingName: "NORTH-ELEV.pdf",
      sourceFormat: "pdf_text",
      page: 1,
    },
    imageDataUrl: overrides?.imageDataUrl ?? "data:image/jpeg;base64,AAA",
    image: overrides?.image ?? {
      mimeType: "image/jpeg",
      width: 1200,
      height: 900,
      approxBytes: 1024,
      quality: 0.72,
    },
    renderStatus: overrides?.renderStatus ?? "ready",
    warnings: overrides?.warnings ?? [],
    errorMessage: overrides?.errorMessage,
    createdAt: overrides?.createdAt ?? NOW,
  };
}

function makeInput(evidence: DrawingVisualEvidence[]): AiVisualReviewInput {
  return {
    projectId: "proj-6c",
    evidence,
    failures: [],
    limits: {
      maxPagesPerRun: 6,
      maxImageDimensionPx: 2400,
      imageQuality: 0.72,
    },
    generatedAt: NOW,
  };
}

async function run() {
  // 6C-01 valid AI visual detections parsed safely
  {
    const input = makeInput([makeEvidence()]);
    const result = await runAiVisualDetection(input, {
      env: { provider: "openai", apiKey: "x", model: "gpt-5-mini" },
      callOpenAiVision: async () =>
        JSON.stringify({
          summary: "Detected possible facade elements.",
          detections: [
            {
              evidenceId: "ev-1",
              detectionType: "possible_window",
              confidence: 0.83,
              note: "Likely window module.",
              region: { x: 0.1, y: 0.2, width: 0.15, height: 0.3 },
            },
          ],
          warnings: [],
        }),
    });
    check("6C-01: source=openai on valid response", "openai", result.runtimeMeta.source, result.runtimeMeta.source === "openai");
    check("6C-01b: 1 detection parsed", "1", String(result.detections.length), result.detections.length === 1);
    check(
      "6C-01c: detection status forced to possible",
      "possible",
      result.detections[0]?.status ?? "none",
      result.detections[0]?.status === "possible"
    );
  }

  // 6C-02 invalid JSON fallback
  {
    const input = makeInput([makeEvidence()]);
    const result = await runAiVisualDetection(input, {
      env: { provider: "openai", apiKey: "x" },
      callOpenAiVision: async () => "not-json",
    });
    check(
      "6C-02: invalid JSON falls back safely",
      "mock_fallback",
      result.runtimeMeta.source,
      result.runtimeMeta.source === "mock_fallback"
    );
  }

  // 6C-03 unknown detection type handled
  {
    const input = makeInput([makeEvidence()]);
    const result = await runAiVisualDetection(input, {
      env: { provider: "openai", apiKey: "x" },
      callOpenAiVision: async () =>
        JSON.stringify({
          summary: "Unknown class seen.",
          detections: [
            {
              evidenceId: "ev-1",
              detectionType: "possible_magic_facade",
              confidence: 0.4,
            },
          ],
        }),
    });
    check(
      "6C-03: unknown type converted to unknown_facade_element",
      "unknown_facade_element",
      result.detections[0]?.detectionType ?? "none",
      result.detections[0]?.detectionType === "unknown_facade_element"
    );
  }

  // 6C-04 AI-only detections cannot be verified/final
  {
    const input = makeInput([makeEvidence()]);
    const result = await runAiVisualDetection(input, {
      env: { provider: "openai", apiKey: "x" },
      callOpenAiVision: async () =>
        JSON.stringify({
          summary: "Window hint.",
          detections: [{ evidenceId: "ev-1", detectionType: "possible_window", confidence: 0.6 }],
        }),
    });
    check(
      "6C-04: detections remain advisory-only",
      "true",
      String(aiVisualDetectionsAreAdvisoryOnly(result.detections)),
      aiVisualDetectionsAreAdvisoryOnly(result.detections)
    );
  }

  // 6C-05 confidence clamping
  {
    const input = makeInput([makeEvidence()]);
    const result = await runAiVisualDetection(input, {
      env: { provider: "openai", apiKey: "x" },
      callOpenAiVision: async () =>
        JSON.stringify({
          summary: "Clamp test.",
          detections: [
            { evidenceId: "ev-1", detectionType: "possible_door", confidence: -2 },
            { evidenceId: "ev-1", detectionType: "possible_window", confidence: 1.7 },
          ],
        }),
    });
    const c1 = result.detections[0]?.aiConfidence ?? -1;
    const c2 = result.detections[1]?.aiConfidence ?? -1;
    check("6C-05: negative confidence clamps to 0", "0", String(c1), c1 === 0);
    check("6C-05b: >1 confidence clamps to 1", "1", String(c2), c2 === 1);
  }

  // 6C-06 no raw DXF/DWG sent to AI
  {
    const dxfUnsafe = makeEvidence({
      id: "ev-dxf",
      sourceFileType: "dxf",
      adapterKind: "dxf",
      imageDataUrl: "RAW_DXF_BINARY_PAYLOAD",
      sheet: {
        drawingId: "dxf-1",
        drawingName: "A-01.dxf",
        sourceFormat: "dxf",
        page: 1,
      },
    });
    const input = makeInput([dxfUnsafe]);
    const result = await runAiVisualDetection(input, {
      env: { provider: "openai", apiKey: "x" },
      callOpenAiVision: async () =>
        JSON.stringify({ summary: "Should not be called safely", detections: [] }),
    });
    check(
      "6C-06: unsafe raw CAD payload triggers mock_fallback",
      "mock_fallback",
      result.runtimeMeta.source,
      result.runtimeMeta.source === "mock_fallback"
    );
    const warned = result.warnings.some((w) => w.includes("Unsafe visual payload"));
    check("6C-06b: warning mentions unsafe CAD payload", "true", String(warned), warned);
  }

  // 6C-07 missing page references handled safely
  {
    const input = makeInput([
      makeEvidence({
        id: "ev-10",
        sourceDrawingId: "drw-10",
        sourceDrawingName: "ELEV-10.pdf",
        sheet: {
          drawingId: "drw-10",
          drawingName: "ELEV-10.pdf",
          sourceFormat: "pdf_text",
          page: 3,
        },
      }),
    ]);
    const result = await runAiVisualDetection(input, {
      env: { provider: "openai", apiKey: "x" },
      callOpenAiVision: async () =>
        JSON.stringify({
          summary: "Missing refs.",
          detections: [{ detectionType: "possible_railing", confidence: 0.5 }],
        }),
    });
    check("6C-07: detection is still created", "1", String(result.detections.length), result.detections.length === 1);
    check(
      "6C-07b: sheet page defaults from evidence when missing",
      "3",
      String(result.detections[0]?.sheet.page ?? -1),
      result.detections[0]?.sheet.page === 3
    );
  }

  // 6C-08 provider disabled fallback
  {
    const input = makeInput([makeEvidence()]);
    const result = await runAiVisualDetection(input, {
      env: { provider: "mock", apiKey: "" },
    });
    check("6C-08: provider mock uses mock source", "mock", result.runtimeMeta.source, result.runtimeMeta.source === "mock");
  }

  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.length - pass;
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  console.log("\n" + pad("Scenario", 58) + pad("Status", 10) + pad("Expected", 34) + "Actual");
  console.log("─".repeat(122));
  for (const row of rows) {
    const icon = row.status === "PASS" ? "✓" : "✗";
    console.log(
      pad(row.scenario, 58) +
        pad(`${icon} ${row.status}`, 10) +
        pad(row.expected, 34) +
        row.actual
    );
  }
  console.log(`\nPhase 6C QA: ${pass} passed, ${fail} failed out of ${rows.length} checks.\n`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Phase 6C QA fatal error:", err);
  process.exit(1);
});

