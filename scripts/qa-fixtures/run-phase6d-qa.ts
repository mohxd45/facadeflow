/**
 * Phase 6D QA fixture — AI + System Drawing Reconciliation Integration
 */

import type {
  AiVisualDetection,
  DrawingSheetRef,
  SystemCodeDetection,
  SystemDimensionDetection,
  SystemSheetEvidence,
} from "../../src/types/drawing-intelligence";
import {
  integrateAiSystemDrawingReconciliation,
  aiOnlyReconciliationsCannotBeFinal,
  noSilentQuantityOverwriteFromAi,
} from "../../src/services/drawing-intelligence/drawing-intelligence-integration.service";

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
const PROJECT_ID = "proj-6d";

function makeSheet(drawingId: string, page = 1): DrawingSheetRef {
  return {
    drawingId,
    drawingName: `${drawingId}.pdf`,
    sourceFormat: "pdf_text",
    page,
  };
}

function makeCode(id: string, sheet: DrawingSheetRef, code: string): SystemCodeDetection {
  return {
    id,
    sheet,
    rawText: code,
    normalizedCode: code,
    confidence: "high",
    source: "pdf_text",
    detectedAt: NOW,
  };
}

function makeDim(
  id: string,
  sheet: DrawingSheetRef,
  widthM: number | null,
  heightM: number | null
): SystemDimensionDetection {
  return {
    id,
    sheet,
    rawText: `${widthM ?? "?"}x${heightM ?? "?"}`,
    widthM,
    heightM,
    lengthM: null,
    confidence: "high",
    source: "pdf_text",
    detectedAt: NOW,
  };
}

function makeAi(
  id: string,
  sheet: DrawingSheetRef,
  type: AiVisualDetection["detectionType"],
  conf = 0.7
): AiVisualDetection {
  return {
    id,
    sheet,
    detectionType: type,
    aiConfidence: conf,
    status: "possible",
    detectedAt: NOW,
  };
}

function makeSystemSheet(
  sheet: DrawingSheetRef,
  codes: SystemCodeDetection[],
  dims: SystemDimensionDetection[] = []
): SystemSheetEvidence {
  return {
    sheet,
    codeDetections: codes,
    dimensionDetections: dims,
    dxfDetections: [],
  };
}

function flattenStatuses(
  res: ReturnType<typeof integrateAiSystemDrawingReconciliation>
): string[] {
  return res.reconciliations.flatMap((r) => r.reconciledElements.map((e) => e.matchStatus));
}

async function run() {
  // 6D-01 system W1 + AI possible window match
  {
    const s = makeSheet("A1", 1);
    const result = integrateAiSystemDrawingReconciliation({
      projectId: PROJECT_ID,
      systemEvidence: [makeSystemSheet(s, [makeCode("c1", s, "W-01")], [makeDim("d1", s, 1.2, 1.5)])],
      aiVisualDetectionResult: { detections: [makeAi("a1", s, "possible_window", 0.8)], warnings: [] },
    });
    const statuses = flattenStatuses(result);
    check("6D-01: W1 + possible_window is matched", "matched", statuses[0] ?? "none", statuses[0] === "matched");
  }

  // 6D-02 AI possible W2 missed by system -> ai_only
  {
    const s = makeSheet("A2", 1);
    const result = integrateAiSystemDrawingReconciliation({
      projectId: PROJECT_ID,
      systemEvidence: [makeSystemSheet(s, [makeCode("c1", s, "W-01")])],
      aiVisualDetectionResult: { detections: [makeAi("a1", s, "possible_window", 0.75), makeAi("a2", s, "possible_window", 0.6)], warnings: [] },
    });
    const hasAiOnly = flattenStatuses(result).includes("ai_only");
    check("6D-02: unmatched AI window becomes ai_only", "true", String(hasAiOnly), hasAiOnly);
  }

  // 6D-03 system-only item remains system_only
  {
    const s = makeSheet("A3", 1);
    const result = integrateAiSystemDrawingReconciliation({
      projectId: PROJECT_ID,
      systemEvidence: [makeSystemSheet(s, [makeCode("c1", s, "CW-03")], [makeDim("d1", s, 2.0, 3.0)])],
      aiVisualDetectionResult: { detections: [], warnings: [] },
    });
    const statuses = flattenStatuses(result);
    check("6D-03: no AI counterpart remains system_only", "system_only", statuses[0] ?? "none", statuses[0] === "system_only");
  }

  // 6D-04 dimension mismatch becomes conflict
  {
    const s = makeSheet("A4", 1);
    const result = integrateAiSystemDrawingReconciliation({
      projectId: PROJECT_ID,
      systemEvidence: [makeSystemSheet(s, [makeCode("c1", s, "CW-06")], [makeDim("d1", s, 2.4, 3.0)])],
      aiVisualDetectionResult: {
        detections: [{ ...makeAi("a1", s, "possible_curtain_wall", 0.9), estimatedWidthM: 1.0 }],
        warnings: [],
      },
    });
    const statuses = flattenStatuses(result);
    check("6D-04: width mismatch is conflict", "conflict", statuses[0] ?? "none", statuses[0] === "conflict");
  }

  // 6D-05 uncoded AI opening becomes needs_verification
  {
    const s = makeSheet("A5", 1);
    const result = integrateAiSystemDrawingReconciliation({
      projectId: PROJECT_ID,
      systemEvidence: [makeSystemSheet(s, [makeCode("c1", s, "W-01")])],
      aiVisualDetectionResult: { detections: [makeAi("a1", s, "possible_uncoded_opening", 0.7)], warnings: [] },
    });
    const statuses = flattenStatuses(result);
    const hasNeedsVerification = statuses.includes("needs_verification");
    check("6D-05: uncoded AI opening -> needs_verification", "true", String(hasNeedsVerification), hasNeedsVerification);
  }

  // 6D-06 AI-only cannot verified/final
  {
    const s = makeSheet("A6", 1);
    const result = integrateAiSystemDrawingReconciliation({
      projectId: PROJECT_ID,
      systemEvidence: [makeSystemSheet(s, [])],
      aiVisualDetectionResult: { detections: [makeAi("a1", s, "unknown_facade_element", 0.3)], warnings: [] },
    });
    check(
      "6D-06: AI-only remains advisory",
      "true",
      String(aiOnlyReconciliationsCannotBeFinal(result.reconciliations)),
      aiOnlyReconciliationsCannotBeFinal(result.reconciliations) === true
    );
  }

  // 6D-07 no silent quantity overwrite
  {
    const s = makeSheet("A7", 1);
    const result = integrateAiSystemDrawingReconciliation({
      projectId: PROJECT_ID,
      systemEvidence: [makeSystemSheet(s, [makeCode("c1", s, "W-01")], [makeDim("d1", s, 1.8, 1.5)])],
      aiVisualDetectionResult: {
        detections: [{ ...makeAi("a1", s, "possible_window", 0.8), estimatedWidthM: 0.9, estimatedHeightM: 0.7 }],
        warnings: [],
      },
    });
    check(
      "6D-07: system dimensions are not silently overwritten by AI",
      "true",
      String(noSilentQuantityOverwriteFromAi(result.reconciliations)),
      noSilentQuantityOverwriteFromAi(result.reconciliations)
    );
  }

  // 6D-08 sheet/page references preserved
  {
    const s = makeSheet("A8", 3);
    const result = integrateAiSystemDrawingReconciliation({
      projectId: PROJECT_ID,
      systemEvidence: [makeSystemSheet(s, [makeCode("c1", s, "D-01")])],
      aiVisualDetectionResult: { detections: [makeAi("a1", s, "possible_door", 0.65)], warnings: [] },
    });
    const page = result.reconciliations[0]?.sheet.page ?? -1;
    check("6D-08: sheet page preserved", "3", String(page), page === 3);
  }

  // 6D-09 invalid/missing detection references handled safely
  {
    const fallbackSheet = makeSheet("A9", 2);
    const broken: AiVisualDetection = {
      ...makeAi("a-bad", fallbackSheet, "possible_window", 0.5),
      sheet: {
        drawingId: "",
        drawingName: "",
        sourceFormat: "pdf_text",
        page: 0,
      },
    };
    const result = integrateAiSystemDrawingReconciliation({
      projectId: PROJECT_ID,
      systemEvidence: [makeSystemSheet(fallbackSheet, [makeCode("c1", fallbackSheet, "W-01")])],
      aiVisualDetectionResult: { detections: [broken], warnings: [] },
      drawingSheets: [fallbackSheet],
    });
    const hasAnyReconciliation = result.reconciliations.length > 0;
    const page = result.reconciliations[0]?.sheet.page ?? -1;
    check("6D-09: invalid detection refs handled without crash", "true", String(hasAnyReconciliation), hasAnyReconciliation);
    check("6D-09b: invalid detection falls back to known sheet/page", "2", String(page), page === 2);
  }

  // 6D-10 recommended estimator action mapping exists for all elements
  {
    const s = makeSheet("A10", 1);
    const result = integrateAiSystemDrawingReconciliation({
      projectId: PROJECT_ID,
      systemEvidence: [makeSystemSheet(s, [makeCode("c1", s, "W-01")])],
      aiVisualDetectionResult: { detections: [makeAi("a1", s, "possible_window", 0.7)], warnings: [] },
    });
    const allHaveAction = result.reconciliations.every((sheet) =>
      sheet.reconciledElements.every((e) => Boolean(e.recommendedEstimatorAction))
    );
    check("6D-10: all reconciled rows get recommendedEstimatorAction", "true", String(allHaveAction), allHaveAction);
  }

  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.length - pass;
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  console.log("\n" + pad("Scenario", 60) + pad("Status", 10) + pad("Expected", 34) + "Actual");
  console.log("─".repeat(126));
  for (const row of rows) {
    const icon = row.status === "PASS" ? "✓" : "✗";
    console.log(
      pad(row.scenario, 60) +
        pad(`${icon} ${row.status}`, 10) +
        pad(row.expected, 34) +
        row.actual
    );
  }
  console.log(`\nPhase 6D QA: ${pass} passed, ${fail} failed out of ${rows.length} checks.\n`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Phase 6D QA fatal error:", err);
  process.exit(1);
});

