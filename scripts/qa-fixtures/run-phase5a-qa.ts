/**
 * Phase 5A QA fixture — AI Drawing Review Layer (Data Model + Mock Engine)
 *
 * Covers:
 *  - generic code "SD"     → generic_code finding
 *  - conflict "W-13"       → source_conflict finding
 *  - OCR-only "W-04"       → ocr_uncertain finding
 *  - missing fields "W-01" → missing_information finding
 *  - safe "W-02"           → quantity_safe finding
 *  - failed drawing        → failed_drawing finding
 *  - AI does NOT mutate candidate quantities
 *  - result summary counts findings
 *  - result stores reviewedCandidateIds
 *  - status becomes completed
 *
 * Run: npx tsx scripts/qa-fixtures/run-phase5a-qa.ts
 */

import { runMockAiDrawingReview } from "../../src/services/ai-review/ai-drawing-review.service";
import type { AiReviewRunInput } from "../../src/types/ai-review";
import type {
  CrossDrawingQuantityCandidate,
  CrossDrawingBuildResult,
  CrossDrawingBuildStats,
  CrossDrawingValueSource,
} from "../../src/types/cross-drawing-quantity";

// ---------------------------------------------------------------------------
// Helpers
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

const NOW = new Date().toISOString();

function makeSource(
  sourceType: CrossDrawingValueSource["sourceType"],
  drawingName = "TEST-DWG-01.pdf"
): CrossDrawingValueSource {
  return {
    drawingId: "dwg-001",
    drawingName,
    sourceType,
    confidence: "medium",
  };
}

function makeCandidate(
  overrides: Partial<CrossDrawingQuantityCandidate> &
    Pick<CrossDrawingQuantityCandidate, "id" | "itemCode" | "normalizedItemCode">
): CrossDrawingQuantityCandidate {
  return {
    projectId: "proj-test",
    description: "Test item",
    category: "windows",
    unit: "sqm",
    linkedEvidenceIds: [],
    sourceDrawingIds: ["dwg-001"],
    sourceDrawingNames: ["TEST-DWG-01.pdf"],
    sourcePages: [1],
    occurrenceCount: 1,
    missingFields: [],
    warnings: [],
    reasoning: [],
    confidence: "high",
    status: "draft",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeStats(): CrossDrawingBuildStats {
  return {
    totalEvidence: 5,
    groupedItems: 5,
    completeCandidates: 1,
    needsVerification: 4,
    missingInfoCreated: 0,
    highConfidence: 1,
    mediumConfidence: 3,
    lowConfidence: 1,
    conflictingValues: 1,
    genericCodes: 1,
    ocrSourcedCandidates: 1,
  };
}

// ---------------------------------------------------------------------------
// Build test candidates
// ---------------------------------------------------------------------------

// SD = bare generic prefix, no number → generic_code
const sdGeneric = makeCandidate({
  id: "cand-sd",
  itemCode: "SD",
  normalizedItemCode: "SD",
  description: "Sliding Door — generic",
  confidence: "low",
  missingFields: ["width", "height", "count"],
  warnings: [
    `Generic item code "SD" — assign a specific numbered code before finalising.`,
  ],
});

// W-13 with conflict warning → source_conflict
const w13Conflict = makeCandidate({
  id: "cand-w13",
  itemCode: "W-13",
  normalizedItemCode: "W-13",
  description: "Window W-13",
  width: 2.0,
  height: 2.2,
  count: 2,
  widthSource: makeSource("pdf_text", "MT-SCHED.pdf"),
  heightSource: makeSource("pdf_text", "MT-SCHED.pdf"),
  countSource: makeSource("pdf_text", "MT-PLAN.pdf"),
  sourceDrawingNames: ["MT-SCHED.pdf", "MT-ELEV.pdf"],
  possibleWidths: [2.0, 4.5],
  warnings: ["Multiple possible widths found: 2.0m, 4.5m — conflict flagged."],
  confidence: "medium",
});

// W-04 OCR-only → ocr_uncertain
const w04Ocr = makeCandidate({
  id: "cand-w04",
  itemCode: "W-04",
  normalizedItemCode: "W-04",
  description: "Window W-04",
  width: 1.0,
  height: 1.5,
  count: 3,
  widthSource: makeSource("ocr_text"),
  heightSource: makeSource("ocr_text"),
  countSource: makeSource("ocr_text"),
  confidence: "medium",
});

// W-01 missing required fields → missing_information
const w01Missing = makeCandidate({
  id: "cand-w01",
  itemCode: "W-01",
  normalizedItemCode: "W-01",
  description: "Window W-01",
  missingFields: ["width", "height", "count"],
  confidence: "low",
});

// W-02 complete, high confidence, no issues → quantity_safe
const w02Safe = makeCandidate({
  id: "cand-w02",
  itemCode: "W-02",
  normalizedItemCode: "W-02",
  description: "Window W-02",
  width: 1.2,
  height: 1.8,
  count: 4,
  widthSource: makeSource("pdf_text", "MT-SCHED.pdf"),
  heightSource: makeSource("pdf_text", "MT-SCHED.pdf"),
  countSource: makeSource("pdf_text", "MT-PLAN.pdf"),
  confidence: "high",
});

const allCandidates = [sdGeneric, w13Conflict, w04Ocr, w01Missing, w02Safe];

// Deep-copy originals to verify no mutation
const originalCopies = JSON.parse(
  JSON.stringify(allCandidates)
) as CrossDrawingQuantityCandidate[];

// ---------------------------------------------------------------------------
// Build input
// ---------------------------------------------------------------------------

const crossDrawingResult: CrossDrawingBuildResult = {
  projectId: "proj-test",
  candidates: allCandidates,
  unresolvedIssueIds: [],
  warnings: [],
  stats: makeStats(),
};

const input: AiReviewRunInput = {
  projectId: "proj-test",
  crossDrawingResult,
  failedDrawingDiagnostics: [
    {
      drawingId: "dwg-failed",
      drawingName: "MT-ELEV-NORTH.pdf",
      errorMessage: "Blob not found in IndexedDB",
      suggestion:
        "Re-import or replace this drawing to include it in the package.",
    },
  ],
  packageAnalysisResult: {
    hasPlan: true,
    hasElevation: false,
    hasSchedule: true,
    hasSection: false,
  },
};

// ---------------------------------------------------------------------------
// Run the mock review
// ---------------------------------------------------------------------------

const result = runMockAiDrawingReview(input);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function run() {
  // ── Status ────────────────────────────────────────────────────────────────
  check(
    "5A-1: status is completed",
    "completed",
    result.status,
    result.status === "completed"
  );

  // ── reviewedCandidateIds ──────────────────────────────────────────────────
  const reviewed = result.reviewedCandidateIds;
  check(
    "5A-2: reviewedCandidateIds contains all candidate IDs",
    allCandidates.map((c) => c.id).sort().join(","),
    reviewed.sort().join(","),
    allCandidates.every((c) => reviewed.includes(c.id))
  );

  // ── generic_code finding for SD ──────────────────────────────────────────
  const sdFinding = result.findings.find(
    (f) => f.candidateId === "cand-sd" && f.findingType === "generic_code"
  );
  check(
    "5A-3: SD creates generic_code finding",
    "generic_code",
    sdFinding?.findingType ?? "NOT FOUND",
    !!sdFinding
  );
  check(
    "5A-4: SD finding riskLevel is medium",
    "medium",
    sdFinding?.riskLevel ?? "NOT FOUND",
    sdFinding?.riskLevel === "medium"
  );
  check(
    "5A-5: SD finding suggestedAction is send_to_missing_info",
    "send_to_missing_info",
    sdFinding?.suggestedAction ?? "NOT FOUND",
    sdFinding?.suggestedAction === "send_to_missing_info"
  );

  // ── source_conflict finding for W-13 ─────────────────────────────────────
  const w13Finding = result.findings.find(
    (f) => f.candidateId === "cand-w13" && f.findingType === "source_conflict"
  );
  check(
    "5A-6: W-13 creates source_conflict finding",
    "source_conflict",
    w13Finding?.findingType ?? "NOT FOUND",
    !!w13Finding
  );
  check(
    "5A-7: W-13 finding riskLevel is high",
    "high",
    w13Finding?.riskLevel ?? "NOT FOUND",
    w13Finding?.riskLevel === "high"
  );
  check(
    "5A-8: W-13 finding suggestedAction is request_manual_check",
    "request_manual_check",
    w13Finding?.suggestedAction ?? "NOT FOUND",
    w13Finding?.suggestedAction === "request_manual_check"
  );

  // ── ocr_uncertain finding for W-04 ───────────────────────────────────────
  const w04Finding = result.findings.find(
    (f) => f.candidateId === "cand-w04" && f.findingType === "ocr_uncertain"
  );
  check(
    "5A-9: W-04 creates ocr_uncertain finding",
    "ocr_uncertain",
    w04Finding?.findingType ?? "NOT FOUND",
    !!w04Finding
  );
  check(
    "5A-10: W-04 finding riskLevel is medium",
    "medium",
    w04Finding?.riskLevel ?? "NOT FOUND",
    w04Finding?.riskLevel === "medium"
  );
  check(
    "5A-11: W-04 finding suggestedAction is mark_needs_verification",
    "mark_needs_verification",
    w04Finding?.suggestedAction ?? "NOT FOUND",
    w04Finding?.suggestedAction === "mark_needs_verification"
  );

  // ── missing_information finding for W-01 ─────────────────────────────────
  const w01Finding = result.findings.find(
    (f) =>
      f.candidateId === "cand-w01" && f.findingType === "missing_information"
  );
  check(
    "5A-12: W-01 creates missing_information finding",
    "missing_information",
    w01Finding?.findingType ?? "NOT FOUND",
    !!w01Finding
  );
  check(
    "5A-13: W-01 finding riskLevel is medium",
    "medium",
    w01Finding?.riskLevel ?? "NOT FOUND",
    w01Finding?.riskLevel === "medium"
  );
  check(
    "5A-14: W-01 finding suggestedAction is send_to_missing_info",
    "send_to_missing_info",
    w01Finding?.suggestedAction ?? "NOT FOUND",
    w01Finding?.suggestedAction === "send_to_missing_info"
  );
  check(
    "5A-15: W-01 finding message mentions missing fields",
    "contains 'width'",
    w01Finding?.message ?? "",
    w01Finding?.message.includes("width") ?? false
  );

  // ── quantity_safe finding for W-02 ───────────────────────────────────────
  const w02Finding = result.findings.find(
    (f) => f.candidateId === "cand-w02" && f.findingType === "quantity_safe"
  );
  check(
    "5A-16: W-02 creates quantity_safe finding",
    "quantity_safe",
    w02Finding?.findingType ?? "NOT FOUND",
    !!w02Finding
  );
  check(
    "5A-17: W-02 finding riskLevel is low",
    "low",
    w02Finding?.riskLevel ?? "NOT FOUND",
    w02Finding?.riskLevel === "low"
  );
  check(
    "5A-18: W-02 finding suggestedAction is keep_candidate",
    "keep_candidate",
    w02Finding?.suggestedAction ?? "NOT FOUND",
    w02Finding?.suggestedAction === "keep_candidate"
  );

  // ── failed drawing finding ────────────────────────────────────────────────
  const failedFinding = result.findings.find(
    (f) =>
      f.findingType === "failed_drawing" &&
      f.sourceDrawingNames.includes("MT-ELEV-NORTH.pdf")
  );
  check(
    "5A-19: failed drawing creates failed_drawing finding",
    "failed_drawing",
    failedFinding?.findingType ?? "NOT FOUND",
    !!failedFinding
  );
  check(
    "5A-20: failed drawing finding riskLevel is high",
    "high",
    failedFinding?.riskLevel ?? "NOT FOUND",
    failedFinding?.riskLevel === "high"
  );
  check(
    "5A-21: failed drawing finding suggestedAction is request_manual_check",
    "request_manual_check",
    failedFinding?.suggestedAction ?? "NOT FOUND",
    failedFinding?.suggestedAction === "request_manual_check"
  );

  // ── package-level missing drawing type findings ───────────────────────────
  const elevFinding = result.findings.find(
    (f) => f.findingType === "needs_elevation"
  );
  check(
    "5A-22: hasPlan + no elevation creates needs_elevation finding",
    "needs_elevation",
    elevFinding?.findingType ?? "NOT FOUND",
    !!elevFinding
  );

  const secFinding = result.findings.find(
    (f) => f.findingType === "needs_section"
  );
  check(
    "5A-23: no section creates needs_section finding",
    "needs_section",
    secFinding?.findingType ?? "NOT FOUND",
    !!secFinding
  );

  // ── AI does NOT mutate candidate quantities ───────────────────────────────
  let mutated = false;
  for (let i = 0; i < allCandidates.length; i++) {
    const orig = originalCopies[i];
    const after = allCandidates[i];
    if (
      orig.width !== after.width ||
      orig.height !== after.height ||
      orig.count !== after.count ||
      orig.totalArea !== after.totalArea ||
      orig.length !== after.length ||
      orig.status !== after.status ||
      orig.confidence !== after.confidence
    ) {
      mutated = true;
    }
  }
  check(
    "5A-24: AI does not mutate candidate quantities",
    "no mutation",
    mutated ? "MUTATION DETECTED" : "no mutation",
    !mutated
  );

  // ── Summary counts ────────────────────────────────────────────────────────
  const totalFindings = result.findings.length;
  check(
    "5A-25: result has findings (at least 5 from candidates)",
    ">=5",
    String(totalFindings),
    totalFindings >= 5
  );

  check(
    "5A-26: result summary is non-empty",
    "non-empty string",
    result.summary.length > 0 ? "non-empty" : "empty",
    result.summary.length > 0
  );

  check(
    "5A-27: result summary mentions 'completed'",
    "contains 'complete'",
    result.summary,
    result.summary.toLowerCase().includes("complete")
  );

  // ── Result id and projectId ───────────────────────────────────────────────
  check(
    "5A-28: result has non-empty id",
    "non-empty",
    result.id.length > 0 ? "non-empty" : "empty",
    result.id.length > 0
  );
  check(
    "5A-29: result.projectId matches input",
    "proj-test",
    result.projectId,
    result.projectId === "proj-test"
  );

  // ── Each finding has required fields ─────────────────────────────────────
  const missingFields = result.findings.filter(
    (f) =>
      !f.id ||
      !f.projectId ||
      !f.findingType ||
      !f.riskLevel ||
      !f.title ||
      !f.message ||
      !f.recommendation ||
      !f.suggestedAction ||
      !f.confidence ||
      !f.createdAt
  );
  check(
    "5A-30: all findings have required fields",
    "0 incomplete findings",
    `${missingFields.length} incomplete`,
    missingFields.length === 0
  );

  // ── findings linked to their candidates have candidateId ─────────────────
  const candidateFindings = result.findings.filter((f) => f.candidateId);
  const allHaveCandidateId = candidateFindings.every(
    (f) => typeof f.candidateId === "string" && f.candidateId.length > 0
  );
  check(
    "5A-31: candidate findings have candidateId set",
    "all have candidateId",
    allHaveCandidateId ? "all have candidateId" : "some missing",
    allHaveCandidateId
  );
}

run();

// ---------------------------------------------------------------------------
// Print results
// ---------------------------------------------------------------------------

const passed = rows.filter((r) => r.status === "PASS").length;
const failed = rows.filter((r) => r.status === "FAIL").length;

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  Phase 5A QA — AI Drawing Review Layer");
console.log("═══════════════════════════════════════════════════════════\n");

for (const row of rows) {
  const icon = row.status === "PASS" ? "✅" : "❌";
  const label = row.status === "PASS" ? "" : ` (expected: ${row.expected}, got: ${row.actual})`;
  console.log(`  ${icon} ${row.scenario}${label}`);
}

console.log(
  `\n  ${passed} / ${rows.length} passed   ${failed > 0 ? `— ${failed} FAILED` : ""}\n`
);

if (failed > 0) {
  console.error("Phase 5A QA: FAILED");
  process.exit(1);
} else {
  console.log("Phase 5A QA: PASSED ✅");
}
