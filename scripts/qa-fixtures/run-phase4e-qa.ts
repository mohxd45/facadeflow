/**
 * Phase 4E-B controlled QA — candidate-heavy cross-drawing workflow.
 *
 * Covers:
 *  - complete / missing / conflict / generic / OCR row states
 *  - filter counts and search behavior
 *  - default sorting priority
 *  - action outcomes (save needs verification, mark verified, send missing, reject)
 *
 * Run: npx tsx scripts/qa-fixtures/run-phase4e-qa.ts
 */

import {
  buildCrossDrawingQuantities,
  candidateIsVerifiable,
  getCandidateRowState,
} from "../../src/services/drawing-package/cross-drawing-quantity-builder.service";
import type {
  CrossDrawingBuildInput,
  CrossDrawingQuantityCandidate,
  TakeoffCandidateRef,
  EvidenceItemRef,
  ClassifiedDrawingRef,
  DrawingFileRef,
} from "../../src/types/cross-drawing-quantity";

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

function makeCandidateRef(
  overrides: Partial<TakeoffCandidateRef> & { _tempId: string }
): TakeoffCandidateRef {
  return {
    description: "Test item",
    category: "windows",
    unit: "sqm",
    confidence: "medium",
    warnings: [],
    rawSnippet: "",
    sourceType: "drawing_annotation",
    ...overrides,
  };
}

function makeEvidenceRef(
  drawingId: string,
  drawingName: string,
  candidates: TakeoffCandidateRef[],
  drawingType: EvidenceItemRef["drawingType"] = "plan",
  textSource: EvidenceItemRef["textSource"] = "pdf_text"
): EvidenceItemRef {
  return {
    drawingId,
    drawingName,
    drawingType,
    classificationConfidence: "medium",
    textSource,
    candidates,
  };
}

function makeClassifiedRef(
  drawingId: string,
  drawingType: ClassifiedDrawingRef["drawingType"] = "plan"
): ClassifiedDrawingRef {
  return { drawingId, drawingType, confidence: "medium" };
}

function makeDrawingRef(id: string, fileName: string): DrawingFileRef {
  return { id, fileName, fileType: "pdf" };
}

function sortByUiPriority(candidates: CrossDrawingQuantityCandidate[]) {
  const priority: Record<ReturnType<typeof getCandidateRowState>, number> = {
    verified_eligible: 0,
    conflict: 1,
    missing_info: 2,
    needs_verification: 3,
    generic: 4,
    ocr_verify: 5,
    rejected: 6,
  };
  const confRank: Record<"high" | "medium" | "low", number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  return [...candidates].sort((a, b) => {
    const stateDiff = priority[getCandidateRowState(a)] - priority[getCandidateRowState(b)];
    if (stateDiff !== 0) return stateDiff;
    const confDiff = confRank[a.confidence] - confRank[b.confidence];
    if (confDiff !== 0) return confDiff;
    return (a.normalizedItemCode || a.itemCode).localeCompare(b.normalizedItemCode || b.itemCode);
  });
}

function run() {
  // Complete high-confidence candidate (W-02)
  const w02Sched = makeCandidateRef({
    _tempId: "w02-sched",
    itemCode: "W-02",
    description: "Window W-02",
    confidence: "high",
    width: 1.2,
    height: 1.8,
    count: 4,
    sourceType: "drawing_annotation",
  });
  const w02Plan = makeCandidateRef({
    _tempId: "w02-plan",
    itemCode: "W-02",
    description: "Window W-02",
    confidence: "high",
    count: 4,
    sourceType: "drawing_annotation",
  });

  // Missing-info candidate (W-01) missing width/height/count
  const w01Missing = makeCandidateRef({
    _tempId: "w01-plan",
    itemCode: "W-01",
    description: "Window W-01",
    confidence: "medium",
  });

  // Conflict candidate (W-13) widths diverge by >1.5x
  const w13Sched = makeCandidateRef({
    _tempId: "w13-sched",
    itemCode: "W-13",
    description: "Window W-13",
    confidence: "high",
    width: 2.0,
    height: 2.2,
    count: 2,
  });
  const w13Elev = makeCandidateRef({
    _tempId: "w13-elev",
    itemCode: "W-13",
    description: "Window W-13",
    confidence: "high",
    width: 4.6,
    height: 2.2,
    count: 2,
  });

  // Generic candidate (SD)
  const sdGeneric = makeCandidateRef({
    _tempId: "sd-generic",
    itemCode: "SD",
    description: "Generic SD",
    confidence: "medium",
    width: 1.0,
    height: 2.2,
    count: 3,
  });

  // OCR verify candidate (W-03)
  const w03Ocr = makeCandidateRef({
    _tempId: "w03-ocr",
    itemCode: "W-03",
    description: "Window W-03 OCR",
    confidence: "medium",
    width: 1.1,
    height: 1.3,
    count: 2,
    sourceType: "ocr_text",
  });

  // Rejected-like candidate comes from applying reject action later
  const input: CrossDrawingBuildInput = {
    projectId: "qa-4e",
    drawings: [
      makeDrawingRef("d1", "Schedule.pdf"),
      makeDrawingRef("d2", "Plan.pdf"),
      makeDrawingRef("d3", "Elevation.pdf"),
      makeDrawingRef("d4", "OCR-Scan.pdf"),
    ],
    classifiedDrawings: [
      makeClassifiedRef("d1", "schedule"),
      makeClassifiedRef("d2", "plan"),
      makeClassifiedRef("d3", "elevation"),
      makeClassifiedRef("d4", "plan"),
    ],
    evidenceItems: [
      makeEvidenceRef("d1", "Schedule.pdf", [w02Sched], "schedule"),
      makeEvidenceRef("d2", "Plan.pdf", [w02Plan, w01Missing], "plan"),
      makeEvidenceRef("d1", "Schedule.pdf", [w13Sched], "schedule"),
      makeEvidenceRef("d3", "Elevation.pdf", [w13Elev, sdGeneric], "elevation"),
      makeEvidenceRef("d4", "OCR-Scan.pdf", [w03Ocr], "plan", "ocr_text"),
    ],
    drawingTakeoffCandidates: [],
    missingInfoItems: [],
  };

  const result = buildCrossDrawingQuantities(input);
  const candidates = result.candidates;

  check("4E-a candidate count", "5", String(candidates.length), candidates.length === 5);

  const byCode = (code: string) => candidates.find((c) => c.itemCode.includes(code));
  const w02 = byCode("W-02");
  const w01 = byCode("W-01");
  const w13 = byCode("W-13");
  const sd = candidates.find((c) => c.itemCode === "SD");
  const w03 = byCode("W-03");

  check("4E-b rowState W-02", "verified_eligible", w02 ? getCandidateRowState(w02) : "missing", !!w02 && getCandidateRowState(w02) === "verified_eligible");
  check("4E-c rowState W-01", "missing_info", w01 ? getCandidateRowState(w01) : "missing", !!w01 && getCandidateRowState(w01) === "missing_info");
  check("4E-d rowState W-13", "conflict", w13 ? getCandidateRowState(w13) : "missing", !!w13 && getCandidateRowState(w13) === "conflict");
  check("4E-e rowState SD", "generic", sd ? getCandidateRowState(sd) : "missing", !!sd && getCandidateRowState(sd) === "generic");
  check("4E-f rowState W-03", "ocr_verify", w03 ? getCandidateRowState(w03) : "missing", !!w03 && getCandidateRowState(w03) === "ocr_verify");

  // Filter counts
  const countByState = (state: ReturnType<typeof getCandidateRowState>) =>
    candidates.filter((c) => getCandidateRowState(c) === state).length;
  check("4E-g filter complete", "1", String(countByState("verified_eligible")), countByState("verified_eligible") === 1);
  check("4E-h filter missing_info", "1", String(countByState("missing_info")), countByState("missing_info") === 1);
  check("4E-i filter conflict", "1", String(countByState("conflict")), countByState("conflict") === 1);
  check("4E-j filter generic", "1", String(countByState("generic")), countByState("generic") === 1);
  check("4E-k filter ocr_verify", "1", String(countByState("ocr_verify")), countByState("ocr_verify") === 1);

  // Search by item code
  const searchW13 = candidates.filter((c) =>
    [c.itemCode, c.normalizedItemCode, c.description].join(" ").toLowerCase().includes("w-13")
  );
  check("4E-l search by item code", "1", String(searchW13.length), searchW13.length === 1);

  // Sorting order
  const sorted = sortByUiPriority(candidates);
  check(
    "4E-m default sort first row",
    "verified_eligible (W-02)",
    `${getCandidateRowState(sorted[0])} (${sorted[0].itemCode})`,
    getCandidateRowState(sorted[0]) === "verified_eligible"
  );

  // Simulate reject to verify rejected-last sorting
  const withRejected = [...candidates];
  const rejectIdx = withRejected.findIndex((c) => c.itemCode.includes("W-01"));
  if (rejectIdx >= 0) withRejected[rejectIdx] = { ...withRejected[rejectIdx], status: "rejected" };
  const sortedWithRejected = sortByUiPriority(withRejected);
  const last = sortedWithRejected[sortedWithRejected.length - 1];
  check("4E-n rejected rows sort last", "rejected", getCandidateRowState(last), getCandidateRowState(last) === "rejected");

  // Action outcomes
  const selected = candidates;
  const canVerify = selected.filter((c) => candidateIsVerifiable(c));
  const blockedVerify = selected.length - canVerify.length;
  check("4E-o mark verified allowed count", "1", String(canVerify.length), canVerify.length === 1);
  check("4E-p mark verified blocked count", "4", String(blockedVerify), blockedVerify === 4);

  const canSendToIssues = selected.filter((c) => c.missingFields.length > 0);
  check("4E-q send missing issues count", "2", String(canSendToIssues.length), canSendToIssues.length === 2);

  check("4E-r save as needs verification count", "5", String(selected.length), selected.length === 5);
}

run();

const total = rows.length;
const passed = rows.filter((r) => r.status === "PASS").length;
const failed = rows.filter((r) => r.status === "FAIL").length;

const colW = [34, 26, 44];
const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);

console.log("\n" + "─".repeat(116));
console.log(pad("Scenario", colW[0]) + pad("Expected", colW[1]) + pad("Actual", colW[2]) + "Status");
console.log("─".repeat(116));
for (const r of rows) {
  console.log(
    pad(r.scenario, colW[0]) +
      pad(r.expected, colW[1]) +
      pad(r.actual, colW[2]) +
      (r.status === "PASS" ? "✅ PASS" : "❌ FAIL")
  );
}
console.log("─".repeat(116));
console.log(`\nResults: ${passed}/${total} passed  |  ${failed} failed\n`);

if (failed > 0) {
  console.error("Phase 4E controlled QA: FAILED\n");
  process.exit(1);
} else {
  console.log("Phase 4E controlled QA: ALL PASS ✅\n");
}

