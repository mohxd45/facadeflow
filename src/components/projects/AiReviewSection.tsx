"use client";

import { useMemo, useState } from "react";
import type { AiReviewResult } from "@/types/ai-review";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AI_REVIEW_ADVISORY_TEXT,
  executeConfirmedReject,
  filterAiReviewFindings,
  getAiReviewActionAvailability,
  getAiReviewSummaryCounts,
  toAiReviewRows,
  type AiReviewFilterKey,
} from "@/services/ai-review/ai-review-ui.utils";

const STATUS_COLORS: Record<string, string> = {
  not_started: "bg-slate-100 text-slate-700",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

const RISK_COLORS: Record<string, string> = {
  critical: "bg-red-200 text-red-900",
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-green-100 text-green-800",
};

const FILTERS: Array<{ key: AiReviewFilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "critical_high", label: "Critical/High" },
  { key: "missing_information", label: "Missing Info" },
  { key: "source_conflict", label: "Source Conflict" },
  { key: "generic_code", label: "Generic Code" },
  { key: "ocr_uncertain", label: "OCR Uncertain" },
  { key: "failed_drawing", label: "Failed Drawing" },
  { key: "quantity_safe", label: "Safe" },
];

interface AiReviewSectionProps {
  analysisStatus: "idle" | "running" | "done" | "error";
  hasCrossDrawingResult: boolean;
  result: AiReviewResult | null;
  runBusy: boolean;
  runError: string | null;
  runSuccess: string | null;
  onRunReview: () => void | Promise<void>;
  onViewCandidate: (candidateId: string) => void | Promise<void>;
  onSendToMissingInfo: (candidateId: string) => void | Promise<void>;
  onMarkNeedsVerification: (candidateId: string) => void | Promise<void>;
  onRejectCandidate: (candidateId: string) => void | Promise<void>;
  onLoadQaScenario?: () => void;
  showQaScenarioButton?: boolean;
}

function SummaryCards({ result }: { result: AiReviewResult | null }) {
  const counts = useMemo(() => getAiReviewSummaryCounts(result), [result]);
  const cards = [
    { label: "Total findings", value: counts.totalFindings, color: "bg-slate-100 text-slate-800" },
    {
      label: "Critical/high risk",
      value: counts.criticalHighRisk,
      color:
        counts.criticalHighRisk > 0
          ? "bg-red-100 text-red-800"
          : "bg-slate-100 text-slate-500",
    },
    {
      label: "Missing information",
      value: counts.missingInformation,
      color:
        counts.missingInformation > 0
          ? "bg-amber-100 text-amber-800"
          : "bg-slate-100 text-slate-500",
    },
    {
      label: "Source conflicts",
      value: counts.sourceConflicts,
      color:
        counts.sourceConflicts > 0
          ? "bg-red-100 text-red-800"
          : "bg-slate-100 text-slate-500",
    },
    {
      label: "Generic codes",
      value: counts.genericCodes,
      color:
        counts.genericCodes > 0
          ? "bg-amber-100 text-amber-800"
          : "bg-slate-100 text-slate-500",
    },
    {
      label: "OCR uncertain",
      value: counts.ocrUncertain,
      color:
        counts.ocrUncertain > 0
          ? "bg-orange-100 text-orange-800"
          : "bg-slate-100 text-slate-500",
    },
    {
      label: "Safe candidates",
      value: counts.safeCandidates,
      color:
        counts.safeCandidates > 0
          ? "bg-green-100 text-green-800"
          : "bg-slate-100 text-slate-500",
    },
    {
      label: "Failed drawings",
      value: counts.failedDrawings,
      color:
        counts.failedDrawings > 0
          ? "bg-red-100 text-red-800"
          : "bg-slate-100 text-slate-500",
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {cards.map((card) => (
        <div
          key={card.label}
          className={cn("flex flex-col items-center rounded-lg px-4 py-2.5 min-w-[95px]", card.color)}
        >
          <span className="text-xl font-bold leading-none">{card.value}</span>
          <span className="mt-1 text-[10px] font-medium text-center leading-tight">{card.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function AiReviewSection({
  analysisStatus,
  hasCrossDrawingResult,
  result,
  runBusy,
  runError,
  runSuccess,
  onRunReview,
  onViewCandidate,
  onSendToMissingInfo,
  onMarkNeedsVerification,
  onRejectCandidate,
  onLoadQaScenario,
  showQaScenarioButton = false,
}: AiReviewSectionProps) {
  const [activeFilter, setActiveFilter] = useState<AiReviewFilterKey>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredFindings = useMemo(() => {
    if (!result) return [];
    return filterAiReviewFindings(result.findings, activeFilter, searchTerm);
  }, [result, activeFilter, searchTerm]);

  const rows = useMemo(() => toAiReviewRows(filteredFindings), [filteredFindings]);
  const reviewStatus = result?.status ?? "not_started";

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-900">
        <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
        {AI_REVIEW_ADVISORY_TEXT}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-4 py-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-violet-600" />
            AI Drawing Review
          </p>
          <p className="text-xs text-slate-600">
            Review status:{" "}
            <Badge className={cn("text-[10px] px-1.5 py-0", STATUS_COLORS[reviewStatus])}>
              {reviewStatus.replace(/_/g, " ")}
            </Badge>
          </p>
        </div>
        <Button size="sm" onClick={onRunReview} disabled={runBusy}>
          {runBusy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Running…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {result ? "Re-run AI Review" : "Run AI Review"}
            </>
          )}
        </Button>
        {showQaScenarioButton && onLoadQaScenario && (
          <Button
            size="sm"
            variant="outline"
            onClick={onLoadQaScenario}
            disabled={runBusy}
            className="text-[11px]"
          >
            Load QA Candidate Scenario
          </Button>
        )}
      </div>

      {analysisStatus !== "done" && !result && (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center">
          <p className="text-sm font-medium text-slate-700">
            Run Package Analysis first so AI Review has drawing evidence to review.
          </p>
        </div>
      )}

      {analysisStatus !== "done" && result && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
          Showing the last saved AI Review result. Run Package Analysis, then re-run AI Review to refresh findings with current evidence.
        </div>
      )}

      {analysisStatus === "done" && !hasCrossDrawingResult && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
          Build Cross-Drawing Quantities for deeper AI review. You can still review package-level risks.
        </div>
      )}

      {runError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
          {runError}
        </div>
      )}

      {runSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2.5 text-xs text-green-800">
          <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
          {runSuccess}
        </div>
      )}

      {result ? (
        <>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-700">
            <strong>Summary:</strong> {result.summary}
          </div>
          <SummaryCards result={result} />
          {result.warnings.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 space-y-1">
              {result.warnings.map((warning, idx) => (
                <p key={`${warning}-${idx}`}>
                  <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                  {warning}
                </p>
              ))}
            </div>
          )}
        </>
      ) : (
        analysisStatus === "done" && (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center">
            <p className="text-sm font-medium text-slate-700">
              No AI review has run yet. Click <strong>Run AI Review</strong> to generate advisory findings.
            </p>
          </div>
        )
      )}

      {result && result.findings.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center">
          <p className="text-sm font-medium text-slate-700">
            No AI review findings were generated. Check evidence and cross-drawing candidates.
          </p>
        </div>
      )}

      {result && result.findings.length > 0 && (
        <>
          <div className="space-y-2 rounded-md border border-slate-200 bg-white px-4 py-3">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setActiveFilter(filter.key)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium rounded border",
                    activeFilter === filter.key
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by item code, title, message, recommendation, source drawing..."
              className="h-8 text-xs"
            />
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <Table className="text-xs min-w-[1200px]">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Risk</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Title / Message / Recommendation</TableHead>
                  <TableHead>Suggested Action</TableHead>
                  <TableHead>Source Drawings / Pages</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Workflow</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Badge className={cn("text-[10px] px-1.5 py-0", RISK_COLORS[row.riskLevel])}>
                        {row.riskLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[10px] font-medium">{row.findingTypeLabel}</TableCell>
                    <TableCell className="text-[10px] font-mono">{row.itemCode}</TableCell>
                    <TableCell className="max-w-[330px]">
                      <div className="space-y-1">
                        <p className="text-[11px] font-medium text-slate-800">{row.title}</p>
                        <p className="text-[10px] text-slate-700">{row.message}</p>
                        <p className="text-[10px] text-blue-800">
                          <strong>Recommendation:</strong> {row.recommendation}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-[10px]">{row.suggestedActionLabel}</TableCell>
                    <TableCell className="max-w-[180px]">
                      <p className="text-[10px] text-slate-700 line-clamp-2">
                        {row.sourceDrawingNames.length > 0
                          ? row.sourceDrawingNames.join(", ")
                          : "—"}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Pages: {row.sourcePages.length > 0 ? row.sourcePages.join(", ") : "—"}
                      </p>
                    </TableCell>
                    <TableCell className="text-[10px]">{row.confidence}</TableCell>
                    <TableCell className="text-[10px] text-slate-600">{row.createdAtLabel}</TableCell>
                    <TableCell className="max-w-[220px]">
                      {(() => {
                        const actions = getAiReviewActionAvailability(row);
                        return actions.canViewCandidate ? (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => onViewCandidate(row.candidateId!)}
                          >
                            View Candidate
                          </Button>
                          {actions.canSendToMissingInfo && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px]"
                              onClick={() => onSendToMissingInfo(row.candidateId!)}
                            >
                              Send to Missing Info
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => onMarkNeedsVerification(row.candidateId!)}
                            disabled={!actions.canMarkNeedsVerification}
                          >
                            Mark Needs Verification
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px] border-red-300 text-red-700"
                            onClick={() => {
                              executeConfirmedReject(
                                row.candidateId,
                                () =>
                                  window.confirm(
                                    "Reject this candidate from Cross-Drawing Quantities?"
                                  ),
                                onRejectCandidate
                              );
                            }}
                            disabled={!actions.canRejectCandidate}
                          >
                            Reject Candidate
                          </Button>
                        </div>
                        ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          disabled
                        >
                          Actions coming in Phase 5D.
                        </Button>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

