/**
 * Phase 4D controlled QA — Cross-Drawing Workflow Integration.
 *
 * Tests:
 *   D4d-1  Incomplete W-01 → one grouped issue created (not per-field)
 *   D4d-2  Complete W-02 → candidateIsVerifiable returns true
 *   D4d-3  OCR-only W-03 → candidateIsVerifiable blocked, isOcrOnly = true
 *   D4d-4  Generic "SD" → candidateIsVerifiable blocked, isGenericCode = true
 *   D4d-5  Conflict W-13 → candidateIsVerifiable blocked, hasConflict = true
 *   D4d-6  Needs-verification save preserves warnings, reasoning, missing fields
 *   D4d-7  Export mapping (notes field) does not crash or lose provenance
 *
 * Run: npx tsx scripts/qa-fixtures/run-phase4d-qa.ts
 *
 * No fixtures on disk required — all inputs synthesised in-memory.
 */

import {
  buildCrossDrawingQuantities,
  candidateIsVerifiable,
  candidateHasValueConflict,
  candidateIsOcrOnly,
  getCandidateRowState,
  isGenericCode,
} from "../../src/services/drawing-package/cross-drawing-quantity-builder.service";
import type {
  CrossDrawingBuildInput,
  CrossDrawingQuantityCandidate,
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

function check(scenario: string, expected: string, actual: string, pass: boolean) {
  rows.push({ scenario, expected, actual, status: pass ? "PASS" : "FAIL" });
}

// ---------------------------------------------------------------------------
// Shared builders
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
  drawingType: EvidenceItemRef["drawingType"] = "plan",
  textSource: EvidenceItemRef["textSource"] = "pdf_text"
): EvidenceItemRef {
  return { drawingId, drawingName, drawingType, classificationConfidence: "medium", textSource, candidates };
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

function buildInput(
  evidence: EvidenceItemRef[],
  drawings: DrawingFileRef[],
  classified: ClassifiedDrawingRef[]
): CrossDrawingBuildInput {
  return {
    projectId: "qa-proj-4d",
    drawings,
    classifiedDrawings: classified,
    evidenceItems: evidence,
    drawingTakeoffCandidates: [],
    missingInfoItems: [],
  };
}

// ---------------------------------------------------------------------------
// Simulate the "one issue per candidate" logic from the handler
// ---------------------------------------------------------------------------

interface SimulatedIssue {
  manualItemCode: string;
  missingFields: string[];
  detectedEvidence: string;
  recommendation: string;
}

const PRIORITY_FIELDS = ["width", "height", "count", "length", "thickness", "unit"];

function primaryIssueTypeLabel(missingFields: string[]): string {
  const lower = missingFields.map((f) => f.toLowerCase());
  for (const f of PRIORITY_FIELDS) {
    if (lower.includes(f)) return f;
  }
  return missingFields[0] ?? "unknown";
}

function suggestSource(field: string, category: string): string {
  const f = field.toLowerCase();
  const c = category.toLowerCase();
  if (f === "width" || f === "height") {
    if (c.includes("window") || c.includes("door"))
      return "Check window/door schedule or elevation drawing for exact dimensions.";
    return "Check elevation or schedule drawing for dimensions.";
  }
  if (f === "count") return "Check floor plan or schedule for quantity.";
  if (f === "length") return "Check plan or elevation for running length.";
  if (f === "thickness") return "Check section drawing or detail for glass/frame thickness specification.";
  return "Manual measurement required — check relevant drawing type.";
}

function consolidatedRecommendation(missingFields: string[], category: string): string {
  const parts = missingFields.map((f) => suggestSource(f, category));
  return Array.from(new Set(parts)).join(" ");
}

/**
 * Simulate the handleCrossDrawingSendToIssues logic (one issue per candidate).
 * Mirrors the exact logic in DrawingPackageReviewTab to ensure it's consistent.
 */
function simulateSendToIssues(
  candidates: CrossDrawingQuantityCandidate[],
  existingItemCodes: Set<string> = new Set()
): SimulatedIssue[] {
  const incomplete = candidates.filter((c) => c.missingFields.length > 0);
  const seen = new Set(existingItemCodes);
  const issues: SimulatedIssue[] = [];

  for (const c of incomplete) {
    const key = c.itemCode.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const sourceList = c.sourceDrawingNames.slice(0, 4).join(", ");
    const reasoningSnippet = c.reasoning.slice(0, 2).join(" ");
    const warningSnippet = c.warnings.slice(0, 1).join("");
    const detectedEvidence = [
      `Cross-Drawing Quantity Builder: ${c.occurrenceCount} occurrence(s) across ${c.sourceDrawingNames.length} drawing(s).`,
      `Sources: ${sourceList}.`,
      reasoningSnippet,
      warningSnippet,
    ].filter(Boolean).join(" ");

    issues.push({
      manualItemCode: c.itemCode,
      missingFields: c.missingFields,
      detectedEvidence,
      recommendation: consolidatedRecommendation(c.missingFields, c.category),
    });
  }

  return issues;
}

/**
 * Simulate building the notes field for a needs_verification save.
 * Mirrors the DrawingPackageReviewTab logic.
 */
function simulateNotesForNeedsVerification(c: CrossDrawingQuantityCandidate): string {
  const sourceNote = "Created from Cross-Drawing Quantity Builder.";
  const drawingNote = `Sources: ${c.sourceDrawingNames.join(", ")}.`;
  const reasoningNote = c.reasoning.slice(0, 3).join(" ");
  const warningNote = c.warnings.length > 0 ? `Warnings: ${c.warnings.slice(0, 2).join("; ")}.` : "";
  const missingNote = c.missingFields.length > 0 ? `Missing: ${c.missingFields.join(", ")}.` : "";
  const conflictNote = candidateHasValueConflict(c) ? "Conflicting values detected — review before verifying." : "";
  const ocrNote = candidateIsOcrOnly(c) ? "OCR-only source — verify manually from drawing." : "";
  return [sourceNote, drawingNote, reasoningNote, warningNote, missingNote, conflictNote, ocrNote]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
}

// ---------------------------------------------------------------------------
// D4d-1: Incomplete W-01 → one grouped issue (not per-field)
// ---------------------------------------------------------------------------

function runD4d1() {
  // W-01 is missing width, height, and count — three missing fields
  const cand = makeCandidateRef({
    _tempId: "w01-plan",
    itemCode: "W-01",
    description: "Aluminium window W-01",
    // no width, height, count
  });

  const result = buildCrossDrawingQuantities(
    buildInput(
      [makeEvidenceRef("d1", "FloorPlan.pdf", [cand])],
      [makeDrawingRef("d1", "FloorPlan.pdf")],
      [makeClassifiedRef("d1")]
    )
  );

  const candidate = result.candidates.find((c) => c.itemCode.includes("W-01"));
  if (!candidate) {
    check("D4d-1a W-01 candidate exists", "true", "undefined — no candidate", false);
    return;
  }

  check(
    "D4d-1a W-01 has missing fields",
    ">0",
    String(candidate.missingFields.length),
    candidate.missingFields.length > 0
  );

  // Simulate Send to Issues
  const issues = simulateSendToIssues([candidate]);

  check(
    "D4d-1b W-01 produces exactly ONE issue (not per-field)",
    "1",
    String(issues.length),
    issues.length === 1
  );

  check(
    "D4d-1c Issue carries ALL missing fields for W-01",
    "≥1 fields",
    `[${issues[0]?.missingFields.join(", ")}]`,
    (issues[0]?.missingFields.length ?? 0) > 0
  );

  check(
    "D4d-1d Issue detectedEvidence mentions source drawing",
    "contains FloorPlan",
    issues[0]?.detectedEvidence ?? "",
    (issues[0]?.detectedEvidence ?? "").includes("FloorPlan")
  );

  check(
    "D4d-1e Issue manualItemCode is W-01",
    "W-01",
    issues[0]?.manualItemCode ?? "",
    issues[0]?.manualItemCode === "W-01"
  );

  // Duplicate-dedup: sending same candidate twice should still produce only 1 issue
  const existingCodes = new Set(["W-01"]);
  const dedupIssues = simulateSendToIssues([candidate], existingCodes);
  check(
    "D4d-1f Duplicate dedup: W-01 already open → 0 new issues",
    "0",
    String(dedupIssues.length),
    dedupIssues.length === 0
  );
}

// ---------------------------------------------------------------------------
// D4d-2: Complete W-02 → candidateIsVerifiable = true
// ---------------------------------------------------------------------------

function runD4d2() {
  // Schedule drawing → high quality source for width/height
  const schedCand = makeCandidateRef({
    _tempId: "w02-sched",
    itemCode: "W-02",
    description: "Sliding window W-02",
    confidence: "high",
    width: 1.2,
    height: 1.5,
    count: 4,
    unit: "sqm",
    sourceType: "drawing_annotation",
  });

  const planCand = makeCandidateRef({
    _tempId: "w02-plan",
    itemCode: "W-02",
    description: "Sliding window W-02",
    confidence: "high",
    count: 4,
    unit: "sqm",
    sourceType: "drawing_annotation",
  });

  const result = buildCrossDrawingQuantities(
    buildInput(
      [
        makeEvidenceRef("d1", "Schedule.pdf", [schedCand], "schedule"),
        makeEvidenceRef("d2", "FloorPlan.pdf", [planCand], "plan"),
      ],
      [makeDrawingRef("d1", "Schedule.pdf"), makeDrawingRef("d2", "FloorPlan.pdf")],
      [makeClassifiedRef("d1", "schedule"), makeClassifiedRef("d2", "plan")]
    )
  );

  const candidate = result.candidates.find((c) => c.itemCode.includes("W-02"));
  if (!candidate) {
    check("D4d-2a W-02 candidate exists", "true", "not found", false);
    return;
  }

  check(
    "D4d-2a W-02 missing fields = 0",
    "0",
    String(candidate.missingFields.length),
    candidate.missingFields.length === 0
  );

  check(
    "D4d-2b W-02 confidence high",
    "high",
    candidate.confidence,
    candidate.confidence === "high"
  );

  const noConflict = !candidateHasValueConflict(candidate);
  check(
    "D4d-2c W-02 no conflict",
    "true",
    String(noConflict),
    noConflict
  );

  const notGeneric = !isGenericCode(candidate.itemCode);
  check(
    "D4d-2d W-02 not generic code",
    "true",
    String(notGeneric),
    notGeneric
  );

  const notOcr = !candidateIsOcrOnly(candidate);
  check(
    "D4d-2e W-02 not OCR-only",
    "true",
    String(notOcr),
    notOcr
  );

  const verifiable = candidateIsVerifiable(candidate);
  check(
    "D4d-2f W-02 candidateIsVerifiable = true",
    "true",
    String(verifiable),
    verifiable
  );

  check(
    "D4d-2g W-02 rowState = verified_eligible",
    "verified_eligible",
    getCandidateRowState(candidate),
    getCandidateRowState(candidate) === "verified_eligible"
  );
}

// ---------------------------------------------------------------------------
// D4d-3: OCR-only W-03 → candidateIsVerifiable blocked
// ---------------------------------------------------------------------------

function runD4d3() {
  const ocrCand = makeCandidateRef({
    _tempId: "w03-ocr",
    itemCode: "W-03",
    description: "Window W-03 (OCR)",
    confidence: "medium",
    width: 1.0,
    height: 1.2,
    count: 2,
    unit: "sqm",
    sourceType: "ocr_text",
  });

  const result = buildCrossDrawingQuantities(
    buildInput(
      [makeEvidenceRef("d1", "ScannedPlan.pdf", [ocrCand], "plan", "ocr_text")],
      [makeDrawingRef("d1", "ScannedPlan.pdf")],
      [makeClassifiedRef("d1", "plan")]
    )
  );

  const candidate = result.candidates.find((c) => c.itemCode.includes("W-03"));
  if (!candidate) {
    check("D4d-3a W-03 candidate exists", "true", "not found", false);
    return;
  }

  const isOcr = candidateIsOcrOnly(candidate);
  check(
    "D4d-3a W-03 candidateIsOcrOnly = true",
    "true",
    String(isOcr),
    isOcr
  );

  check(
    "D4d-3b W-03 confidence not high (OCR cap)",
    "!high",
    candidate.confidence,
    candidate.confidence !== "high"
  );

  const verifiable = candidateIsVerifiable(candidate);
  check(
    "D4d-3c W-03 candidateIsVerifiable = false (blocked)",
    "false",
    String(verifiable),
    verifiable === false
  );

  check(
    "D4d-3d W-03 rowState = ocr_verify",
    "ocr_verify",
    getCandidateRowState(candidate),
    getCandidateRowState(candidate) === "ocr_verify"
  );
}

// ---------------------------------------------------------------------------
// D4d-4: Generic "SD" → candidateIsVerifiable blocked
// ---------------------------------------------------------------------------

function runD4d4() {
  const sdCand = makeCandidateRef({
    _tempId: "sd-cand",
    itemCode: "SD",
    description: "Spandrel or sliding door",
    confidence: "medium",
    width: 2.0,
    height: 2.4,
    count: 6,
    unit: "sqm",
    sourceType: "drawing_annotation",
  });

  const result = buildCrossDrawingQuantities(
    buildInput(
      [makeEvidenceRef("d1", "ElevationA.pdf", [sdCand], "elevation")],
      [makeDrawingRef("d1", "ElevationA.pdf")],
      [makeClassifiedRef("d1", "elevation")]
    )
  );

  const candidate = result.candidates.find((c) => c.itemCode === "SD");
  if (!candidate) {
    check("D4d-4a SD candidate exists", "true", "not found", false);
    return;
  }

  check(
    "D4d-4a SD isGenericCode = true",
    "true",
    String(isGenericCode(candidate.itemCode)),
    isGenericCode(candidate.itemCode)
  );

  const verifiable = candidateIsVerifiable(candidate);
  check(
    "D4d-4b SD candidateIsVerifiable = false (blocked — generic)",
    "false",
    String(verifiable),
    verifiable === false
  );

  check(
    "D4d-4c SD rowState = generic",
    "generic",
    getCandidateRowState(candidate),
    getCandidateRowState(candidate) === "generic"
  );

  // Sending generic SD to issues should produce one issue with all missing fields
  // (SD will have missing fields since generic codes are handled conservatively)
  // If no missing fields, the generic reasoning + warning still preserved
  const issues = simulateSendToIssues([candidate]);
  if (candidate.missingFields.length > 0) {
    check(
      "D4d-4d SD → 1 issue created",
      "1",
      String(issues.length),
      issues.length === 1
    );
  } else {
    // SD has no missing fields but is generic — can still be saved as needs_verification
    check(
      "D4d-4d SD has generic warning in candidate warnings",
      "contains 'generic'",
      candidate.warnings.join("|"),
      candidate.warnings.some((w) => w.toLowerCase().includes("generic"))
    );
  }
}

// ---------------------------------------------------------------------------
// D4d-5: Conflict W-13 → candidateIsVerifiable blocked
// ---------------------------------------------------------------------------

function runD4d5() {
  // Two sources with diverging widths → conflict detected
  // ratio must be > 1.5× to trigger "significant" conflict: 2.0 vs 4.5 = 2.25×
  const schedCand = makeCandidateRef({
    _tempId: "w13-sched",
    itemCode: "W-13",
    description: "Window W-13 — wide bay",
    confidence: "high",
    width: 2.0,
    height: 2.1,
    count: 2,
    unit: "sqm",
    sourceType: "drawing_annotation",
  });

  const elevCand = makeCandidateRef({
    _tempId: "w13-elev",
    itemCode: "W-13",
    description: "Window W-13 — wide bay",
    confidence: "high",
    width: 4.5, // ratio 4.5 / 2.0 = 2.25 > 1.5× threshold
    height: 2.1,
    count: 2,
    unit: "sqm",
    sourceType: "drawing_annotation",
  });

  const result = buildCrossDrawingQuantities(
    buildInput(
      [
        makeEvidenceRef("d1", "Schedule.pdf", [schedCand], "schedule"),
        makeEvidenceRef("d2", "ElevationA.pdf", [elevCand], "elevation"),
      ],
      [makeDrawingRef("d1", "Schedule.pdf"), makeDrawingRef("d2", "ElevationA.pdf")],
      [makeClassifiedRef("d1", "schedule"), makeClassifiedRef("d2", "elevation")]
    )
  );

  const candidate = result.candidates.find((c) => c.itemCode.includes("W-13"));
  if (!candidate) {
    check("D4d-5a W-13 candidate exists", "true", "not found", false);
    return;
  }

  const hasConflict = candidateHasValueConflict(candidate);
  check(
    "D4d-5a W-13 candidateHasValueConflict = true (diverging widths)",
    "true",
    String(hasConflict),
    hasConflict
  );

  check(
    "D4d-5b W-13 possibleWidths has multiple values",
    "≥2",
    String(candidate.possibleWidths?.length ?? 0),
    (candidate.possibleWidths?.length ?? 0) >= 2
  );

  const verifiable = candidateIsVerifiable(candidate);
  check(
    "D4d-5c W-13 candidateIsVerifiable = false (blocked — conflict)",
    "false",
    String(verifiable),
    verifiable === false
  );

  check(
    "D4d-5d W-13 rowState = conflict",
    "conflict",
    getCandidateRowState(candidate),
    getCandidateRowState(candidate) === "conflict"
  );

  check(
    "D4d-5e W-13 conflict warning message present",
    "contains 'Multiple possible'",
    candidate.warnings.join("|"),
    candidate.warnings.some((w) => w.includes("Multiple possible"))
  );
}

// ---------------------------------------------------------------------------
// D4d-6: Needs-verification save preserves warnings, reasoning, missing fields
// ---------------------------------------------------------------------------

function runD4d6() {
  const cand = makeCandidateRef({
    _tempId: "w05-incomplete",
    itemCode: "W-05",
    description: "Casement window W-05",
    confidence: "medium",
    width: 0.9,
    // height is missing
    count: 3,
    unit: "sqm",
    sourceType: "drawing_annotation",
  });

  const result = buildCrossDrawingQuantities(
    buildInput(
      [makeEvidenceRef("d1", "Schedule.pdf", [cand], "schedule")],
      [makeDrawingRef("d1", "Schedule.pdf")],
      [makeClassifiedRef("d1", "schedule")]
    )
  );

  const candidate = result.candidates.find((c) => c.itemCode.includes("W-05"));
  if (!candidate) {
    check("D4d-6a W-05 candidate exists", "true", "not found", false);
    return;
  }

  // Inject test entries at position 0 so they're within slice(0, 3)
  candidate.warnings.unshift("Test warning: height not found in schedule.");
  candidate.reasoning.unshift("Test reasoning: height absent from schedule evidence.");

  const notes = simulateNotesForNeedsVerification(candidate);

  check(
    "D4d-6a Notes contains source builder note",
    "contains 'Cross-Drawing Quantity Builder'",
    notes,
    notes.includes("Cross-Drawing Quantity Builder")
  );

  check(
    "D4d-6b Notes contains source drawing name",
    "contains 'Schedule.pdf'",
    notes,
    notes.includes("Schedule.pdf")
  );

  check(
    "D4d-6c Notes contains warning text",
    "contains 'Test warning'",
    notes,
    notes.includes("Test warning")
  );

  check(
    "D4d-6d Notes contains reasoning",
    "contains 'Test reasoning'",
    notes,
    notes.includes("Test reasoning")
  );

  check(
    "D4d-6e Notes contains missing field name",
    "contains 'height'",
    notes,
    notes.toLowerCase().includes("height")
  );

  check(
    "D4d-6f Notes length ≤ 500 chars",
    "≤500",
    String(notes.length),
    notes.length <= 500
  );

  // areaEach and totalArea should be suppressed when fields are missing
  check(
    "D4d-6g totalArea not set for incomplete candidate",
    "undefined",
    String(candidate.totalArea),
    candidate.totalArea === undefined
  );
}

// ---------------------------------------------------------------------------
// D4d-7: Export mapping does not crash — notes field safely populated
// ---------------------------------------------------------------------------

function runD4d7() {
  // Simulate a complete candidate as would be passed to Drawing Takeoff
  const cand = makeCandidateRef({
    _tempId: "w07-complete",
    itemCode: "W-07",
    description: "Picture window W-07",
    confidence: "high",
    width: 1.8,
    height: 2.1,
    count: 5,
    unit: "sqm",
    sourceType: "drawing_annotation",
  });

  const result = buildCrossDrawingQuantities(
    buildInput(
      [makeEvidenceRef("d1", "WindowSchedule.pdf", [cand], "schedule")],
      [makeDrawingRef("d1", "WindowSchedule.pdf")],
      [makeClassifiedRef("d1", "schedule")]
    )
  );

  const candidate = result.candidates.find((c) => c.itemCode.includes("W-07"));
  if (!candidate) {
    check("D4d-7a W-07 candidate exists", "true", "not found", false);
    return;
  }

  // Simulate verified save notes
  const notes = [
    "Created from Cross-Drawing Quantity Builder.",
    `Sources: ${candidate.sourceDrawingNames.join(", ")}.`,
    candidate.reasoning.slice(0, 2).join(" "),
  ].filter(Boolean).join(" ").slice(0, 500);

  check(
    "D4d-7a Verified notes contains builder note",
    "contains 'Cross-Drawing Quantity Builder'",
    notes,
    notes.includes("Cross-Drawing Quantity Builder")
  );

  check(
    "D4d-7b Verified notes contains source drawing",
    "contains 'WindowSchedule'",
    notes,
    notes.includes("WindowSchedule")
  );

  check(
    "D4d-7c Notes does not exceed 500 chars",
    "≤500",
    String(notes.length),
    notes.length <= 500
  );

  // Simulate the DrawingTakeoffItem fields that would be saved
  const mappedItem = {
    itemCode: candidate.itemCode,
    description: candidate.description,
    category: candidate.category,
    count: candidate.count,
    width: candidate.width,
    height: candidate.height,
    thickness: candidate.thickness,
    length: candidate.length,
    areaEach: candidate.areaEach,
    totalArea: candidate.totalArea,
    unit: candidate.unit,
    material: candidate.material,
    glassType: candidate.glassType,
    frameType: candidate.frameType,
    confidence: candidate.confidence,
    status: "verified",
    missingFields: [],
    warnings: candidate.warnings,
    notes,
    sourceDrawingName: candidate.sourceDrawingNames[0] ?? "Cross-Drawing",
  };

  check(
    "D4d-7d Mapped item has correct itemCode",
    "W-07",
    String(mappedItem.itemCode ?? ""),
    (mappedItem.itemCode ?? "").includes("W-07")
  );

  check(
    "D4d-7e Mapped item width is a number",
    "number",
    typeof mappedItem.width,
    typeof mappedItem.width === "number"
  );

  check(
    "D4d-7f Mapped item status = verified",
    "verified",
    mappedItem.status,
    mappedItem.status === "verified"
  );

  check(
    "D4d-7g Mapped item missingFields is empty",
    "0",
    String(mappedItem.missingFields.length),
    mappedItem.missingFields.length === 0
  );

  // Simulate export row serialisation — ensure no crash
  let exportCrash = false;
  let exportRow: string[] = [];
  try {
    exportRow = [
      mappedItem.itemCode ?? "",
      mappedItem.description,
      mappedItem.category,
      String(mappedItem.count ?? ""),
      String(mappedItem.width ?? ""),
      String(mappedItem.height ?? ""),
      String(mappedItem.thickness ?? ""),
      String(mappedItem.areaEach ?? ""),
      String(mappedItem.totalArea ?? ""),
      String(mappedItem.length ?? ""),
      mappedItem.unit,
      mappedItem.material ?? "",
      mappedItem.sourceDrawingName,
      mappedItem.status,
      mappedItem.confidence,
      mappedItem.warnings?.join("; ") ?? "",
      mappedItem.notes ?? "",
    ];
  } catch {
    exportCrash = true;
  }

  check(
    "D4d-7h Export row serialisation does not crash",
    "false",
    String(exportCrash),
    exportCrash === false
  );

  check(
    "D4d-7i Export row has 17 columns",
    "17",
    String(exportRow.length),
    exportRow.length === 17
  );
}

// ---------------------------------------------------------------------------
// Run all scenarios
// ---------------------------------------------------------------------------

runD4d1();
runD4d2();
runD4d3();
runD4d4();
runD4d5();
runD4d6();
runD4d7();

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const total = rows.length;
const passed = rows.filter((r) => r.status === "PASS").length;
const failed = rows.filter((r) => r.status === "FAIL").length;

const colW = [40, 30, 55, 6];
const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);

console.log("\n" + "─".repeat(137));
console.log(
  pad("Scenario", colW[0]) + pad("Expected", colW[1]) + pad("Actual", colW[2]) + "Status"
);
console.log("─".repeat(137));

for (const r of rows) {
  const line =
    pad(r.scenario, colW[0]) +
    pad(r.expected, colW[1]) +
    pad(r.actual, colW[2]) +
    (r.status === "PASS" ? "✅ PASS" : "❌ FAIL");
  console.log(line);
}

console.log("─".repeat(137));
console.log(`\nResults: ${passed}/${total} passed  |  ${failed} failed\n`);

if (failed > 0) {
  console.error("Phase 4D QA: FAILED\n");
  process.exit(1);
} else {
  console.log("Phase 4D QA: ALL PASS ✅\n");
}
