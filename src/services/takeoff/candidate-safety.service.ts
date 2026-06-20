/**
 * Candidate Safety Service — Pre-Phase 4 cleanup
 *
 * Deduplicates evidence-only rows, validates completeness, and converts
 * incomplete candidates into Missing Info issues. No invented quantities.
 */

import type {
  CreateDrawingIssueItemInput,
  DrawingIssueType,
  DrawingTakeoffCandidate,
} from "@/types/drawing-takeoff";
import { DRAWING_CODE_RULES } from "@/types/drawing-takeoff";
import type { DrawingEvidence } from "@/types/drawing-package";

// ---------------------------------------------------------------------------
// Code helpers
// ---------------------------------------------------------------------------

export function normalizeItemCode(code?: string): string {
  return (code ?? "").trim().toUpperCase();
}

/** Bare prefix without item number, e.g. SD, CW, D — not safe as final qty. */
export function isGenericUnnumberedCode(itemCode?: string): boolean {
  if (!itemCode?.trim()) return false;
  const upper = itemCode.trim().toUpperCase();
  if (/-\d/.test(upper)) return false;
  return /^[A-Z]+(?:\/[A-Z]+)?$/.test(upper);
}

export function isDimensionClearlyAttached(
  contextText: string,
  itemCode: string
): boolean {
  const escaped = itemCode.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(
    `${escaped}[\\s:(\\[]*(\\d+(?:\\.\\d+)?)\\s*[xX×]\\s*(\\d+(?:\\.\\d+)?)`,
    "i"
  );
  return re.test(contextText);
}

export function isScheduleContext(sheetTitle?: string | null): boolean {
  return !!sheetTitle && /schedule/i.test(sheetTitle);
}

// ---------------------------------------------------------------------------
// Completeness / save eligibility
// ---------------------------------------------------------------------------

export function getCandidateMissingFields(
  candidate: DrawingTakeoffCandidate
): string[] {
  const missing: string[] = [];

  if (candidate.needsVerification || isGenericUnnumberedCode(candidate.itemCode)) {
    missing.push("itemCode");
  }

  if (candidate.unit === "sqm") {
    if (candidate.width === undefined) missing.push("width");
    if (candidate.height === undefined) missing.push("height");
    if (candidate.count === undefined) missing.push("count");
  }

  if (candidate.unit === "lm" && candidate.length === undefined) {
    missing.push("length");
  }

  return missing;
}

export function isCandidateComplete(candidate: DrawingTakeoffCandidate): boolean {
  return (
    getCandidateMissingFields(candidate).length === 0 &&
    !candidate.needsVerification
  );
}

export function canSaveAsVerified(candidate: DrawingTakeoffCandidate): boolean {
  return isCandidateComplete(candidate) && candidate.confidence === "high";
}

export function hasIncompleteSelected(
  candidates: DrawingTakeoffCandidate[]
): boolean {
  return candidates.some((c) => !isCandidateComplete(c));
}

// ---------------------------------------------------------------------------
// Summary stats for UI
// ---------------------------------------------------------------------------

export interface CandidateSafetySummary {
  total: number;
  complete: number;
  needsVerification: number;
  missingSizeOrCount: number;
  groupedDuplicates: number;
  genericCodes: number;
}

export function summarizeCandidates(
  candidates: DrawingTakeoffCandidate[]
): CandidateSafetySummary {
  let complete = 0;
  let needsVerification = 0;
  let missingSizeOrCount = 0;
  let groupedDuplicates = 0;
  let genericCodes = 0;

  for (const c of candidates) {
    const missing = getCandidateMissingFields(c);
    if (c.needsVerification || isGenericUnnumberedCode(c.itemCode)) genericCodes++;
    if ((c.occurrenceCount ?? 1) > 1) groupedDuplicates++;
    if (c.needsVerification) needsVerification++;
    else if (missing.length > 0) missingSizeOrCount++;
    else if (isCandidateComplete(c)) complete++;
    else needsVerification++;
  }

  return {
    total: candidates.length,
    complete,
    needsVerification,
    missingSizeOrCount,
    groupedDuplicates,
    genericCodes,
  };
}

// ---------------------------------------------------------------------------
// Deduplication — group same code on same drawing/page
// ---------------------------------------------------------------------------

function pickPrimaryCandidate(
  group: DrawingTakeoffCandidate[]
): DrawingTakeoffCandidate {
  const score = (c: DrawingTakeoffCandidate) =>
    (c.width !== undefined ? 4 : 0) +
    (c.height !== undefined ? 4 : 0) +
    (c.count !== undefined ? 2 : 0) +
    (c.length !== undefined ? 2 : 0) +
    (c.confidence === "high" ? 2 : c.confidence === "medium" ? 1 : 0);

  return [...group].sort((a, b) => score(b) - score(a))[0];
}

export function deduplicateAndGroupCandidates(
  candidates: DrawingTakeoffCandidate[]
): DrawingTakeoffCandidate[] {
  const groups = new Map<string, DrawingTakeoffCandidate[]>();

  for (const c of candidates) {
    const key = [
      normalizeItemCode(c.itemCode),
      c.category,
      c.drawingId ?? "",
      c.sourcePage ?? "",
      c.sourceType,
    ].join("|");

    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const result: DrawingTakeoffCandidate[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(applyMissingFields(group[0]));
      continue;
    }

    const primary = pickPrimaryCandidate(group);
    const merged: DrawingTakeoffCandidate = {
      ...primary,
      occurrenceCount: group.length,
      linkedEvidenceIds: group.map((g) => g._tempId),
      count: primary.count,
      totalArea:
        primary.count !== undefined && primary.areaEach !== undefined
          ? Math.round(primary.areaEach * primary.count * 100) / 100
          : undefined,
      confidence: "low",
      warnings: [
        ...new Set([
          ...primary.warnings,
          `Code appears ${group.length} times. Count must be verified from plan/schedule.`,
        ]),
      ],
    };
    result.push(applyMissingFields(merged));
  }

  return result;
}

function applyMissingFields(
  candidate: DrawingTakeoffCandidate
): DrawingTakeoffCandidate {
  const missingFields = getCandidateMissingFields(candidate);
  return { ...candidate, missingFields };
}

// ---------------------------------------------------------------------------
// Convert incomplete candidates → Missing Info issues
// ---------------------------------------------------------------------------

export function candidatesToMissingInfoIssues(
  projectId: string,
  candidates: DrawingTakeoffCandidate[],
  evidence: DrawingEvidence[]
): CreateDrawingIssueItemInput[] {
  const issues: CreateDrawingIssueItemInput[] = [];

  for (const candidate of candidates) {
    const ev = evidence.find(
      (e) =>
        e.drawingId === candidate.drawingId ||
        e.candidates.some((c) => c._tempId === candidate._tempId)
    );
    if (!ev) continue;

    const missing = getCandidateMissingFields(candidate);
    if (missing.length === 0 && !candidate.needsVerification) continue;

    if (candidate.needsVerification || isGenericUnnumberedCode(candidate.itemCode)) {
      issues.push(
        buildIssue(projectId, ev, candidate, "unclear_item", ["itemCode"], {
          reason: `${candidate.itemCode ?? "Item"} — generic code reference without item number.`,
          recommendation:
            "Confirm exact item code from schedule or elevation before accepting quantity.",
        })
      );
    }

    for (const field of missing.filter((f) => f !== "itemCode")) {
      const issueType: DrawingIssueType =
        field === "width"
          ? "missing_width"
          : field === "height"
            ? "missing_height"
            : field === "count"
              ? "missing_count"
              : "manual_measurement_required";

      issues.push(
        buildIssue(projectId, ev, candidate, issueType, [field], {
          reason: `${candidate.itemCode ?? "Item"} found but ${field} is missing.`,
          recommendation:
            "Check schedule, elevation, section, or plan — or enter manually.",
        })
      );
    }

    if (
      missing.includes("width") &&
      missing.includes("height") &&
      missing.includes("count")
    ) {
      issues.push(
        buildIssue(projectId, ev, candidate, "needs_schedule", ["width", "height", "count"], {
          reason: `${candidate.itemCode ?? "Item"} — code found without size or count in this package.`,
          recommendation: "Check window/door schedule or elevation for dimensions and quantity.",
        })
      );
    }
  }

  return dedupeIssues(issues);
}

function buildIssue(
  projectId: string,
  ev: DrawingEvidence,
  candidate: DrawingTakeoffCandidate,
  issueType: DrawingIssueType,
  missingFields: string[],
  extra: { reason: string; recommendation: string }
): CreateDrawingIssueItemInput {
  const rule = DRAWING_CODE_RULES.find(
    (r) =>
      candidate.itemCode &&
      (candidate.itemCode.toUpperCase() === r.prefix.toUpperCase() ||
        candidate.itemCode.toUpperCase().startsWith(r.prefix.toUpperCase() + "-"))
  );

  return {
    projectId,
    sourceDrawingId: ev.drawingId,
    sourceDrawingName: ev.drawingName,
    sourcePage: candidate.sourcePage,
    sourceSheetTitle: candidate.sheetTitle ?? ev.sheetTitle ?? undefined,
    issueType,
    possibleCategory: candidate.category ?? rule?.category,
    possibleDescription: candidate.description,
    detectedEvidence: formatCandidateEvidence(candidate),
    missingFields,
    suggestedUnit: candidate.unit,
    confidence: candidate.confidence === "high" ? "medium" : candidate.confidence,
    reason: extra.reason,
    recommendation: extra.recommendation,
    status: "open",
    manualItemCode: candidate.itemCode,
  };
}

function formatCandidateEvidence(c: DrawingTakeoffCandidate): string {
  const parts: string[] = [];
  if (c.itemCode) parts.push(`Code: ${c.itemCode}`);
  if (c.occurrenceCount && c.occurrenceCount > 1) {
    parts.push(`Occurrences: ${c.occurrenceCount}`);
  }
  if (c.width !== undefined && c.height !== undefined) {
    parts.push(`Size: ${c.width}×${c.height}m`);
  }
  if (c.count !== undefined) parts.push(`Count: ${c.count}`);
  return parts.join(", ") || c.rawSnippet.slice(0, 80);
}

function dedupeIssues(
  issues: CreateDrawingIssueItemInput[]
): CreateDrawingIssueItemInput[] {
  const seen = new Set<string>();
  const result: CreateDrawingIssueItemInput[] = [];
  for (const issue of issues) {
    const key = [
      issue.sourceDrawingId ?? "",
      issue.sourcePage ?? "",
      issue.manualItemCode ?? "",
      issue.issueType,
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(issue);
    }
  }
  return result;
}
