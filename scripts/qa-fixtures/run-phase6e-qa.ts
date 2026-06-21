/**
 * Phase 6E QA fixture — Drawing Intelligence UI Preview helpers
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
} from "../../src/services/drawing-intelligence/drawing-intelligence-integration.service";
import {
  actionPlaceholdersAreSafe,
  canRunDrawingIntelligence,
  computeDrawingIntelligenceStats,
  toDrawingIntelligenceRows,
} from "../../src/services/drawing-intelligence/drawing-intelligence-ui.utils";

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
const PROJECT_ID = "proj-6e";

function makeSheet(id: string, page = 1): DrawingSheetRef {
  return { drawingId: id, drawingName: `${id}.pdf`, sourceFormat: "pdf_text", page };
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
  w: number | null,
  h: number | null
): SystemDimensionDetection {
  return {
    id,
    sheet,
    rawText: `${w ?? "?"}x${h ?? "?"}`,
    widthM: w,
    heightM: h,
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
  confidence = 0.7
): AiVisualDetection {
  return {
    id,
    sheet,
    detectionType: type,
    aiConfidence: confidence,
    status: "possible",
    detectedAt: NOW,
  };
}

function makeSystem(sheet: DrawingSheetRef, code: string, w?: number, h?: number): SystemSheetEvidence {
  return {
    sheet,
    codeDetections: [makeCode(`code-${code}`, sheet, code)],
    dimensionDetections:
      typeof w === "number" || typeof h === "number"
        ? [makeDim(`dim-${code}`, sheet, w ?? null, h ?? null)]
        : [],
    dxfDetections: [],
  };
}

async function run() {
  const s1 = makeSheet("S1", 1);
  const integration = integrateAiSystemDrawingReconciliation({
    projectId: PROJECT_ID,
    systemEvidence: [makeSystem(s1, "W-01", 1.2, 1.5)],
    aiVisualDetectionResult: {
      detections: [
        { ...makeAi("ai-conflict", s1, "possible_window", 0.8), estimatedWidthM: 2.8 },
        makeAi("ai-uncoded", s1, "possible_uncoded_opening", 0.6),
      ],
      warnings: [],
    },
  });

  // 6E-01 status stats computed correctly
  const stats = computeDrawingIntelligenceStats(integration, 3, 2);
  check("6E-01: visual evidence count tracked", "3", String(stats.visualEvidenceCount), stats.visualEvidenceCount === 3);
  check("6E-01b: ai detection count tracked", "2", String(stats.aiDetectionCount), stats.aiDetectionCount === 2);
  check(
    "6E-01c: reconciled total equals status buckets",
    "true",
    String(stats.reconciledCount === stats.matched + stats.systemOnly + stats.aiOnly + stats.conflicts + stats.needsVerification),
    stats.reconciledCount === stats.matched + stats.systemOnly + stats.aiOnly + stats.conflicts + stats.needsVerification
  );

  // 6E-02 AI-only/uncoded remains needs_verification
  const statuses = integration.reconciliations.flatMap((r) => r.reconciledElements.map((e) => e.matchStatus));
  const hasNeedsVerification = statuses.includes("needs_verification");
  check("6E-02: AI uncoded opening remains needs_verification", "true", String(hasNeedsVerification), hasNeedsVerification);

  // 6E-03 conflict recommends resolve_conflict
  const rowsUi = toDrawingIntelligenceRows(integration.reconciliations);
  const hasResolveConflict = rowsUi.some((r) => r.status === "conflict" && r.recommendedAction === "resolve_conflict");
  check("6E-03: conflict row recommends resolve_conflict", "true", String(hasResolveConflict), hasResolveConflict);

  // 6E-04 UI/action helper safety (no verified/final actions)
  check(
    "6E-04: placeholder action helper remains safe",
    "true",
    String(actionPlaceholdersAreSafe()),
    actionPlaceholdersAreSafe() === true
  );

  // 6E-05 duplicate run guard helper
  const gateBusy = canRunDrawingIntelligence(true, "done");
  const gateIdle = canRunDrawingIntelligence(false, "idle");
  const gateReady = canRunDrawingIntelligence(false, "done");
  check("6E-05: guard blocks duplicate run", "false", String(gateBusy.allowed), gateBusy.allowed === false);
  check("6E-05b: guard blocks run before analysis done", "false", String(gateIdle.allowed), gateIdle.allowed === false);
  check("6E-05c: guard allows run when ready", "true", String(gateReady.allowed), gateReady.allowed === true);

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
  console.log(`\nPhase 6E QA: ${pass} passed, ${fail} failed out of ${rows.length} checks.\n`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Phase 6E QA fatal error:", err);
  process.exit(1);
});

