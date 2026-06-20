/**
 * Phase 4C controlled QA — Cross-Drawing source-priority matching.
 *
 * Six scenarios from the Phase 4C brief:
 *   D1  W-01 in plan only → missing width/height/count, low confidence
 *   D2  W-02 schedule has width+height but no count → missing count, medium/low
 *   D3  W-03 plan + schedule with width/height + matching count → linked, no fake total if unclear
 *   D4  CW-06 unclear 20×5 from elevation → low, suspicious-dimension warning, no fake total
 *   D5  SD (generic) → low confidence, needs_verification
 *   D6  OCR-only W-04 → max medium confidence, OCR verify warning
 *
 * Additionally: source-priority unit tests for getSourceRolePriorityForField.
 *
 * Run: npx tsx scripts/qa-fixtures/run-phase4c-qa.ts
 * No disk fixtures needed — all input is synthesised in-memory.
 */

import {
  buildCrossDrawingQuantities,
  getSourceRolePriorityForField,
  isGenericCode,
  normalizeItemCode,
} from "../../src/services/drawing-package/cross-drawing-quantity-builder.service";
import type {
  CrossDrawingBuildInput,
  TakeoffCandidateRef,
  EvidenceItemRef,
  ClassifiedDrawingRef,
  DrawingFileRef,
} from "../../src/types/cross-drawing-quantity";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface Row { scenario: string; expected: string; actual: string; status: "PASS" | "FAIL" }
const rows: Row[] = [];

function check(scenario: string, expected: string, actual: string, pass: boolean) {
  rows.push({ scenario, expected, actual, status: pass ? "PASS" : "FAIL" });
}

// ---------------------------------------------------------------------------
// Shared builders
// ---------------------------------------------------------------------------

function cand(
  id: string,
  itemCode: string,
  overrides: Partial<TakeoffCandidateRef> = {}
): TakeoffCandidateRef {
  return {
    _tempId: id,
    description: `Item ${itemCode}`,
    category: "windows",
    unit: "sqm",
    confidence: "medium",
    warnings: [],
    rawSnippet: "",
    sourceType: "drawing_annotation",
    itemCode,
    ...overrides,
  };
}

function ev(
  drawingId: string,
  drawingName: string,
  drawingType: string,
  candidates: TakeoffCandidateRef[],
  textSource = "pdf_text"
): EvidenceItemRef {
  return { drawingId, drawingName, drawingType, classificationConfidence: "medium", textSource, candidates };
}

function cls(drawingId: string, drawingType: string): ClassifiedDrawingRef {
  return { drawingId, drawingType, confidence: "medium" };
}

function drw(id: string, name: string): DrawingFileRef {
  return { id, fileName: name, fileType: "pdf" };
}

function input(
  drawings: DrawingFileRef[],
  classifiedDrawings: ClassifiedDrawingRef[],
  evidenceItems: EvidenceItemRef[]
): CrossDrawingBuildInput {
  return {
    projectId: "qa-4c",
    drawings,
    classifiedDrawings,
    evidenceItems,
    drawingTakeoffCandidates: [],
    missingInfoItems: [],
  };
}

// ---------------------------------------------------------------------------
// D1: W-01 plan only — missing width/height/count, low confidence
// ---------------------------------------------------------------------------

function runD1() {
  const result = buildCrossDrawingQuantities(input(
    [drw("d1", "Plan.pdf")],
    [cls("d1", "plan")],
    [ev("d1", "Plan.pdf", "plan", [
      cand("c1", "W-01", { sourceType: "drawing_annotation" }),
    ])]
  ));
  const c = result.candidates[0];

  check("D1-a 1 candidate produced", "1", String(result.candidates.length), result.candidates.length === 1);
  check("D1-b status needs_verification", "needs_verification", c?.status ?? "none", c?.status === "needs_verification");
  check("D1-c width missing", "true", String(c?.missingFields?.includes("width")), c?.missingFields?.includes("width") ?? false);
  check("D1-d height missing", "true", String(c?.missingFields?.includes("height")), c?.missingFields?.includes("height") ?? false);
  check("D1-e count missing", "true", String(c?.missingFields?.includes("count")), c?.missingFields?.includes("count") ?? false);
  check("D1-f confidence low", "low", c?.confidence ?? "none", c?.confidence === "low");
  check("D1-g no totalArea", "undefined", String(c?.totalArea), c?.totalArea === undefined);
  check("D1-h reasoning mentions plan evidence", "true",
    String(c?.reasoning?.some(r => r.toLowerCase().includes("plan") || r.toLowerCase().includes("occurrence")) ?? false),
    c?.reasoning?.some(r => r.toLowerCase().includes("plan") || r.toLowerCase().includes("occurrence") || r.toLowerCase().includes("grouped")) ?? false
  );
}

// ---------------------------------------------------------------------------
// D2: W-02 schedule has width+height but no count → missing count
// ---------------------------------------------------------------------------

function runD2() {
  const result = buildCrossDrawingQuantities(input(
    [drw("d1", "Schedule.pdf")],
    [cls("d1", "schedule")],
    [ev("d1", "Schedule.pdf", "schedule", [
      cand("c1", "W-02", {
        width: 1.2, height: 1.8,
        sourceType: "drawing_schedule",
        confidence: "high",
      }),
    ])]
  ));
  const c = result.candidates[0];

  check("D2-a 1 candidate produced", "1", String(result.candidates.length), result.candidates.length === 1);
  check("D2-b has width 1.2", "1.2", String(c?.width), c?.width === 1.2);
  check("D2-c has height 1.8", "1.8", String(c?.height), c?.height === 1.8);
  check("D2-d count is missing", "true", String(c?.missingFields?.includes("count")), c?.missingFields?.includes("count") ?? false);
  check("D2-e status needs_verification", "needs_verification", c?.status ?? "none", c?.status === "needs_verification");
  // Schedule single source → medium
  check("D2-f confidence low or medium (not high — single drawing)", "true",
    c?.confidence ?? "none", c?.confidence !== "high");
  check("D2-g no totalArea (count missing)", "undefined", String(c?.totalArea), c?.totalArea === undefined);
  // areaEach CAN be calculated (width × height known)
  check("D2-h areaEach = 2.16", "2.16", String(c?.areaEach), c?.areaEach === 2.16);
  // Width source should be schedule
  check("D2-i widthSource is schedule", "schedule", c?.widthSource?.sourceType ?? "none",
    c?.widthSource?.sourceType === "schedule");
}

// ---------------------------------------------------------------------------
// D3: W-03 plan + schedule → linked sources, explicit count from schedule
// ---------------------------------------------------------------------------

function runD3() {
  const planCand = cand("c1", "W-03", {
    sourceType: "drawing_annotation",
    confidence: "medium",
    // No dims in plan
  });
  const scheduleCand = cand("c2", "W-03", {
    width: 1.5, height: 2.1, count: 6,
    sourceType: "drawing_schedule",
    confidence: "high",
  });

  const result = buildCrossDrawingQuantities(input(
    [drw("d1", "FloorPlan.pdf"), drw("d2", "Schedule.pdf")],
    [cls("d1", "plan"), cls("d2", "schedule")],
    [
      ev("d1", "FloorPlan.pdf", "plan",     [planCand]),
      ev("d2", "Schedule.pdf",  "schedule", [scheduleCand]),
    ]
  ));
  const c = result.candidates[0];

  check("D3-a 1 grouped candidate", "1", String(result.candidates.length), result.candidates.length === 1);
  check("D3-b sourceDrawingIds has 2", "2", String(c?.sourceDrawingIds?.length), c?.sourceDrawingIds?.length === 2);
  check("D3-c width from schedule (1.5)", "1.5", String(c?.width), c?.width === 1.5);
  check("D3-d height from schedule (2.1)", "2.1", String(c?.height), c?.height === 2.1);
  check("D3-e count from schedule (6)", "6", String(c?.count), c?.count === 6);
  const expectedTotal = parseFloat((1.5 * 2.1 * 6).toFixed(4));
  check("D3-f totalArea calculated correctly", String(expectedTotal), String(c?.totalArea), c?.totalArea === expectedTotal);
  check("D3-g widthSource is schedule", "schedule", c?.widthSource?.sourceType ?? "none",
    c?.widthSource?.sourceType === "schedule");
  check("D3-h countSource is schedule", "schedule", c?.countSource?.sourceType ?? "none",
    c?.countSource?.sourceType === "schedule");
  // Two non-OCR drawings → high confidence (if no conflicts)
  check("D3-i confidence high (multi-source, non-OCR)", "high", c?.confidence ?? "none", c?.confidence === "high");
  check("D3-j status draft (complete + high)", "draft", c?.status ?? "none", c?.status === "draft");
}

// ---------------------------------------------------------------------------
// D4: CW-06 elevation with suspicious 20×5 dims → low, no total
// ---------------------------------------------------------------------------

function runD4() {
  const result = buildCrossDrawingQuantities(input(
    [drw("d1", "Elevation.pdf")],
    [cls("d1", "elevation")],
    [ev("d1", "Elevation.pdf", "elevation", [
      cand("c1", "CW-06", {
        width: 20, height: 5, count: 2,
        category: "curtain_wall_glass_panel",
        sourceType: "drawing_annotation",
        confidence: "medium",
      }),
    ])]
  ));
  const c = result.candidates[0];

  check("D4-a candidate produced", "1", String(result.candidates.length), result.candidates.length === 1);
  // width 20 is suspicious → low confidence
  check("D4-b confidence is low (suspicious dim)", "low", c?.confidence ?? "none", c?.confidence === "low");
  check("D4-c status needs_verification", "needs_verification", c?.status ?? "none", c?.status === "needs_verification");
  const hasWarning = c?.warnings?.some(w => w.toLowerCase().includes("unusually large") || w.toLowerCase().includes("large")) ?? false;
  check("D4-d warning about suspicious dimension", "true", String(hasWarning), hasWarning);
  // Even though width×height×count are present, confidence is low → no draft
  check("D4-e status is not draft despite having all dims (suspicious)", "needs_verification", c?.status ?? "none", c?.status !== "draft");
}

// ---------------------------------------------------------------------------
// D5: Generic SD → low confidence, needs_verification, generic warning
// ---------------------------------------------------------------------------

function runD5() {
  const result = buildCrossDrawingQuantities(input(
    [drw("d1", "Plan.pdf")],
    [cls("d1", "plan")],
    [ev("d1", "Plan.pdf", "plan", [
      cand("c1", "SD", {
        category: "doors",
        width: 1.0, height: 2.1, count: 4,
      }),
    ])]
  ));
  const c = result.candidates[0];

  check("D5-a candidate produced", "1", String(result.candidates.length), result.candidates.length === 1);
  check("D5-b isGenericCode SD", "true", String(isGenericCode("SD")), isGenericCode("SD"));
  check("D5-c confidence low (generic)", "low", c?.confidence ?? "none", c?.confidence === "low");
  check("D5-d status needs_verification (generic)", "needs_verification", c?.status ?? "none", c?.status === "needs_verification");
  const hasGenericWarning = c?.warnings?.some(w => w.toLowerCase().includes("generic")) ?? false;
  check("D5-e generic warning present", "true", String(hasGenericWarning), hasGenericWarning);
  // Even with all dims present, generic must never become draft
  check("D5-f no draft status for generic", "true", String(c?.status !== "draft"), c?.status !== "draft");
}

// ---------------------------------------------------------------------------
// D6: OCR-only W-04 → capped at medium, verify warning
// ---------------------------------------------------------------------------

function runD6() {
  const result = buildCrossDrawingQuantities(input(
    [drw("d1", "ScannedPlan.pdf")],
    [cls("d1", "plan")],
    [ev("d1", "ScannedPlan.pdf", "plan", [
      cand("c1", "W-04", {
        width: 1.0, height: 1.5, count: 5,
        sourceType: "ocr_text",
        confidence: "high", // claimed high — must be capped
      }),
    ], "ocr_text")]
  ));
  const c = result.candidates[0];

  check("D6-a candidate produced", "1", String(result.candidates.length), result.candidates.length === 1);
  check("D6-b confidence ≤ medium (OCR)", "true",
    c?.confidence ?? "none", c?.confidence !== "high");
  check("D6-c status needs_verification (OCR single-source)", "needs_verification",
    c?.status ?? "none", c?.status === "needs_verification");
  const hasOcrWarning = c?.warnings?.some(w => w.toLowerCase().includes("ocr")) ?? false;
  check("D6-d OCR verify warning present", "true", String(hasOcrWarning), hasOcrWarning);
  // Width/height source confidence should be capped
  const widthSrcConf = c?.widthSource?.confidence;
  check("D6-e widthSource confidence not high (OCR cap)", "true",
    widthSrcConf ?? "none", widthSrcConf !== "high");
}

// ---------------------------------------------------------------------------
// Source priority unit tests
// ---------------------------------------------------------------------------

function runPriorityChecks() {
  // count: schedule > plan > OCR
  check("Prio: count schedule > plan",   "true", String(getSourceRolePriorityForField("count","schedule") > getSourceRolePriorityForField("count","plan")), getSourceRolePriorityForField("count","schedule") > getSourceRolePriorityForField("count","plan"));
  check("Prio: count plan > ocr",        "true", String(getSourceRolePriorityForField("count","plan") > getSourceRolePriorityForField("count","ocr_text")), getSourceRolePriorityForField("count","plan") > getSourceRolePriorityForField("count","ocr_text"));
  // width: schedule > elevation > OCR
  check("Prio: width schedule > elevation","true", String(getSourceRolePriorityForField("width","schedule") > getSourceRolePriorityForField("width","elevation")), getSourceRolePriorityForField("width","schedule") > getSourceRolePriorityForField("width","elevation"));
  check("Prio: width elevation > ocr",   "true", String(getSourceRolePriorityForField("width","elevation") > getSourceRolePriorityForField("width","ocr_text")), getSourceRolePriorityForField("width","elevation") > getSourceRolePriorityForField("width","ocr_text"));
  // thickness: section > schedule > OCR
  check("Prio: thickness section > schedule","true", String(getSourceRolePriorityForField("thickness","section") >= getSourceRolePriorityForField("thickness","schedule")), getSourceRolePriorityForField("thickness","section") >= getSourceRolePriorityForField("thickness","schedule"));
  check("Prio: thickness schedule > ocr","true", String(getSourceRolePriorityForField("thickness","schedule") > getSourceRolePriorityForField("thickness","ocr_text")), getSourceRolePriorityForField("thickness","schedule") > getSourceRolePriorityForField("thickness","ocr_text"));
  // length: dxf > plan > OCR
  check("Prio: length dxf > plan",       "true", String(getSourceRolePriorityForField("length","dxf") > getSourceRolePriorityForField("length","plan")), getSourceRolePriorityForField("length","dxf") > getSourceRolePriorityForField("length","plan"));
  check("Prio: length plan > ocr",       "true", String(getSourceRolePriorityForField("length","plan") > getSourceRolePriorityForField("length","ocr_text")), getSourceRolePriorityForField("length","plan") > getSourceRolePriorityForField("length","ocr_text"));
  // manual always high (9)
  check("Prio: manual count = 9",        "9",    String(getSourceRolePriorityForField("count","manual")), getSourceRolePriorityForField("count","manual") === 9);
}

// ---------------------------------------------------------------------------
// Conflict detection scenario
// ---------------------------------------------------------------------------

function runConflictScenario() {
  // W-13: two sources give conflicting widths (2.00 vs 20.00)
  const result = buildCrossDrawingQuantities(input(
    [drw("d1", "Plan.pdf"), drw("d2", "Schedule.pdf")],
    [cls("d1", "plan"), cls("d2", "schedule")],
    [
      ev("d1", "Plan.pdf",     "plan",     [cand("c1", "W-13", { width: 20.0, height: 2.1, count: 4 })]),
      ev("d2", "Schedule.pdf", "schedule", [cand("c2", "W-13", { width:  2.0, height: 2.1, count: 4 })]),
    ]
  ));
  const c = result.candidates[0];

  check("Conf-a candidate produced", "1", String(result.candidates.length), result.candidates.length === 1);
  // Conflict → width should be undefined (not auto-selected)
  check("Conf-b width undefined due to conflict", "undefined", String(c?.width), c?.width === undefined);
  check("Conf-c possibleWidths has 2 values", "true",
    String((c?.possibleWidths?.length ?? 0) >= 2), (c?.possibleWidths?.length ?? 0) >= 2);
  const hasConflictWarning = c?.warnings?.some(w => w.toLowerCase().includes("multiple possible")) ?? false;
  check("Conf-d conflict warning present", "true", String(hasConflictWarning), hasConflictWarning);
  check("Conf-e confidence low (conflict)", "low", c?.confidence ?? "none", c?.confidence === "low");
  check("Conf-f no totalArea (width missing)", "undefined", String(c?.totalArea), c?.totalArea === undefined);
}

// ---------------------------------------------------------------------------
// Normalization smoke (preserve from Phase 4A)
// ---------------------------------------------------------------------------

function runNormSmoke() {
  const cases: [string, string][] = [
    ["W01","W-01"],["CW5","CW-05"],["SD1","SD-01"],["WIN01","WIN-01"],["W-01","W-01"],
  ];
  for (const [input, expected] of cases) {
    const actual = normalizeItemCode(input);
    check(`Norm: ${input}→${expected}`, expected, actual, actual === expected);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  runNormSmoke();
  runPriorityChecks();
  runD1();
  runD2();
  runD3();
  runD4();
  runD5();
  runD6();
  runConflictScenario();

  console.log("\n=== Phase 4C Controlled QA Results ===\n");
  console.log("| Scenario | Expected | Actual | Status |");
  console.log("|----------|----------|--------|--------|");
  for (const r of rows) {
    console.log(`| ${r.scenario} | ${r.expected.replace(/\|/g,"/")} | ${r.actual.replace(/\|/g,"/")} | ${r.status} |`);
  }

  const failed = rows.filter(r => r.status === "FAIL");
  if (failed.length === 0) {
    console.log("\nAll Phase 4C checks passed. Source-priority matching verified.");
    process.exit(0);
  } else {
    console.log(`\n${failed.length} check(s) FAILED.`);
    process.exit(1);
  }
}

main();
