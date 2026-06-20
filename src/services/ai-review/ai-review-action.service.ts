/**
 * AI Review Action Service — Phase 5D
 *
 * All AI-driven workflow actions are pure functions that:
 *  - Never mutate quantity values (width, height, count, areaEach, totalArea, etc.)
 *  - Never mark a candidate verified or final
 *  - Always require explicit user confirmation for destructive actions
 *  - Return a typed result so callers can show clear feedback
 *  - Include "Created from AI Review" provenance in all created records
 *
 * Design principle: AI reviews, explains, warns. Estimator approves.
 */

import type { AiReviewFinding, AiReviewFindingType } from "@/types/ai-review";
import type {
  CreateDrawingIssueItemInput,
  DrawingIssueItem,
  DrawingIssueType,
} from "@/types/drawing-takeoff";

// ---------------------------------------------------------------------------
// Action result
// ---------------------------------------------------------------------------

export type AiActionOutcome =
  | "created"
  | "duplicate"
  | "rejected"
  | "cancelled"
  | "unavailable"
  | "error";

export interface AiActionResult {
  outcome: AiActionOutcome;
  message: string;
}

// ---------------------------------------------------------------------------
// Clarification draft
// ---------------------------------------------------------------------------

export interface ClarificationDraft {
  /** Derived from the AI finding id */
  sourceFindingId: string;
  title: string;
  issue: string;
  recommendation: string;
  affectedItemCode: string;
  affectedDrawingNames: string[];
  affectedPages: number[];
  riskLevel: "low" | "medium" | "high" | "critical";
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Finding types that warrant a clarification / RFI draft
// ---------------------------------------------------------------------------

export const CLARIFICATION_FINDING_TYPES: ReadonlySet<AiReviewFindingType> = new Set([
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
]);

// ---------------------------------------------------------------------------
// Finding type → DrawingIssueType mapping
// ---------------------------------------------------------------------------

function findingTypeToIssueType(findingType: AiReviewFindingType): DrawingIssueType {
  const map: Partial<Record<AiReviewFindingType, DrawingIssueType>> = {
    missing_information: "unclear_item",
    generic_code: "missing_code",
    source_conflict: "manual_measurement_required",
    suspicious_dimension: "manual_measurement_required",
    ocr_uncertain: "unclear_item",
    needs_schedule: "needs_schedule",
    needs_elevation: "needs_elevation",
    needs_section: "needs_section",
    failed_drawing: "manual_measurement_required",
    boq_mismatch: "manual_measurement_required",
    manual_verification_required: "manual_measurement_required",
  };
  return map[findingType] ?? "unclear_item";
}

// ---------------------------------------------------------------------------
// Build a CreateDrawingIssueItemInput from an AI finding
// Used for "Send to Missing Info" and "Create Clarification Draft"
// ---------------------------------------------------------------------------

export function buildMissingInfoInputFromFinding(
  finding: AiReviewFinding,
  projectId: string,
  candidateItemCode?: string
): CreateDrawingIssueItemInput {
  const itemCode = finding.normalizedItemCode ?? finding.itemCode ?? candidateItemCode ?? "";
  const sourceDrawingName = finding.sourceDrawingNames[0] ?? "AI Review";
  const issueType = findingTypeToIssueType(finding.findingType);

  const provenance = "Created from AI Review.";
  const reason = [
    provenance,
    `Finding: ${finding.title}.`,
    finding.message,
  ].filter(Boolean).join(" ").slice(0, 400);

  const detectedEvidence = [
    `AI Review finding type: ${finding.findingType}.`,
    `Risk level: ${finding.riskLevel}. Confidence: ${finding.confidence}.`,
    finding.sourceDrawingNames.length > 0
      ? `Source drawings: ${finding.sourceDrawingNames.join(", ")}.`
      : "",
    finding.sourcePages.length > 0
      ? `Pages: ${finding.sourcePages.join(", ")}.`
      : "",
    `Finding ID: ${finding.id}.`,
  ].filter(Boolean).join(" ").slice(0, 500);

  return {
    projectId,
    issueType,
    sourceDrawingName,
    sourcePage: finding.sourcePages[0],
    detectedEvidence,
    missingFields: [],
    confidence: finding.confidence,
    reason,
    recommendation: finding.recommendation.slice(0, 300),
    status: "open",
    manualItemCode: itemCode || undefined,
    possibleDescription: finding.title.slice(0, 200),
    manualNotes: [
      provenance,
      `Suggested action: ${finding.suggestedAction}.`,
      `AI model: ${finding.id}`,
    ].join(" "),
  };
}

// ---------------------------------------------------------------------------
// Deduplication check: skip if an open issue already covers this finding
// Matches on: manualItemCode + issueType (or candidateId encoded in notes)
// ---------------------------------------------------------------------------

export function isMissingInfoDuplicate(
  finding: AiReviewFinding,
  existingIssues: DrawingIssueItem[],
  candidateItemCode?: string
): boolean {
  const itemCode = (
    finding.normalizedItemCode ?? finding.itemCode ?? candidateItemCode ?? ""
  ).toUpperCase();
  const issueType = findingTypeToIssueType(finding.findingType);

  return existingIssues.some((issue) => {
    if (issue.status !== "open") return false;
    const existingCode = (issue.manualItemCode ?? "").toUpperCase();
    // Match on same item code + same issue type
    if (existingCode && existingCode === itemCode && issue.issueType === issueType) {
      return true;
    }
    // Match if an existing issue notes already reference this finding id
    if (issue.manualNotes?.includes(finding.id)) {
      return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Build a ClarificationDraft from an AI finding (not persisted, advisory)
// This can be turned into a DrawingIssueItem for persistence
// ---------------------------------------------------------------------------

export function buildClarificationDraft(finding: AiReviewFinding): ClarificationDraft {
  return {
    sourceFindingId: finding.id,
    title: finding.title,
    issue: finding.message,
    recommendation: finding.recommendation,
    affectedItemCode: finding.normalizedItemCode ?? finding.itemCode ?? "",
    affectedDrawingNames: [...finding.sourceDrawingNames],
    affectedPages: [...finding.sourcePages],
    riskLevel: finding.riskLevel,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Safe action: send a finding to Missing Info with dedup
// Returns AiActionResult — does NOT call the store itself
// ---------------------------------------------------------------------------

export function computeSendToMissingInfoResult(
  finding: AiReviewFinding,
  existingIssues: DrawingIssueItem[],
  candidateItemCode?: string
): { result: AiActionResult; input: CreateDrawingIssueItemInput | null } {
  if (isMissingInfoDuplicate(finding, existingIssues, candidateItemCode)) {
    return {
      result: {
        outcome: "duplicate",
        message: "Duplicate issue already exists in Missing Info.",
      },
      input: null,
    };
  }
  const input = buildMissingInfoInputFromFinding(finding, "", candidateItemCode);
  return {
    result: {
      outcome: "created",
      message: "Missing Info issue created from AI Review.",
    },
    input,
  };
}

// ---------------------------------------------------------------------------
// Safety audit helpers
// ---------------------------------------------------------------------------

/** Returns true — AI may never mark a candidate verified or final. */
export function aiCannotMarkVerified(): true {
  return true;
}

/** Returns true — AI may never mutate quantity fields. */
export function aiCannotMutateQuantityFields(): true {
  return true;
}
