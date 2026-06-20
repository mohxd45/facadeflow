/**
 * Phase 5B QA fixture — AI Review UI mapping/filter/search safety checks.
 *
 * Run:
 *   npx tsx scripts/qa-fixtures/run-phase5b-qa.ts
 */

import fs from "node:fs";
import path from "node:path";
import { runMockAiDrawingReview } from "../../src/services/ai-review/ai-drawing-review.service";
import {
  AI_REVIEW_ADVISORY_TEXT,
  executeConfirmedReject,
  filterAiReviewFindings,
  getAiReviewActionAvailability,
  getAiReviewSummaryCounts,
  toAiReviewRows,
} from "../../src/services/ai-review/ai-review-ui.utils";
import type {
  CrossDrawingBuildResult,
  CrossDrawingBuildStats,
  CrossDrawingQuantityCandidate,
  CrossDrawingValueSource,
} from "../../src/types/cross-drawing-quantity";

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
  drawingName = "A-PLAN-01.pdf"
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
    projectId: "proj-ui",
    description: "UI fixture item",
    category: "windows",
    unit: "sqm",
    linkedEvidenceIds: [],
    sourceDrawingIds: ["dwg-001"],
    sourceDrawingNames: ["A-PLAN-01.pdf"],
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
    totalEvidence: 4,
    groupedItems: 4,
    completeCandidates: 1,
    needsVerification: 3,
    missingInfoCreated: 0,
    highConfidence: 1,
    mediumConfidence: 2,
    lowConfidence: 1,
    conflictingValues: 1,
    genericCodes: 1,
    ocrSourcedCandidates: 1,
  };
}

function run() {
  const candidates: CrossDrawingQuantityCandidate[] = [
    makeCandidate({
      id: "cand-safe",
      itemCode: "W-02",
      normalizedItemCode: "W-02",
      width: 1.2,
      height: 1.6,
      count: 3,
      widthSource: makeSource("pdf_text", "A-SCHED-01.pdf"),
      heightSource: makeSource("pdf_text", "A-SCHED-01.pdf"),
      countSource: makeSource("pdf_text", "A-PLAN-01.pdf"),
    }),
    makeCandidate({
      id: "cand-conflict",
      itemCode: "W-13",
      normalizedItemCode: "W-13",
      width: 2.0,
      height: 2.2,
      count: 2,
      warnings: ["Multiple possible widths found: 2.0m, 4.5m — conflict flagged."],
      sourceDrawingNames: ["A-SCHED-01.pdf", "A-ELEV-01.pdf"],
    }),
    makeCandidate({
      id: "cand-generic",
      itemCode: "SD",
      normalizedItemCode: "SD",
      missingFields: ["width", "height", "count"],
      confidence: "low",
    }),
    makeCandidate({
      id: "cand-ocr",
      itemCode: "W-04",
      normalizedItemCode: "W-04",
      width: 1.1,
      height: 1.5,
      count: 2,
      widthSource: makeSource("ocr_text"),
      heightSource: makeSource("ocr_text"),
      countSource: makeSource("ocr_text"),
      confidence: "medium",
    }),
  ];

  const candidateSnapshot = JSON.parse(
    JSON.stringify(candidates)
  ) as CrossDrawingQuantityCandidate[];

  const crossDrawingResult: CrossDrawingBuildResult = {
    projectId: "proj-ui",
    candidates,
    unresolvedIssueIds: [],
    warnings: [],
    stats: makeStats(),
  };

  const result = runMockAiDrawingReview({
    projectId: "proj-ui",
    crossDrawingResult,
    packageAnalysisResult: {
      hasPlan: true,
      hasElevation: false,
      hasSchedule: true,
      hasSection: false,
    },
    failedDrawingDiagnostics: [
      {
        drawingId: "dwg-failed",
        drawingName: "A-ELEV-NORTH.pdf",
        errorMessage: "Blob missing",
      },
    ],
  });

  const mappedRows = toAiReviewRows(result.findings);
  check(
    "5B-1: findings map to UI rows",
    "rows count = findings count",
    `${mappedRows.length} vs ${result.findings.length}`,
    mappedRows.length === result.findings.length
  );
  check(
    "5B-2: mapped rows include display labels",
    "row has findingTypeLabel and suggestedActionLabel",
    mappedRows[0]?.findingTypeLabel && mappedRows[0]?.suggestedActionLabel
      ? "labels present"
      : "labels missing",
    Boolean(mappedRows[0]?.findingTypeLabel && mappedRows[0]?.suggestedActionLabel)
  );

  const candidateLinkedRows = mappedRows.filter((r) => Boolean(r.candidateId));
  const packageLevelRows = mappedRows.filter((r) => !r.candidateId);
  check(
    "5B-2b: candidate-linked rows are present",
    ">= 4 candidate-linked rows",
    String(candidateLinkedRows.length),
    candidateLinkedRows.length >= 4
  );
  check(
    "5B-2c: package-level rows are present",
    ">= 1 package-level row",
    String(packageLevelRows.length),
    packageLevelRows.length >= 1
  );

  const counts = getAiReviewSummaryCounts(result);
  check(
    "5B-3: risk counts include critical/high",
    ">= 2",
    String(counts.criticalHighRisk),
    counts.criticalHighRisk >= 2
  );
  check(
    "5B-4: source conflict count is correct",
    "1",
    String(counts.sourceConflicts),
    counts.sourceConflicts === 1
  );
  check(
    "5B-5: failed drawing count is correct",
    "1",
    String(counts.failedDrawings),
    counts.failedDrawings === 1
  );

  const highRiskOnly = filterAiReviewFindings(
    result.findings,
    "critical_high",
    ""
  );
  check(
    "5B-6: critical/high filter works",
    "all high/critical",
    highRiskOnly.every((f) => f.riskLevel === "high" || f.riskLevel === "critical")
      ? "all high/critical"
      : "contains lower risk",
    highRiskOnly.every((f) => f.riskLevel === "high" || f.riskLevel === "critical")
  );

  const genericOnly = filterAiReviewFindings(result.findings, "generic_code", "");
  check(
    "5B-7: generic code filter works",
    "1 generic finding",
    String(genericOnly.length),
    genericOnly.length === 1 && genericOnly[0].findingType === "generic_code"
  );

  const searchByCode = filterAiReviewFindings(result.findings, "all", "w-13");
  check(
    "5B-8: search by item code works",
    ">=1 result",
    String(searchByCode.length),
    searchByCode.length >= 1
  );

  const searchByDrawing = filterAiReviewFindings(result.findings, "all", "a-elev");
  check(
    "5B-9: search by source drawing name works",
    ">=1 result",
    String(searchByDrawing.length),
    searchByDrawing.length >= 1
  );

  check(
    "5B-10: advisory text constant exists",
    "non-empty advisory text",
    AI_REVIEW_ADVISORY_TEXT,
    AI_REVIEW_ADVISORY_TEXT.trim().length > 0
  );

  const sectionPath = path.resolve(
    process.cwd(),
    "src/components/projects/AiReviewSection.tsx"
  );
  const sectionSource = fs.readFileSync(sectionPath, "utf8");
  check(
    "5B-11: advisory text is present in AI Review UI source",
    "contains advisory text usage",
    sectionSource.includes("AI_REVIEW_ADVISORY_TEXT") ? "present" : "missing",
    sectionSource.includes("AI_REVIEW_ADVISORY_TEXT")
  );
  check(
    "5B-12: reject action requires user confirmation",
    "contains window.confirm",
    sectionSource.includes("window.confirm") ? "present" : "missing",
    sectionSource.includes("window.confirm")
  );
  check(
    "5B-13: phase-5D workflow actions are implemented (WorkflowCell exists)",
    "contains 'WorkflowCell'",
    sectionSource.includes("WorkflowCell") ? "present" : "missing",
    sectionSource.includes("WorkflowCell")
  );

  check(
    "5B-13b: persisted-result warning text exists",
    "contains stale-result warning copy",
    sectionSource.includes("Showing the last saved AI Review result.")
      ? "present"
      : "missing",
    sectionSource.includes("Showing the last saved AI Review result.")
  );
  check(
    "5B-13c: pre-analysis empty-state is hidden when result exists",
    "contains analysisStatus !== \"done\" && !result guard",
    sectionSource.includes("analysisStatus !== \"done\" && !result")
      ? "present"
      : "missing",
    sectionSource.includes("analysisStatus !== \"done\" && !result")
  );

  check(
    "5B-13d: candidateId-gated action branch exists",
    "contains action availability guard",
    sectionSource.includes("getAiReviewActionAvailability")
      ? "present"
      : "missing",
    sectionSource.includes("getAiReviewActionAvailability")
  );

  // Reject confirmation path (test env only)
  let rejectCalls = 0;
  const rejectSpy = () => {
    rejectCalls += 1;
  };
  const rejectFalse = executeConfirmedReject(
    "cand-safe",
    () => false,
    rejectSpy
  );
  check(
    "5B-13e: reject does not run when confirmation is false",
    "cancelled + 0 calls",
    `${rejectFalse} + ${rejectCalls} calls`,
    rejectFalse === "cancelled" && rejectCalls === 0
  );

  const rejectTrue = executeConfirmedReject(
    "cand-safe",
    () => true,
    rejectSpy
  );
  check(
    "5B-13f: reject runs when confirmation is true",
    "rejected + 1 call",
    `${rejectTrue} + ${rejectCalls} calls`,
    rejectTrue === "rejected" && rejectCalls === 1
  );

  const rejectPackageLevel = executeConfirmedReject(
    undefined,
    () => true,
    rejectSpy
  );
  check(
    "5B-13g: package-level findings cannot trigger reject",
    "unavailable + no extra calls",
    `${rejectPackageLevel} + ${rejectCalls} calls`,
    rejectPackageLevel === "unavailable" && rejectCalls === 1
  );

  // Phase 5D: safe quantity findings (quantity_safe) are view-only — no reject allowed.
  // The estimator must manually review them; they don't need rejection.
  const candidateAvailability = getAiReviewActionAvailability({
    candidateId: "cand-safe",
    findingType: "quantity_safe",
  });
  check(
    "5B-13h: safe quantity finding has canViewCandidate=true but canRejectCandidate=false (Phase 5D)",
    "canViewCandidate=true canRejectCandidate=false",
    `canViewCandidate=${candidateAvailability.canViewCandidate} canRejectCandidate=${candidateAvailability.canRejectCandidate}`,
    candidateAvailability.canViewCandidate === true &&
      candidateAvailability.canRejectCandidate === false
  );
  const packageAvailability = getAiReviewActionAvailability({
    candidateId: undefined,
    findingType: "failed_drawing",
  });
  check(
    "5B-13i: package-level finding has no destructive actions",
    "canRejectCandidate=false",
    String(packageAvailability.canRejectCandidate),
    packageAvailability.canRejectCandidate === false
  );

  // Pure/UI safety check: mapping/filter/search should not mutate source findings or candidates.
  void toAiReviewRows(result.findings);
  void filterAiReviewFindings(result.findings, "all", "window");
  const candidatesMutated = JSON.stringify(candidates) !== JSON.stringify(candidateSnapshot);
  check(
    "5B-14: UI mapping/filter does not mutate quantity candidates",
    "no mutation",
    candidatesMutated ? "mutation detected" : "no mutation",
    !candidatesMutated
  );

  // No destructive action auto-run check (source heuristic).
  const hasAutoReject = sectionSource.includes("onRejectCandidate(") &&
    !sectionSource.includes("window.confirm(");
  check(
    "5B-15: no destructive action executes automatically",
    "reject is confirmation-gated",
    hasAutoReject ? "unsafe auto reject pattern" : "confirmation-gated",
    !hasAutoReject
  );
}

run();

const passed = rows.filter((r) => r.status === "PASS").length;
const failed = rows.filter((r) => r.status === "FAIL").length;

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  Phase 5B QA — AI Review UI");
console.log("═══════════════════════════════════════════════════════════\n");

for (const row of rows) {
  const icon = row.status === "PASS" ? "✅" : "❌";
  const label =
    row.status === "PASS" ? "" : ` (expected: ${row.expected}, got: ${row.actual})`;
  console.log(`  ${icon} ${row.scenario}${label}`);
}

console.log(
  `\n  ${passed} / ${rows.length} passed   ${failed > 0 ? `— ${failed} FAILED` : ""}\n`
);

if (failed > 0) {
  console.error("Phase 5B QA: FAILED");
  process.exit(1);
} else {
  console.log("Phase 5B QA: PASSED ✅");
}

