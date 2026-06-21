/**
 * AI-first quantity extraction MVP QA
 */

import { runAiFirstExtractPipeline } from "../../src/services/drawing-intelligence/ai-first-extract-quantities.service";
import { linkMeasurementsToReconciledElements } from "../../src/services/drawing-intelligence/drawing-intelligence-measurement-linking.service";
import {
  mapVisualFailureToExtractionStatus,
  toDrawingIntelligenceRows,
} from "../../src/services/drawing-intelligence/drawing-intelligence-ui.utils";
import { buildSafeTakeoffDraftFromReconciled } from "../../src/services/drawing-intelligence/drawing-intelligence-candidate-action.service";
import type { DrawingSheetRef, ReconciledElement } from "../../src/types/drawing-intelligence";

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

function sheet(page = 1): DrawingSheetRef {
  return {
    drawingId: "ai-first-sheet",
    drawingName: "AI-FIRST-01.pdf",
    sourceFormat: "pdf_text",
    page,
  };
}

function makeElement(overrides?: Partial<ReconciledElement>): ReconciledElement {
  const s = overrides?.sheet ?? sheet(1);
  return {
    id: overrides?.id ?? "el-1",
    sheet: s,
    matchStatus: overrides?.matchStatus ?? "matched",
    confidence: overrides?.confidence ?? "medium",
    systemCodeDetection: overrides?.systemCodeDetection,
    systemDimensionDetection: overrides?.systemDimensionDetection,
    aiDetection: overrides?.aiDetection,
    inferredType: overrides?.inferredType ?? "possible_window",
    hintWidthM: overrides?.hintWidthM,
    hintHeightM: overrides?.hintHeightM,
    flaggedIssues: overrides?.flaggedIssues ?? [],
    recommendedEstimatorAction: overrides?.recommendedEstimatorAction ?? "review_manually",
    linkedMeasurement: overrides?.linkedMeasurement,
    unresolvedMeasurementReason: overrides?.unresolvedMeasurementReason,
    measurementRejectedAsSuspicious: overrides?.measurementRejectedAsSuspicious,
    reconciledAt: NOW,
  };
}

async function run() {
  // 1) AI visual detections are created before system reconciliation
  const pipeline = await runAiFirstExtractPipeline({
    runAiVisual: async () => ({ detections: ["ai-window"] }),
    runSystemExtraction: async () => ({ evidence: ["system-code"] }),
    reconcile: async ({ ai, system }) => ({ aiCount: ai.detections.length, sysCount: system.evidence.length }),
  });
  check(
    "AIF-01: AI runs before system+reconcile",
    "ai_visual>system_extraction>reconciliation",
    pipeline.executionOrder.join(">"),
    pipeline.executionOrder.join(">") === "ai_visual>system_extraction>reconciliation"
  );

  // 2) AI-only window appears as needs_verification
  const aiOnly = makeElement({
    id: "ai-only-window",
    matchStatus: "ai_only",
    aiDetection: {
      id: "ai-1",
      sheet: sheet(1),
      detectionType: "possible_window",
      aiConfidence: 0.78,
      status: "possible",
      detectedAt: NOW,
    },
  });
  const aiOnlyRow = toDrawingIntelligenceRows([
    {
      sheet: sheet(1),
      reconciledElements: [aiOnly],
      stats: { matched: 0, systemOnly: 0, aiOnly: 1, conflicts: 0, needsVerification: 0, total: 1 },
      generatedAt: NOW,
    },
  ])[0];
  check(
    "AIF-02: ai_only row is needs_verification",
    "needs_verification",
    aiOnlyRow.extractionStatus,
    aiOnlyRow.extractionStatus === "needs_verification"
  );

  // 3) AI detected element with code links to system code if found
  const linkedCode = makeElement({
    id: "code-link",
    matchStatus: "matched",
    systemCodeDetection: {
      id: "sys-code-1",
      sheet: sheet(1),
      rawText: "W-01",
      normalizedCode: "W-01",
      confidence: "high",
      source: "pdf_text",
      detectedAt: NOW,
    },
    aiDetection: {
      id: "ai-2",
      sheet: sheet(1),
      detectionType: "possible_window",
      aiConfidence: 0.81,
      status: "possible",
      detectedAt: NOW,
    },
  });
  const linkedCodeRow = toDrawingIntelligenceRows([
    {
      sheet: sheet(1),
      reconciledElements: [linkedCode],
      stats: { matched: 1, systemOnly: 0, aiOnly: 0, conflicts: 0, needsVerification: 0, total: 1 },
      generatedAt: NOW,
    },
  ])[0];
  check("AIF-03: system code linked into row", "W-01", linkedCodeRow.code, linkedCodeRow.code === "W-01");

  // 4) system dimension without AI support is needs_verification
  const sysOnly = makeElement({
    id: "sys-only-dim",
    matchStatus: "system_only",
    systemCodeDetection: {
      id: "sys-code-2",
      sheet: sheet(2),
      rawText: "CW-03",
      normalizedCode: "CW-03",
      confidence: "high",
      source: "pdf_text",
      detectedAt: NOW,
    },
    systemDimensionDetection: {
      id: "sys-dim-2",
      sheet: sheet(2),
      rawText: "CW-03 1.2 x 2.5",
      widthM: 1.2,
      heightM: 2.5,
      lengthM: null,
      confidence: "high",
      source: "pdf_text",
      detectionMethod: "text_pair",
      nearbyCodeRef: "CW-03",
      detectedAt: NOW,
    },
  });
  const sysOnlyRow = toDrawingIntelligenceRows([
    {
      sheet: sheet(2),
      reconciledElements: [sysOnly],
      stats: { matched: 0, systemOnly: 1, aiOnly: 0, conflicts: 0, needsVerification: 0, total: 1 },
      generatedAt: NOW,
    },
  ])[0];
  check(
    "AIF-04: system-only row remains needs_verification",
    "needs_verification",
    sysOnlyRow.extractionStatus,
    sysOnlyRow.extractionStatus === "needs_verification"
  );

  // 5) random 20x5 is rejected
  const rejected20x5 = linkMeasurementsToReconciledElements({
    systemCodeDetections: [
      {
        id: "sys-code-3",
        sheet: sheet(3),
        rawText: "W-99",
        normalizedCode: "W-99",
        confidence: "high",
        source: "pdf_text",
        detectedAt: NOW,
      },
    ],
    systemDimensionDetections: [
      {
        id: "sys-dim-3",
        sheet: sheet(3),
        rawText: "GRID 20 x 5",
        widthM: 20,
        heightM: 5,
        lengthM: null,
        confidence: "medium",
        source: "pdf_text",
        detectionMethod: "text_pair",
        detectedAt: NOW,
      },
    ],
    aiDetections: [],
    reconciledElements: [
      makeElement({
        id: "reject-20x5",
        sheet: sheet(3),
        matchStatus: "matched",
        systemCodeDetection: {
          id: "sys-code-3",
          sheet: sheet(3),
          rawText: "W-99",
          normalizedCode: "W-99",
          confidence: "high",
          source: "pdf_text",
          detectedAt: NOW,
        },
      }),
    ],
    sheetRefs: [sheet(3)],
  }).elements[0];
  check(
    "AIF-05: random 20x5 rejected",
    "true",
    String(rejected20x5.measurementRejectedAsSuspicious === true),
    rejected20x5.measurementRejectedAsSuspicious === true
  );

  // 6) unsupported DWG returns conversion_required if not renderable
  const dwgStatus = mapVisualFailureToExtractionStatus("dwg");
  check("AIF-06: DWG failure maps to conversion_required", "conversion_required", dwgStatus, dwgStatus === "conversion_required");

  // 7) no final/verified quantity is created
  const draft = buildSafeTakeoffDraftFromReconciled(aiOnly, "proj-ai-first").input;
  check(
    "AIF-07: no final/verified quantity from AI-first flow",
    "needs_verification|draft",
    String(draft?.status),
    draft?.status !== "verified" && draft?.status !== "final"
  );

  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.length - pass;
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  console.log("\n" + pad("Scenario", 62) + pad("Status", 10) + pad("Expected", 34) + "Actual");
  console.log("─".repeat(128));
  for (const row of rows) {
    const icon = row.status === "PASS" ? "✓" : "✗";
    console.log(
      pad(row.scenario, 62) +
        pad(`${icon} ${row.status}`, 10) +
        pad(row.expected, 34) +
        row.actual
    );
  }
  console.log(`\nAI-first extraction QA: ${pass} passed, ${fail} failed out of ${rows.length} checks.\n`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error("AI-first extraction QA fatal error:", err);
  process.exit(1);
});

