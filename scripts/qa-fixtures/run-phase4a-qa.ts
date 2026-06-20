/**
 * Phase 4A controlled QA — Cross-Drawing Quantity Builder (service skeleton).
 *
 * Tests the four core scenarios specified in the Phase 4A brief:
 *   C1  W-01 without dimensions → needs_verification, missing width/height/count
 *   C2  W-02 with width, height, count → totalArea calculated correctly
 *   C3  Generic "SD" code → generic warning, needs_verification
 *   C4  OCR-sourced evidence → confidence capped at medium
 *
 * Run: npx tsx scripts/qa-fixtures/run-phase4a-qa.ts
 *
 * Requires NO fixtures on disk — all input is synthesised in-memory.
 */

import {
  buildCrossDrawingQuantities,
  normalizeItemCode,
  isGenericCode,
  scoreCrossDrawingConfidence,
  summarizeCrossDrawingBuild,
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

interface Row {
  scenario: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL";
}

const rows: Row[] = [];

function check(
  scenario: string,
  expected: string,
  actual: string,
  pass: boolean
) {
  rows.push({ scenario, expected, actual, status: pass ? "PASS" : "FAIL" });
}

// ---------------------------------------------------------------------------
// Shared evidence builder
// ---------------------------------------------------------------------------

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
  textSource = "pdf_text"
): EvidenceItemRef {
  return {
    drawingId,
    drawingName,
    drawingType: "plan",
    classificationConfidence: "medium",
    textSource,
    candidates,
  };
}

function makeClassifiedRef(
  drawingId: string,
  drawingType = "plan"
): ClassifiedDrawingRef {
  return {
    drawingId,
    drawingType,
    confidence: "medium",
  };
}

function makeDrawingRef(id: string, fileName: string): DrawingFileRef {
  return { id, fileName, fileType: "pdf" };
}

// ---------------------------------------------------------------------------
// Scenario C1: W-01 without dimensions → needs_verification + missing fields
// ---------------------------------------------------------------------------

function runC1() {
  const cand = makeCandidateRef({
    _tempId: "c1-cand-1",
    itemCode: "W-01",
    description: "Aluminium window type W-01",
    // NO width, height, count
  });

  const input: CrossDrawingBuildInput = {
    projectId: "qa-proj",
    drawings: [makeDrawingRef("d1", "FloorPlan.pdf")],
    classifiedDrawings: [makeClassifiedRef("d1")],
    evidenceItems: [makeEvidenceRef("d1", "FloorPlan.pdf", [cand])],
    drawingTakeoffCandidates: [],
    missingInfoItems: [],
  };

  const result = buildCrossDrawingQuantities(input);
  const c = result.candidates[0];

  check(
    "C1-a normalizeItemCode W-01",
    "W-01",
    normalizeItemCode("W-01"),
    normalizeItemCode("W-01") === "W-01"
  );

  check(
    "C1-b builder produces exactly 1 candidate",
    "1",
    String(result.candidates.length),
    result.candidates.length === 1
  );

  check(
    "C1-c status is needs_verification",
    "needs_verification",
    c?.status ?? "none",
    c?.status === "needs_verification"
  );

  const hasMissingWidth = c?.missingFields?.includes("width") ?? false;
  const hasMissingHeight = c?.missingFields?.includes("height") ?? false;
  const hasMissingCount = c?.missingFields?.includes("count") ?? false;

  check(
    "C1-d missingFields includes width",
    "true",
    String(hasMissingWidth),
    hasMissingWidth
  );
  check(
    "C1-e missingFields includes height",
    "true",
    String(hasMissingHeight),
    hasMissingHeight
  );
  check(
    "C1-f missingFields includes count",
    "true",
    String(hasMissingCount),
    hasMissingCount
  );

  check(
    "C1-g no totalArea without dims",
    "undefined",
    String(c?.totalArea),
    c?.totalArea === undefined
  );
}

// ---------------------------------------------------------------------------
// Scenario C2: W-02 with width, height, count → totalArea calculated
// ---------------------------------------------------------------------------

function runC2() {
  const cand = makeCandidateRef({
    _tempId: "c2-cand-1",
    itemCode: "W-02",
    description: "Aluminium window type W-02",
    width: 1.2,
    height: 1.5,
    count: 8,
    confidence: "medium",
    sourceType: "drawing_annotation",
  });

  // Add a second drawing source to allow high confidence
  const cand2 = makeCandidateRef({
    _tempId: "c2-cand-2",
    itemCode: "W-02",
    description: "W-02 (schedule confirmation)",
    width: 1.2,
    height: 1.5,
    count: 8,
    confidence: "high",
    sourceType: "drawing_schedule",
    sourcePage: 2,
  });

  const input: CrossDrawingBuildInput = {
    projectId: "qa-proj",
    drawings: [
      makeDrawingRef("d1", "FloorPlan.pdf"),
      makeDrawingRef("d2", "Schedule.pdf"),
    ],
    classifiedDrawings: [
      makeClassifiedRef("d1", "plan"),
      makeClassifiedRef("d2", "schedule"),
    ],
    evidenceItems: [
      makeEvidenceRef("d1", "FloorPlan.pdf", [cand]),
      makeEvidenceRef("d2", "Schedule.pdf", [cand2], "pdf_text"),
    ],
    drawingTakeoffCandidates: [],
    missingInfoItems: [],
  };

  const result = buildCrossDrawingQuantities(input);
  const c = result.candidates[0];

  check(
    "C2-a builder produces 1 grouped candidate",
    "1",
    String(result.candidates.length),
    result.candidates.length === 1
  );

  const expectedAreaEach = parseFloat((1.2 * 1.5).toFixed(4));
  const expectedTotal = parseFloat((expectedAreaEach * 8).toFixed(4));

  check(
    "C2-b areaEach = width × height",
    String(expectedAreaEach),
    String(c?.areaEach),
    c?.areaEach === expectedAreaEach
  );

  check(
    "C2-c totalArea = areaEach × count",
    String(expectedTotal),
    String(c?.totalArea),
    c?.totalArea === expectedTotal
  );

  check(
    "C2-d missingFields is empty",
    "[]",
    JSON.stringify(c?.missingFields ?? []),
    (c?.missingFields ?? []).length === 0
  );

  check(
    "C2-e status is draft (complete candidate)",
    "draft",
    c?.status ?? "none",
    c?.status === "draft"
  );

  check(
    "C2-f occurrenceCount = 2 (two sources)",
    "2",
    String(c?.occurrenceCount),
    c?.occurrenceCount === 2
  );

  check(
    "C2-g sourceDrawingIds has 2 drawings",
    "2",
    String(c?.sourceDrawingIds?.length),
    c?.sourceDrawingIds?.length === 2
  );

  // Two drawings, non-OCR → should reach high confidence
  check(
    "C2-h confidence is high (multi-source, non-OCR)",
    "high",
    c?.confidence ?? "none",
    c?.confidence === "high"
  );
}

// ---------------------------------------------------------------------------
// Scenario C3: Generic "SD" code → generic warning + needs_verification
// ---------------------------------------------------------------------------

function runC3() {
  check(
    "C3-a isGenericCode('SD') = true",
    "true",
    String(isGenericCode("SD")),
    isGenericCode("SD")
  );
  check(
    "C3-b isGenericCode('SD-01') = false",
    "false",
    String(isGenericCode("SD-01")),
    !isGenericCode("SD-01")
  );
  check(
    "C3-c isGenericCode('CW') = true",
    "true",
    String(isGenericCode("CW")),
    isGenericCode("CW")
  );
  check(
    "C3-d isGenericCode('W') = true",
    "true",
    String(isGenericCode("W")),
    isGenericCode("W")
  );
  check(
    "C3-e isGenericCode('WIN') = true",
    "true",
    String(isGenericCode("WIN")),
    isGenericCode("WIN")
  );

  const cand = makeCandidateRef({
    _tempId: "c3-cand-1",
    itemCode: "SD",
    description: "Sliding door (generic)",
    category: "doors",
    width: 2.0,
    height: 2.4,
    count: 4,
  });

  const input: CrossDrawingBuildInput = {
    projectId: "qa-proj",
    drawings: [makeDrawingRef("d1", "Elevation.pdf")],
    classifiedDrawings: [makeClassifiedRef("d1", "elevation")],
    evidenceItems: [makeEvidenceRef("d1", "Elevation.pdf", [cand])],
    drawingTakeoffCandidates: [],
    missingInfoItems: [],
  };

  const result = buildCrossDrawingQuantities(input);
  const c = result.candidates[0];

  check(
    "C3-f builder emits 1 candidate for generic SD",
    "1",
    String(result.candidates.length),
    result.candidates.length === 1
  );

  check(
    "C3-g status is needs_verification for generic code",
    "needs_verification",
    c?.status ?? "none",
    c?.status === "needs_verification"
  );

  const hasGenericWarning = c?.warnings?.some((w) =>
    w.toLowerCase().includes("generic")
  ) ?? false;
  check(
    "C3-h warning mentions generic code",
    "true",
    String(hasGenericWarning),
    hasGenericWarning
  );

  check(
    "C3-i confidence is low for generic code",
    "low",
    c?.confidence ?? "none",
    c?.confidence === "low"
  );
}

// ---------------------------------------------------------------------------
// Scenario C4: OCR source → confidence capped at medium
// ---------------------------------------------------------------------------

function runC4() {
  const cand = makeCandidateRef({
    _tempId: "c4-cand-1",
    itemCode: "W-03",
    description: "Window W-03 (OCR)",
    width: 1.0,
    height: 1.2,
    count: 6,
    sourceType: "ocr_text",
    confidence: "high", // source claims high — must be capped
  });

  const input: CrossDrawingBuildInput = {
    projectId: "qa-proj",
    drawings: [makeDrawingRef("d1", "ScannedPlan.pdf")],
    classifiedDrawings: [makeClassifiedRef("d1", "plan")],
    evidenceItems: [
      makeEvidenceRef("d1", "ScannedPlan.pdf", [cand], "ocr_text"),
    ],
    drawingTakeoffCandidates: [],
    missingInfoItems: [],
  };

  const result = buildCrossDrawingQuantities(input);
  const c = result.candidates[0];

  check(
    "C4-a builder produces 1 candidate",
    "1",
    String(result.candidates.length),
    result.candidates.length === 1
  );

  // Even though all fields are present, OCR must not reach high
  check(
    "C4-b OCR candidate confidence ≤ medium",
    "medium",
    c?.confidence ?? "none",
    c?.confidence !== "high"
  );

  // Value source confidence must also be capped
  const widthSourceConf = c?.widthSource?.confidence;
  check(
    "C4-c widthSource confidence capped at medium for OCR",
    "medium",
    widthSourceConf ?? "none",
    widthSourceConf !== "high"
  );

  check(
    "C4-d status is needs_verification for single OCR source",
    "needs_verification",
    c?.status ?? "none",
    c?.status === "needs_verification"
  );
}

// ---------------------------------------------------------------------------
// Normalization unit tests
// ---------------------------------------------------------------------------

function runNormalizationChecks() {
  const cases: [string, string][] = [
    ["W01", "W-01"],
    ["W1", "W-01"],
    ["W-1", "W-01"],
    ["WIN01", "WIN-01"],
    ["CW05", "CW-05"],
    ["CW5", "CW-05"],
    ["SD01", "SD-01"],
    ["SD1", "SD-01"],
    ["W-01", "W-01"],
    ["SD-03", "SD-03"],
    ["CW-10", "CW-10"],
  ];

  for (const [input, expected] of cases) {
    const actual = normalizeItemCode(input);
    check(
      `Norm: ${input} → ${expected}`,
      expected,
      actual,
      actual === expected
    );
  }
}

// ---------------------------------------------------------------------------
// Debug helper smoke test
// ---------------------------------------------------------------------------

function runSummarySmoke() {
  const cand = makeCandidateRef({
    _tempId: "smoke-1",
    itemCode: "W-05",
    description: "Smoke test window",
    width: 1.0,
    height: 1.0,
    count: 2,
  });

  const input: CrossDrawingBuildInput = {
    projectId: "qa-proj",
    drawings: [makeDrawingRef("d1", "Test.pdf")],
    classifiedDrawings: [makeClassifiedRef("d1")],
    evidenceItems: [makeEvidenceRef("d1", "Test.pdf", [cand])],
    drawingTakeoffCandidates: [],
    missingInfoItems: [],
  };

  const result = buildCrossDrawingQuantities(input);
  const summary = summarizeCrossDrawingBuild(result);

  check(
    "Summary: groupedItems is number",
    "number",
    typeof summary.groupedItems,
    typeof summary.groupedItems === "number"
  );
  check(
    "Summary: warnings is array",
    "array",
    Array.isArray(summary.warnings) ? "array" : "not-array",
    Array.isArray(summary.warnings)
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  runNormalizationChecks();
  runC1();
  runC2();
  runC3();
  runC4();
  runSummarySmoke();

  console.log("\n=== Phase 4A Controlled QA Results ===\n");
  console.log("| Scenario | Expected | Actual | Status |");
  console.log("|----------|----------|--------|--------|");
  for (const r of rows) {
    console.log(
      `| ${r.scenario} | ${r.expected.replace(/\|/g, "/")} | ${r.actual.replace(/\|/g, "/")} | ${r.status} |`
    );
  }

  const failed = rows.filter((r) => r.status === "FAIL");
  if (failed.length === 0) {
    console.log(
      "\nAll Phase 4A checks passed. Data model and service skeleton verified."
    );
    process.exit(0);
  } else {
    console.log(`\n${failed.length} check(s) FAILED.`);
    process.exit(1);
  }
}

main();
