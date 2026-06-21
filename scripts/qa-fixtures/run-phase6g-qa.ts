/**
 * Phase 6G QA fixture — Measurement Extraction + Dimension Linking
 */

import type {
  AiVisualDetection,
  DrawingSheetRef,
  ReconciledElement,
  SystemCodeDetection,
  SystemDimensionDetection,
} from "../../src/types/drawing-intelligence";
import { linkMeasurementsToReconciledElements } from "../../src/services/drawing-intelligence/drawing-intelligence-measurement-linking.service";
import { buildSafeTakeoffDraftFromReconciled } from "../../src/services/drawing-intelligence/drawing-intelligence-candidate-action.service";

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
const PROJECT_ID = "proj-6g";

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
  rawText: string,
  widthM: number | null,
  heightM: number | null,
  detectionMethod: SystemDimensionDetection["detectionMethod"] = "nearby_dimension",
  nearbyCodeRef?: string,
  confidence: SystemDimensionDetection["confidence"] = "high"
): SystemDimensionDetection {
  return {
    id,
    sheet,
    rawText,
    widthM,
    heightM,
    lengthM: null,
    confidence,
    source: "pdf_text",
    detectionMethod,
    nearbyCodeRef,
    unit: "m",
    reason: "fixture",
    detectedAt: NOW,
  };
}

function makeAi(
  id: string,
  sheet: DrawingSheetRef,
  type: AiVisualDetection["detectionType"],
  width?: number
): AiVisualDetection {
  return {
    id,
    sheet,
    detectionType: type,
    aiConfidence: 0.8,
    estimatedWidthM: width,
    status: "possible",
    detectedAt: NOW,
  };
}

function makeElement(
  id: string,
  sheet: DrawingSheetRef,
  code?: string,
  status: ReconciledElement["matchStatus"] = "matched",
  ai?: AiVisualDetection
): ReconciledElement {
  return {
    id,
    sheet,
    matchStatus: status,
    confidence: "medium",
    systemCodeDetection: code
      ? {
          id: `sys-${id}`,
          sheet,
          rawText: code,
          normalizedCode: code,
          confidence: "high",
          source: "pdf_text",
          detectedAt: NOW,
        }
      : undefined,
    aiDetection: ai,
    flaggedIssues: [],
    reconciledAt: NOW,
  };
}

async function run() {
  const sheet = makeSheet("MEAS", 2);
  const codes = [makeCode("c1", sheet, "W-01"), makeCode("c2", sheet, "W-02"), makeCode("c3", sheet, "CW-03")];
  const dims: SystemDimensionDetection[] = [
    // Explicit code text pair
    makeDim("d1", sheet, "W-01 = 1.2 x 1.5", 1.2, 1.5, "text_pair", "W-01"),
    // Nearby dimension for W-02
    makeDim("d2", sheet, "900 x 1500", 0.9, 1.5, "nearby_dimension", "W-02"),
    // Schedule/table should win over nearby candidate
    makeDim("d3", sheet, "CW-03 schedule 1.4 x 2.8", 1.4, 2.8, "schedule", "CW-03"),
    makeDim("d4", sheet, "CW-03 nearby 1.1 x 2.2", 1.1, 2.2, "nearby_dimension", "CW-03"),
    // Suspicious noise
    makeDim("d5", sheet, "GRID A-20 x 5", 20, 5, "nearby_dimension", undefined, "medium"),
  ];

  const aiW01 = makeAi("ai-1", sheet, "possible_window", 1.18);
  const aiW02 = makeAi("ai-2", sheet, "possible_window", 0.95);
  const aiCW03 = makeAi("ai-3", sheet, "possible_curtain_wall", 1.5);
  const aiUnknown = makeAi("ai-4", sheet, "possible_uncoded_opening");

  const elements: ReconciledElement[] = [
    makeElement("e1", sheet, "W-01", "matched", aiW01),
    makeElement("e2", sheet, "W-02", "matched", aiW02),
    makeElement("e3", sheet, "CW-03", "matched", aiCW03),
    makeElement("e4", sheet, "W-99", "system_only"),
    makeElement("e5", sheet, undefined, "ai_only", aiUnknown),
  ];

  const linked = linkMeasurementsToReconciledElements({
    systemCodeDetections: codes,
    systemDimensionDetections: dims,
    aiDetections: [aiW01, aiW02, aiCW03, aiUnknown],
    reconciledElements: elements,
    sheetRefs: [sheet],
  });

  const byId = new Map(linked.elements.map((e) => [e.id, e]));

  // 6G-01 explicit W-01 1200x1500 links correctly
  check(
    "6G-01: W-01 explicit text-pair linked",
    "1.2x1.5",
    `${byId.get("e1")?.hintWidthM}x${byId.get("e1")?.hintHeightM}`,
    byId.get("e1")?.hintWidthM === 1.2 && byId.get("e1")?.hintHeightM === 1.5
  );

  // 6G-02 W-02 nearby 900x1500 links correctly
  check(
    "6G-02: W-02 nearby dimension linked",
    "0.9x1.5",
    `${byId.get("e2")?.hintWidthM}x${byId.get("e2")?.hintHeightM}`,
    byId.get("e2")?.hintWidthM === 0.9 && byId.get("e2")?.hintHeightM === 1.5
  );

  // 6G-03 schedule/table preferred
  check(
    "6G-03: schedule measurement preferred for CW-03",
    "1.4",
    String(byId.get("e3")?.hintWidthM),
    byId.get("e3")?.hintWidthM === 1.4
  );

  // 6G-04 random 20x5 rejected as suspicious
  const suspiciousFound = linked.suspicious.some((s) => s.rawText.includes("20 x 5"));
  check("6G-04: suspicious 20x5 flagged", "true", String(suspiciousFound), suspiciousFound);

  // 6G-05 no dimension found remains unresolved and flagged for Missing Info
  check(
    "6G-05: unresolved dimensions stay flagged with reason",
    "reason-present",
    byId.get("e4")?.unresolvedMeasurementReason ? "reason-present" : "missing",
    typeof byId.get("e4")?.unresolvedMeasurementReason === "string"
  );

  // 6G-06 conflict between linked system dimension and AI hint
  const aiConflictElement: ReconciledElement = makeElement("e6", sheet, "W-01", "matched", {
    ...aiW01,
    id: "ai-conflict",
    estimatedWidthM: 2.0, // >20% from 1.2
  });
  const conflictRes = linkMeasurementsToReconciledElements({
    systemCodeDetections: codes,
    systemDimensionDetections: dims,
    aiDetections: [aiW01],
    reconciledElements: [aiConflictElement],
    sheetRefs: [sheet],
  });
  check(
    "6G-06: AI/system width mismatch becomes conflict/needs_verification",
    "true",
    String(["conflict", "needs_verification"].includes(conflictRes.elements[0]?.matchStatus ?? "")),
    ["conflict", "needs_verification"].includes(conflictRes.elements[0]?.matchStatus ?? "")
  );

  // 6G-07 no final/verified quantity created from linked rows
  const aiOnlyDraft = buildSafeTakeoffDraftFromReconciled(byId.get("e5")!, PROJECT_ID).input;
  check(
    "6G-07: linked AI-only draft is never final/verified",
    "needs_verification",
    String(aiOnlyDraft?.status),
    aiOnlyDraft?.status === "needs_verification"
  );

  // 6G-08 existing 6F candidate creation uses linked safe dimensions
  const linkedDraft = buildSafeTakeoffDraftFromReconciled(byId.get("e1")!, PROJECT_ID).input;
  check(
    "6G-08: 6F draft uses linked dimensions",
    "1.2x1.5",
    `${linkedDraft?.width}x${linkedDraft?.height}`,
    linkedDraft?.width === 1.2 && linkedDraft?.height === 1.5
  );

  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.length - pass;
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  console.log("\n" + pad("Scenario", 64) + pad("Status", 10) + pad("Expected", 34) + "Actual");
  console.log("─".repeat(130));
  for (const row of rows) {
    const icon = row.status === "PASS" ? "✓" : "✗";
    console.log(
      pad(row.scenario, 64) +
        pad(`${icon} ${row.status}`, 10) +
        pad(row.expected, 34) +
        row.actual
    );
  }
  console.log(`\nPhase 6G QA: ${pass} passed, ${fail} failed out of ${rows.length} checks.\n`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Phase 6G QA fatal error:", err);
  process.exit(1);
});

