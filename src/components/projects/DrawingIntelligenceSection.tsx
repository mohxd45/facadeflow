"use client";

import { useMemo, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AiVisualDetectionResult,
  AiVisualReviewInput,
} from "@/types/drawing-intelligence";
import type { IntegrateDrawingIntelligenceResult } from "@/services/drawing-intelligence/drawing-intelligence-integration.service";
import {
  computeDrawingIntelligenceStats,
  type DrawingIntelligenceRow,
  toDrawingIntelligenceRows,
} from "@/services/drawing-intelligence/drawing-intelligence-ui.utils";

interface DrawingIntelligenceSectionProps {
  analysisStatus: "idle" | "running" | "done" | "error";
  runBusy: boolean;
  runError: string | null;
  runSuccess: string | null;
  onRun: () => void | Promise<void>;
  visualInput: AiVisualReviewInput | null;
  aiResult: AiVisualDetectionResult | null;
  integration: IntegrateDrawingIntelligenceResult | null;
  resultIsStale: boolean;
  onLoadQaScenario?: () => void;
  showQaScenarioButton?: boolean;
  onAcceptAsCandidate: (rowId: string) => Promise<{ kind: "success" | "warning" | "error"; message: string }>;
  onSendToMissingInfo: (rowId: string) => Promise<{ kind: "success" | "warning" | "error"; message: string }>;
  onCreateClarification: (rowId: string) => Promise<{ kind: "success" | "warning" | "error"; message: string }>;
  onRejectSuggestion: (rowId: string) => Promise<{ kind: "success" | "warning" | "error"; message: string }>;
  onResolveConflict: (rowId: string) => Promise<{ kind: "success" | "warning" | "error"; message: string }>;
  onReviewManually: (rowId: string) => Promise<{ kind: "success" | "warning" | "error"; message: string }>;
}

type RowFeedback = { kind: "success" | "warning" | "error"; message: string };

function RowActionCell({
  row,
  onAcceptAsCandidate,
  onSendToMissingInfo,
  onCreateClarification,
  onRejectSuggestion,
  onResolveConflict,
  onReviewManually,
}: {
  row: DrawingIntelligenceRow;
  onAcceptAsCandidate: (rowId: string) => Promise<RowFeedback>;
  onSendToMissingInfo: (rowId: string) => Promise<RowFeedback>;
  onCreateClarification: (rowId: string) => Promise<RowFeedback>;
  onRejectSuggestion: (rowId: string) => Promise<RowFeedback>;
  onResolveConflict: (rowId: string) => Promise<RowFeedback>;
  onReviewManually: (rowId: string) => Promise<RowFeedback>;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<RowFeedback | null>(null);

  const run = useCallback(
    async (fn: () => Promise<RowFeedback>) => {
      if (busy) return;
      setBusy(true);
      setFeedback(null);
      try {
        const result = await fn();
        setFeedback(result);
      } catch {
        setFeedback({ kind: "error", message: "Action failed unexpectedly." });
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => run(() => onAcceptAsCandidate(row.id))}>
          Accept as Candidate
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => run(() => onSendToMissingInfo(row.id))}>
          Send to Missing Info
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => run(() => onCreateClarification(row.id))}>
          Create Clarification
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => run(() => onRejectSuggestion(row.id))}>
          Reject Suggestion
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px]"
          disabled={busy || row.status !== "conflict"}
          onClick={() => run(() => onResolveConflict(row.id))}
        >
          Resolve Conflict
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy} onClick={() => run(() => onReviewManually(row.id))}>
          Review Manually
        </Button>
      </div>
      {feedback && (
        <p
          className={cn(
            "text-[10px]",
            feedback.kind === "success" && "text-green-700",
            feedback.kind === "warning" && "text-amber-700",
            feedback.kind === "error" && "text-red-700"
          )}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}

export default function DrawingIntelligenceSection({
  analysisStatus,
  runBusy,
  runError,
  runSuccess,
  onRun,
  visualInput,
  aiResult,
  integration,
  resultIsStale,
  onLoadQaScenario,
  showQaScenarioButton,
  onAcceptAsCandidate,
  onSendToMissingInfo,
  onCreateClarification,
  onRejectSuggestion,
  onResolveConflict,
  onReviewManually,
}: DrawingIntelligenceSectionProps) {
  const rows = useMemo(
    () => toDrawingIntelligenceRows(integration?.reconciliations ?? []),
    [integration]
  );
  const stats = useMemo(
    () =>
      computeDrawingIntelligenceStats(
        integration,
        visualInput?.evidence.length ?? 0,
        aiResult?.detections.length ?? 0
      ),
    [integration, visualInput?.evidence.length, aiResult?.detections.length]
  );

  const cards = [
    { label: "Visual Evidence", value: stats.visualEvidenceCount },
    { label: "AI Detections", value: stats.aiDetectionCount },
    { label: "Reconciled", value: stats.reconciledCount },
    { label: "Matched", value: stats.matched },
    { label: "System Only", value: stats.systemOnly },
    { label: "AI Only", value: stats.aiOnly },
    { label: "Conflict", value: stats.conflicts },
    { label: "Needs Verification", value: stats.needsVerification },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-900">
        <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
        AI visual detections are suggestions only. Estimator verification is required before any final quantity decision.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void onRun()}
          disabled={runBusy || analysisStatus !== "done"}
        >
          {runBusy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Running Drawing Intelligence...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Run Drawing Intelligence
            </>
          )}
        </Button>
        {showQaScenarioButton && onLoadQaScenario && (
          <Button size="sm" variant="outline" onClick={onLoadQaScenario}>
            <Bot className="h-4 w-4" />
            Load QA Demo (dev-only)
          </Button>
        )}
      </div>

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

      <div className="flex flex-wrap gap-2">
        {cards.map((card) => (
          <div
            key={card.label}
            className={cn(
              "flex flex-col items-center rounded-lg px-4 py-2.5 min-w-[95px]",
              "bg-slate-100 text-slate-800"
            )}
          >
            <span className="text-xl font-bold leading-none">{card.value}</span>
            <span className="mt-1 text-[10px] font-medium text-center leading-tight">
              {card.label}
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
        Actions are safe and non-final in this phase: no verified/final status is created from AI intelligence rows.
      </div>
      {resultIsStale && rows.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
          Drawing Intelligence result is from an older runtime version. Re-run Drawing Intelligence to refresh measurement linking.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center space-y-2">
          <Sparkles className="mx-auto h-7 w-7 text-slate-400" />
          <p className="text-sm font-medium text-slate-600">No drawing intelligence run yet</p>
          <p className="text-xs text-slate-500">
            Run Package Analysis, then click <strong>Run Drawing Intelligence</strong>.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-slate-200 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Element</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Dims (W x H)</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recommended Action</TableHead>
                <TableHead>Sheet / Source</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs font-medium">{row.elementType}</TableCell>
                  <TableCell className="text-xs">{row.code}</TableCell>
                  <TableCell className="text-xs">{row.width} x {row.height}</TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="secondary" className="text-[10px]">{row.confidence}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge
                      className={cn(
                        "text-[10px]",
                        row.status === "conflict" && "bg-red-100 text-red-800",
                        row.status === "needs_verification" && "bg-amber-100 text-amber-800",
                        row.status === "ai_only" && "bg-blue-100 text-blue-800",
                        row.status === "matched" && "bg-green-100 text-green-800",
                        row.status === "system_only" && "bg-slate-200 text-slate-800"
                      )}
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{row.recommendedAction}</TableCell>
                  <TableCell className="text-xs">
                    <div>{row.sheetRef}</div>
                    <div className="text-[10px] text-slate-500">{row.source}</div>
                  </TableCell>
                  <TableCell className="text-xs max-w-[320px]">{row.notes}</TableCell>
                  <TableCell className="text-xs min-w-[320px]">
                    <RowActionCell
                      row={row}
                      onAcceptAsCandidate={onAcceptAsCandidate}
                      onSendToMissingInfo={onSendToMissingInfo}
                      onCreateClarification={onCreateClarification}
                      onRejectSuggestion={onRejectSuggestion}
                      onResolveConflict={onResolveConflict}
                      onReviewManually={onReviewManually}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

