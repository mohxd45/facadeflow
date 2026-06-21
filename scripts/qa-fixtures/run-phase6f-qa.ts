/**
 * Phase 6F QA fixture — Drawing Intelligence to Quantity Candidate Integration
 */

import type { ReconciledElement, DrawingSheetRef } from "../../src/types/drawing-intelligence";
import type { DrawingIssueItem, DrawingTakeoffItem } from "../../src/types/drawing-takeoff";
import {
  buildSafeTakeoffDraftFromReconciled,
  computeAcceptAsCandidateResult,
  computeCreateClarificationResult,
  computeCreateMissingInfoResult,
  noFinalOrVerifiedFromAiOnly,
  rejectSuggestionSafely,
} from "../../src/services/drawing-intelligence/drawing-intelligence-candidate-action.service";

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

const PROJECT_ID = "proj-6f";
const NOW = new Date().toISOString();

function makeSheet(id: string, page = 1): DrawingSheetRef {
  return { drawingId: id, drawingName: `${id}.pdf`, sourceFormat: "pdf_text", page };
}

function makeElement(overrides?: Partial<ReconciledElement>): ReconciledElement {
  const sheet = overrides?.sheet ?? makeSheet("s1", 1);
  return {
    id: overrides?.id ?? "recon-1",
    sheet,
    matchStatus: overrides?.matchStatus ?? "matched",
    confidence: overrides?.confidence ?? "high",
    systemCodeDetection: overrides?.systemCodeDetection ?? {
      id: "sys-code-1",
      sheet,
      rawText: "W-01",
      normalizedCode: "W-01",
      confidence: "high",
      source: "pdf_text",
      detectedAt: NOW,
    },
    systemDimensionDetection:
      overrides?.systemDimensionDetection ??
      ({
        id: "sys-dim-1",
        sheet,
        rawText: "1.2x1.5",
        widthM: 1.2,
        heightM: 1.5,
        lengthM: null,
        confidence: "high",
        source: "pdf_text",
        detectedAt: NOW,
      } as ReconciledElement["systemDimensionDetection"]),
    aiDetection:
      overrides?.aiDetection ??
      ({
        id: "ai-1",
        sheet,
        detectionType: "possible_window",
        aiConfidence: 0.8,
        status: "possible",
        detectedAt: NOW,
      } as ReconciledElement["aiDetection"]),
    inferredType: overrides?.inferredType ?? "possible_window",
    hintWidthM: overrides?.hintWidthM ?? 1.2,
    hintHeightM: overrides?.hintHeightM ?? 1.5,
    flaggedIssues: overrides?.flaggedIssues ?? [],
    estimatorAction: overrides?.estimatorAction ?? "accept_system_values",
    recommendedEstimatorAction: overrides?.recommendedEstimatorAction ?? "accept_as_candidate",
    reconciledAt: NOW,
  };
}

function makeExistingIssue(reason: string): DrawingIssueItem {
  return {
    id: "issue-1",
    projectId: PROJECT_ID,
    issueType: "unclear_item",
    missingFields: ["verification_required"],
    confidence: "medium",
    reason,
    recommendation: "Review",
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeExistingTakeoff(notes: string): DrawingTakeoffItem {
  return {
    id: "takeoff-1",
    projectId: PROJECT_ID,
    description: "Existing DI row",
    category: "windows",
    unit: "sqm",
    sourceType: "manual_verify",
    confidence: "medium",
    warnings: [],
    status: "draft",
    notes,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function run() {
  // 6F-01 matched result can create candidate draft safely
  {
    const element = makeElement({ id: "r-matched", matchStatus: "matched" });
    const { result, input } = computeAcceptAsCandidateResult(element, PROJECT_ID, []);
    check("6F-01: matched creates candidate input", "created", result.outcome, result.outcome === "created" && !!input);
    check("6F-01b: matched candidate is draft (not final)", "draft", String(input?.status), input?.status === "draft");
  }

  // 6F-02 ai_only creates needs-verification candidate only
  {
    const element = makeElement({
      id: "r-ai-only",
      matchStatus: "ai_only",
      systemCodeDetection: undefined,
      systemDimensionDetection: undefined,
      hintWidthM: undefined,
      hintHeightM: undefined,
    });
    const built = buildSafeTakeoffDraftFromReconciled(element, PROJECT_ID);
    check("6F-02: ai_only produces candidate input", "input", built.input ? "input" : "null", !!built.input);
    check(
      "6F-02b: ai_only candidate status is needs_verification",
      "needs_verification",
      String(built.input?.status),
      built.input?.status === "needs_verification"
    );
    check(
      "6F-02c: ai_only candidate cannot be final/verified",
      "true",
      String(built.input ? noFinalOrVerifiedFromAiOnly(built.input) : false),
      built.input ? noFinalOrVerifiedFromAiOnly(built.input) : false
    );
  }

  // 6F-03 conflict cannot create final/verified candidate
  {
    const conflict = makeElement({ id: "r-conflict", matchStatus: "conflict" });
    const { result, input } = computeAcceptAsCandidateResult(conflict, PROJECT_ID, []);
    check("6F-03: conflict blocks accept-as-candidate", "blocked", result.outcome, result.outcome === "blocked");
    check("6F-03b: blocked conflict returns no candidate input", "null", String(input), input === null);
  }

  // 6F-04 duplicate candidate prevention
  {
    const element = makeElement({ id: "r-dup" });
    const existing = [makeExistingTakeoff("Created from Drawing Intelligence. DI_RECON:r-dup.")];
    const { result, input } = computeAcceptAsCandidateResult(element, PROJECT_ID, existing);
    check("6F-04: duplicate candidate is prevented", "duplicate", result.outcome, result.outcome === "duplicate");
    check("6F-04b: duplicate returns no input", "null", String(input), input === null);
  }

  // 6F-05 missing info action works/dedupes
  {
    const element = makeElement({ id: "r-miss", matchStatus: "needs_verification" });
    const first = computeCreateMissingInfoResult(element, PROJECT_ID, []);
    check("6F-05: missing info can be created", "created", first.result.outcome, first.result.outcome === "created" && !!first.input);
    const dup = computeCreateMissingInfoResult(
      element,
      PROJECT_ID,
      [makeExistingIssue(`Created from Drawing Intelligence. DI_RECON:r-miss.`)]
    );
    check("6F-05b: missing info dedupes", "duplicate", dup.result.outcome, dup.result.outcome === "duplicate");
  }

  // 6F-06 clarification action works/dedupes
  {
    const element = makeElement({ id: "r-clar", matchStatus: "conflict" });
    const first = computeCreateClarificationResult(element, PROJECT_ID, []);
    check("6F-06: clarification can be created", "created", first.result.outcome, first.result.outcome === "created" && !!first.input);
    const dup = computeCreateClarificationResult(
      element,
      PROJECT_ID,
      [makeExistingIssue(`Created from Drawing Intelligence. DI_RECON:r-clar.`)]
    );
    check("6F-06b: clarification dedupes", "duplicate", dup.result.outcome, dup.result.outcome === "duplicate");
  }

  // 6F-07 reject suggestion does not delete source data
  {
    const element = makeElement({ id: "r-reject", matchStatus: "ai_only" });
    const result = rejectSuggestionSafely(element);
    check("6F-07: reject suggestion returns acknowledged result", "acknowledged", result.outcome, result.outcome === "acknowledged");
    check(
      "6F-07b: reject message confirms source preserved",
      "contains preserved",
      result.message,
      result.message.toLowerCase().includes("preserved")
    );
  }

  // 6F-08 no silent dimension overwrite
  {
    const element = makeElement({
      id: "r-no-overwrite",
      matchStatus: "matched",
      hintWidthM: 9.9, // should be ignored in favor of system dimension if system exists
      hintHeightM: 9.9,
      systemDimensionDetection: {
        id: "sys-dim-1",
        sheet: makeSheet("s1", 1),
        rawText: "1.2x1.5",
        widthM: 1.2,
        heightM: 1.5,
        lengthM: null,
        confidence: "high",
        source: "pdf_text",
        detectedAt: NOW,
      },
    });
    const built = buildSafeTakeoffDraftFromReconciled(element, PROJECT_ID);
    check("6F-08: candidate width uses safe reconciled hint", "1.2", String(built.input?.width), built.input?.width === 1.2);
    check("6F-08b: candidate height uses safe reconciled hint", "1.5", String(built.input?.height), built.input?.height === 1.5);
  }

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
  console.log(`\nPhase 6F QA: ${pass} passed, ${fail} failed out of ${rows.length} checks.\n`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Phase 6F QA fatal error:", err);
  process.exit(1);
});

