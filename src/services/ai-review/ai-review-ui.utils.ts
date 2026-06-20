import type {
  AiReviewFinding,
  AiReviewFindingType,
  AiReviewResult,
  AiReviewRiskLevel,
  AiReviewSuggestedAction,
} from "@/types/ai-review";

export const AI_REVIEW_ADVISORY_TEXT =
  "AI Review is advisory only. It does not change quantities or mark items final. Estimator approval is required.";

export type AiReviewFilterKey =
  | "all"
  | "critical_high"
  | "missing_information"
  | "source_conflict"
  | "generic_code"
  | "ocr_uncertain"
  | "failed_drawing"
  | "quantity_safe";

export interface AiReviewSummaryCounts {
  totalFindings: number;
  criticalHighRisk: number;
  missingInformation: number;
  sourceConflicts: number;
  genericCodes: number;
  ocrUncertain: number;
  safeCandidates: number;
  failedDrawings: number;
}

export interface AiReviewFindingRow {
  id: string;
  candidateId?: string;
  itemCode: string;
  findingType: AiReviewFindingType;
  findingTypeLabel: string;
  riskLevel: AiReviewRiskLevel;
  riskLabel: string;
  title: string;
  message: string;
  recommendation: string;
  suggestedAction: AiReviewSuggestedAction;
  suggestedActionLabel: string;
  sourceDrawingNames: string[];
  sourcePages: number[];
  confidence: "low" | "medium" | "high";
  createdAt: string;
  createdAtLabel: string;
}

export interface AiReviewActionAvailability {
  canViewCandidate: boolean;
  canSendToMissingInfo: boolean;
  canMarkNeedsVerification: boolean;
  canRejectCandidate: boolean;
}

export type RejectExecutionResult = "rejected" | "cancelled" | "unavailable";

const FINDING_LABELS: Record<AiReviewFindingType, string> = {
  false_positive: "False Positive",
  missing_information: "Missing Information",
  suspicious_dimension: "Suspicious Dimension",
  source_conflict: "Source Conflict",
  generic_code: "Generic Code",
  ocr_uncertain: "OCR Uncertain",
  needs_schedule: "Needs Schedule",
  needs_elevation: "Needs Elevation",
  needs_section: "Needs Section",
  quantity_safe: "Quantity Safe",
  manual_verification_required: "Manual Verification Required",
  failed_drawing: "Failed Drawing",
  boq_mismatch: "BOQ Mismatch",
};

const SUGGESTED_ACTION_LABELS: Record<AiReviewSuggestedAction, string> = {
  keep_candidate: "Keep Candidate",
  reject_candidate: "Reject Candidate",
  send_to_missing_info: "Send to Missing Info",
  mark_needs_verification: "Mark Needs Verification",
  request_manual_check: "Request Manual Check",
  no_action: "No Action",
};

const RISK_RANK: Record<AiReviewRiskLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function normalizeSearchText(finding: AiReviewFinding): string {
  return [
    finding.itemCode,
    finding.normalizedItemCode,
    finding.title,
    finding.message,
    finding.recommendation,
    finding.sourceDrawingNames.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function passesFilter(finding: AiReviewFinding, filter: AiReviewFilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "critical_high") {
    return finding.riskLevel === "critical" || finding.riskLevel === "high";
  }
  return finding.findingType === filter;
}

export function getAiReviewSummaryCounts(
  result: AiReviewResult | null
): AiReviewSummaryCounts {
  const findings = result?.findings ?? [];
  return {
    totalFindings: findings.length,
    criticalHighRisk: findings.filter(
      (f) => f.riskLevel === "critical" || f.riskLevel === "high"
    ).length,
    missingInformation: findings.filter(
      (f) => f.findingType === "missing_information"
    ).length,
    sourceConflicts: findings.filter((f) => f.findingType === "source_conflict")
      .length,
    genericCodes: findings.filter((f) => f.findingType === "generic_code").length,
    ocrUncertain: findings.filter((f) => f.findingType === "ocr_uncertain").length,
    safeCandidates: findings.filter((f) => f.findingType === "quantity_safe").length,
    failedDrawings: findings.filter((f) => f.findingType === "failed_drawing")
      .length,
  };
}

export function filterAiReviewFindings(
  findings: AiReviewFinding[],
  filter: AiReviewFilterKey,
  searchTerm: string
): AiReviewFinding[] {
  const normalizedTerm = searchTerm.trim().toLowerCase();
  return findings
    .filter((finding) => passesFilter(finding, filter))
    .filter((finding) => {
      if (!normalizedTerm) return true;
      return normalizeSearchText(finding).includes(normalizedTerm);
    });
}

export function mapAiReviewFindingToRow(finding: AiReviewFinding): AiReviewFindingRow {
  const itemCode =
    finding.normalizedItemCode || finding.itemCode || "Package-level finding";
  return {
    id: finding.id,
    candidateId: finding.candidateId,
    itemCode,
    findingType: finding.findingType,
    findingTypeLabel: FINDING_LABELS[finding.findingType],
    riskLevel: finding.riskLevel,
    riskLabel: finding.riskLevel.toUpperCase(),
    title: finding.title,
    message: finding.message,
    recommendation: finding.recommendation,
    suggestedAction: finding.suggestedAction,
    suggestedActionLabel: SUGGESTED_ACTION_LABELS[finding.suggestedAction],
    sourceDrawingNames: [...finding.sourceDrawingNames],
    sourcePages: [...finding.sourcePages],
    confidence: finding.confidence,
    createdAt: finding.createdAt,
    createdAtLabel: new Date(finding.createdAt).toLocaleString(),
  };
}

export function toAiReviewRows(findings: AiReviewFinding[]): AiReviewFindingRow[] {
  return findings
    .map(mapAiReviewFindingToRow)
    .sort((a, b) => {
      const riskDiff = RISK_RANK[a.riskLevel] - RISK_RANK[b.riskLevel];
      if (riskDiff !== 0) return riskDiff;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

export function getAiReviewActionAvailability(
  row: Pick<AiReviewFindingRow, "candidateId" | "findingType">
): AiReviewActionAvailability {
  const hasCandidate = Boolean(row.candidateId);
  return {
    canViewCandidate: hasCandidate,
    canSendToMissingInfo:
      hasCandidate &&
      (row.findingType === "missing_information" || row.findingType === "generic_code"),
    canMarkNeedsVerification: hasCandidate,
    canRejectCandidate: hasCandidate,
  };
}

export function executeConfirmedReject(
  candidateId: string | undefined,
  confirmReject: () => boolean,
  onRejectCandidate: (candidateId: string) => void
): RejectExecutionResult {
  if (!candidateId) return "unavailable";
  if (!confirmReject()) return "cancelled";
  onRejectCandidate(candidateId);
  return "rejected";
}

