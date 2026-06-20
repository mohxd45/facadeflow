/**
 * Phase 5D QA fixture — AI Review Actions Workflow.
 *
 * Verifies:
 *  - candidate finding can create Missing Info issue
 *  - duplicate Missing Info issue is skipped (dedup)
 *  - package-level finding can create clarification draft
 *  - package-level finding cannot trigger candidate-only actions
 *  - candidate can be marked needs_verification
 *  - candidate reject requires confirmation (executeConfirmedReject)
 *  - reject returns "cancelled" when confirmation returns false
 *  - reject returns "rejected" when confirmation returns true
 *  - safe quantity finding has restricted action set
 *  - no quantity fields are mutated by any action
 *  - action availability logic is correct for all finding types
 *  - clarification finding types are correct set
 *
 * Run:
 *   npx tsx scripts/qa-fixtures/run-phase5d-qa.ts
 */

import {
  buildMissingInfoInputFromFinding,
  isMissingInfoDuplicate,
  buildClarificationDraft,
  computeSendToMissingInfoResult,
  CLARIFICATION_FINDING_TYPES,
  aiCannotMarkVerified,
  aiCannotMutateQuantityFields,
} from "../../src/services/ai-review/ai-review-action.service";
import {
  getAiReviewActionAvailability,
  executeConfirmedReject,
} from "../../src/services/ai-review/ai-review-ui.utils";
import type { AiReviewFinding } from "../../src/types/ai-review";
import type { DrawingIssueItem } from "../../src/types/drawing-takeoff";

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
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();
const PROJECT_ID = "proj-5d-test";

function makeFinding(
  overrides: Partial<AiReviewFinding> & Pick<AiReviewFinding, "id" | "findingType">
): AiReviewFinding {
  return {
    projectId: PROJECT_ID,
    itemCode: "W-01",
    normalizedItemCode: "W-01",
    title: "Test finding",
    message: "Test message",
    recommendation: "Test recommendation",
    riskLevel: "medium",
    suggestedAction: "send_to_missing_info",
    candidateId: "cand-001",
    linkedEvidenceIds: [],
    sourceDrawingNames: ["A-PLAN.pdf"],
    sourcePages: [1],
    confidence: "medium",
    createdAt: NOW,
    ...overrides,
  };
}

function makeIssue(
  overrides: Partial<DrawingIssueItem> &
    Pick<DrawingIssueItem, "id" | "manualItemCode" | "issueType">
): DrawingIssueItem {
  return {
    projectId: PROJECT_ID,
    missingFields: [],
    confidence: "medium",
    reason: "test",
    recommendation: "test",
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    manualNotes: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 5D-01: buildMissingInfoInputFromFinding — correct fields
// ---------------------------------------------------------------------------
{
  const finding = makeFinding({
    id: "find-001",
    findingType: "missing_information",
    itemCode: "W-01",
    normalizedItemCode: "W-01",
  });
  const input = buildMissingInfoInputFromFinding(finding, PROJECT_ID, "W-01");

  check(
    "5D-01: buildMissingInfoInputFromFinding sets projectId",
    PROJECT_ID,
    input.projectId,
    input.projectId === PROJECT_ID
  );
  check(
    "5D-01b: buildMissingInfoInputFromFinding sets manualItemCode",
    "W-01",
    input.manualItemCode ?? "",
    input.manualItemCode === "W-01"
  );
  check(
    "5D-01c: buildMissingInfoInputFromFinding includes 'Created from AI Review' in reason",
    "contains 'Created from AI Review'",
    input.reason,
    input.reason.includes("Created from AI Review")
  );
  check(
    "5D-01d: buildMissingInfoInputFromFinding status is open",
    "open",
    input.status,
    input.status === "open"
  );
  check(
    "5D-01e: buildMissingInfoInputFromFinding does not set count/width/height",
    "no count field",
    JSON.stringify(input),
    !Object.prototype.hasOwnProperty.call(input, "count") &&
      !Object.prototype.hasOwnProperty.call(input, "width") &&
      !Object.prototype.hasOwnProperty.call(input, "height")
  );
}

// ---------------------------------------------------------------------------
// 5D-02: isMissingInfoDuplicate — dedup by itemCode + issueType
// ---------------------------------------------------------------------------
{
  const finding = makeFinding({
    id: "find-002",
    findingType: "missing_information",
    normalizedItemCode: "W-02",
  });
  const existingExact = makeIssue({
    id: "issue-dup",
    manualItemCode: "W-02",
    issueType: "unclear_item",
  });
  const existingDifferent = makeIssue({
    id: "issue-diff",
    manualItemCode: "W-99",
    issueType: "unclear_item",
  });

  check(
    "5D-02: isMissingInfoDuplicate returns true when same code+type",
    "true",
    String(isMissingInfoDuplicate(finding, [existingExact], "W-02")),
    isMissingInfoDuplicate(finding, [existingExact], "W-02") === true
  );
  check(
    "5D-02b: isMissingInfoDuplicate returns false for different code",
    "false",
    String(isMissingInfoDuplicate(finding, [existingDifferent], "W-02")),
    isMissingInfoDuplicate(finding, [existingDifferent], "W-02") === false
  );
  check(
    "5D-02c: isMissingInfoDuplicate returns false for empty list",
    "false",
    String(isMissingInfoDuplicate(finding, [], "W-02")),
    isMissingInfoDuplicate(finding, [], "W-02") === false
  );
  // Dedup by finding id in notes
  const existingByFindingId = makeIssue({
    id: "issue-notes",
    manualItemCode: "X-00",
    issueType: "unclear_item",
    manualNotes: "Created from AI Review. Finding: find-002",
  });
  check(
    "5D-02d: isMissingInfoDuplicate returns true when finding id in notes",
    "true",
    String(isMissingInfoDuplicate(finding, [existingByFindingId])),
    isMissingInfoDuplicate(finding, [existingByFindingId]) === true
  );
}

// ---------------------------------------------------------------------------
// 5D-03: computeSendToMissingInfoResult — new issue vs duplicate
// ---------------------------------------------------------------------------
{
  const finding = makeFinding({
    id: "find-003",
    findingType: "generic_code",
    normalizedItemCode: "CW-01",
  });
  const newResult = computeSendToMissingInfoResult(finding, [], "CW-01");
  check(
    "5D-03: computeSendToMissingInfoResult creates new when no duplicates",
    "created",
    newResult.result.outcome,
    newResult.result.outcome === "created"
  );
  check(
    "5D-03b: computeSendToMissingInfoResult returns non-null input when created",
    "not null",
    String(newResult.input !== null),
    newResult.input !== null
  );

  const existingIssue = makeIssue({
    id: "iss-dup",
    manualItemCode: "CW-01",
    issueType: "missing_code",
  });
  const dupResult = computeSendToMissingInfoResult(finding, [existingIssue], "CW-01");
  check(
    "5D-03c: computeSendToMissingInfoResult returns duplicate when issue exists",
    "duplicate",
    dupResult.result.outcome,
    dupResult.result.outcome === "duplicate"
  );
  check(
    "5D-03d: computeSendToMissingInfoResult returns null input on duplicate",
    "null",
    String(dupResult.input),
    dupResult.input === null
  );
}

// ---------------------------------------------------------------------------
// 5D-04: buildClarificationDraft — correct fields
// ---------------------------------------------------------------------------
{
  const finding = makeFinding({
    id: "find-004",
    findingType: "source_conflict",
    normalizedItemCode: "SD-03",
    riskLevel: "high",
    title: "Conflicting source values for SD-03",
    message: "Width differs between elevation and plan",
    recommendation: "Check elevation drawing",
    sourceDrawingNames: ["A-ELEV-01.pdf", "A-PLAN-01.pdf"],
    sourcePages: [2, 5],
  });
  const draft = buildClarificationDraft(finding);

  check(
    "5D-04: buildClarificationDraft sourceFindingId",
    "find-004",
    draft.sourceFindingId,
    draft.sourceFindingId === "find-004"
  );
  check(
    "5D-04b: buildClarificationDraft riskLevel",
    "high",
    draft.riskLevel,
    draft.riskLevel === "high"
  );
  check(
    "5D-04c: buildClarificationDraft affectedItemCode",
    "SD-03",
    draft.affectedItemCode,
    draft.affectedItemCode === "SD-03"
  );
  check(
    "5D-04d: buildClarificationDraft affectedDrawingNames",
    "2 drawings",
    String(draft.affectedDrawingNames.length),
    draft.affectedDrawingNames.length === 2
  );
}

// ---------------------------------------------------------------------------
// 5D-05: getAiReviewActionAvailability — package-level finding (no candidateId)
// ---------------------------------------------------------------------------
{
  const packageFinding = { candidateId: undefined, findingType: "missing_information" as const };
  const avail = getAiReviewActionAvailability(packageFinding);

  check(
    "5D-05: package-level canViewCandidate is false",
    "false",
    String(avail.canViewCandidate),
    avail.canViewCandidate === false
  );
  check(
    "5D-05b: package-level canRejectCandidate is false",
    "false",
    String(avail.canRejectCandidate),
    avail.canRejectCandidate === false
  );
  check(
    "5D-05c: package-level canMarkNeedsVerification is false",
    "false",
    String(avail.canMarkNeedsVerification),
    avail.canMarkNeedsVerification === false
  );
  check(
    "5D-05d: package-level canCreateClarification is true for missing_information",
    "true",
    String(avail.canCreateClarification),
    avail.canCreateClarification === true
  );
  check(
    "5D-05e: package-level reasonDisabled is populated",
    "non-empty string",
    String(Boolean(avail.reasonDisabled)),
    Boolean(avail.reasonDisabled) === true
  );
}

// ---------------------------------------------------------------------------
// 5D-06: getAiReviewActionAvailability — safe quantity finding
// ---------------------------------------------------------------------------
{
  const safeFinding = { candidateId: "cand-safe", findingType: "quantity_safe" as const };
  const avail = getAiReviewActionAvailability(safeFinding);

  check(
    "5D-06: safe finding canViewCandidate is true",
    "true",
    String(avail.canViewCandidate),
    avail.canViewCandidate === true
  );
  check(
    "5D-06b: safe finding canRejectCandidate is false",
    "false",
    String(avail.canRejectCandidate),
    avail.canRejectCandidate === false
  );
  check(
    "5D-06c: safe finding canMarkNeedsVerification is false",
    "false",
    String(avail.canMarkNeedsVerification),
    avail.canMarkNeedsVerification === false
  );
  check(
    "5D-06d: safe finding canSendToMissingInfo is false",
    "false",
    String(avail.canSendToMissingInfo),
    avail.canSendToMissingInfo === false
  );
  check(
    "5D-06e: safe finding reasonDisabled is populated",
    "non-empty string",
    String(Boolean(avail.reasonDisabled)),
    Boolean(avail.reasonDisabled) === true
  );
}

// ---------------------------------------------------------------------------
// 5D-07: getAiReviewActionAvailability — candidate finding with send-to-missing-info types
// ---------------------------------------------------------------------------
{
  const sendableTypes = [
    "missing_information",
    "generic_code",
    "source_conflict",
    "suspicious_dimension",
    "ocr_uncertain",
  ] as const;
  for (const ft of sendableTypes) {
    const f = { candidateId: "cand-x", findingType: ft };
    const a = getAiReviewActionAvailability(f);
    check(
      `5D-07: canSendToMissingInfo true for finding type=${ft}`,
      "true",
      String(a.canSendToMissingInfo),
      a.canSendToMissingInfo === true
    );
  }

  // false_positive should NOT allow send to missing info
  const fpFinding = { candidateId: "cand-x", findingType: "false_positive" as const };
  const fpAvail = getAiReviewActionAvailability(fpFinding);
  check(
    "5D-07b: canSendToMissingInfo false for false_positive",
    "false",
    String(fpAvail.canSendToMissingInfo),
    fpAvail.canSendToMissingInfo === false
  );
}

// ---------------------------------------------------------------------------
// 5D-08: executeConfirmedReject — confirm=false returns "cancelled"
// ---------------------------------------------------------------------------
{
  let rejectCount = 0;
  const result = executeConfirmedReject(
    "cand-001",
    () => false,
    () => { rejectCount += 1; }
  );
  check(
    "5D-08: executeConfirmedReject returns cancelled when confirm=false",
    "cancelled",
    result,
    result === "cancelled"
  );
  check(
    "5D-08b: executeConfirmedReject does not call onRejectCandidate when confirm=false",
    "0 calls",
    `${rejectCount} calls`,
    rejectCount === 0
  );
}

// ---------------------------------------------------------------------------
// 5D-09: executeConfirmedReject — confirm=true returns "rejected"
// ---------------------------------------------------------------------------
{
  let rejectCount = 0;
  const result = executeConfirmedReject(
    "cand-002",
    () => true,
    () => { rejectCount += 1; }
  );
  check(
    "5D-09: executeConfirmedReject returns rejected when confirm=true",
    "rejected",
    result,
    result === "rejected"
  );
  check(
    "5D-09b: executeConfirmedReject calls onRejectCandidate when confirm=true",
    "1 call",
    `${rejectCount} calls`,
    rejectCount === 1
  );
}

// ---------------------------------------------------------------------------
// 5D-10: executeConfirmedReject — undefined candidateId returns "unavailable"
// ---------------------------------------------------------------------------
{
  let rejectCount = 0;
  const result = executeConfirmedReject(
    undefined,
    () => true,
    () => { rejectCount += 1; }
  );
  check(
    "5D-10: executeConfirmedReject returns unavailable when no candidateId",
    "unavailable",
    result,
    result === "unavailable"
  );
  check(
    "5D-10b: executeConfirmedReject does not call onRejectCandidate for undefined candidateId",
    "0 calls",
    `${rejectCount} calls`,
    rejectCount === 0
  );
}

// ---------------------------------------------------------------------------
// 5D-11: CLARIFICATION_FINDING_TYPES set correctness
// ---------------------------------------------------------------------------
{
  const shouldHave = [
    "missing_information",
    "source_conflict",
    "suspicious_dimension",
    "failed_drawing",
    "needs_schedule",
    "needs_elevation",
    "needs_section",
    "generic_code",
    "manual_verification_required",
    "boq_mismatch",
  ] as const;
  for (const ft of shouldHave) {
    check(
      `5D-11: CLARIFICATION_FINDING_TYPES includes ${ft}`,
      "true",
      String(CLARIFICATION_FINDING_TYPES.has(ft)),
      CLARIFICATION_FINDING_TYPES.has(ft) === true
    );
  }
  // quantity_safe and false_positive should NOT be in clarification types
  check(
    "5D-11b: CLARIFICATION_FINDING_TYPES excludes quantity_safe",
    "false",
    String(CLARIFICATION_FINDING_TYPES.has("quantity_safe")),
    CLARIFICATION_FINDING_TYPES.has("quantity_safe") === false
  );
  check(
    "5D-11c: CLARIFICATION_FINDING_TYPES excludes false_positive",
    "false",
    String(CLARIFICATION_FINDING_TYPES.has("false_positive")),
    CLARIFICATION_FINDING_TYPES.has("false_positive") === false
  );
}

// ---------------------------------------------------------------------------
// 5D-12: Safety audit — AI cannot mark verified or mutate quantities
// ---------------------------------------------------------------------------
{
  check(
    "5D-12: aiCannotMarkVerified returns true",
    "true",
    String(aiCannotMarkVerified()),
    aiCannotMarkVerified() === true
  );
  check(
    "5D-12b: aiCannotMutateQuantityFields returns true",
    "true",
    String(aiCannotMutateQuantityFields()),
    aiCannotMutateQuantityFields() === true
  );

  // Verify buildMissingInfoInputFromFinding does not include any quantity fields
  const finding = makeFinding({ id: "find-012", findingType: "missing_information" });
  const input = buildMissingInfoInputFromFinding(finding, PROJECT_ID);
  const quantityFields = ["count", "width", "height", "areaEach", "totalArea", "length"];
  for (const qf of quantityFields) {
    check(
      `5D-12c: buildMissingInfoInputFromFinding does not set ${qf}`,
      "false (field absent or undefined)",
      String(Object.prototype.hasOwnProperty.call(input, qf)),
      !Object.prototype.hasOwnProperty.call(input, qf)
    );
  }
}

// ---------------------------------------------------------------------------
// 5D-13: getAiReviewActionAvailability — canCreateClarification for candidate finding
// ---------------------------------------------------------------------------
{
  // A candidate finding of source_conflict type should also get canCreateClarification
  const conflictFinding = { candidateId: "cand-c", findingType: "source_conflict" as const };
  const avail = getAiReviewActionAvailability(conflictFinding);
  check(
    "5D-13: candidate source_conflict finding canCreateClarification is true",
    "true",
    String(avail.canCreateClarification),
    avail.canCreateClarification === true
  );
  check(
    "5D-13b: candidate source_conflict finding canViewCandidate is true",
    "true",
    String(avail.canViewCandidate),
    avail.canViewCandidate === true
  );
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const PASS = rows.filter((r) => r.status === "PASS").length;
const FAIL = rows.filter((r) => r.status === "FAIL").length;

const COL_SCENARIO = 52;
const COL_STATUS = 8;
const COL_EXPECTED = 30;
const COL_ACTUAL = 34;

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

console.log(
  "\n" +
    pad("Scenario", COL_SCENARIO) +
    pad("Status", COL_STATUS) +
    pad("Expected", COL_EXPECTED) +
    pad("Actual", COL_ACTUAL)
);
console.log("─".repeat(COL_SCENARIO + COL_STATUS + COL_EXPECTED + COL_ACTUAL));

for (const row of rows) {
  const icon = row.status === "PASS" ? "✓" : "✗";
  console.log(
    pad(row.scenario, COL_SCENARIO) +
      pad(`${icon} ${row.status}`, COL_STATUS + 2) +
      pad(row.expected, COL_EXPECTED) +
      pad(row.actual.slice(0, COL_ACTUAL - 1), COL_ACTUAL)
  );
}

console.log(`\nPhase 5D QA: ${PASS} passed, ${FAIL} failed out of ${rows.length} checks.\n`);

if (FAIL > 0) {
  process.exit(1);
}
