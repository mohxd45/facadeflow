"use client";

/**
 * Cross-Drawing Quantity Table — Phase 4D
 *
 * Displays CrossDrawingQuantityCandidates built by buildCrossDrawingQuantities().
 * Supports row selection and four safe actions:
 *   1. Save as Needs Verification
 *   2. Mark Verified  (strict eligibility guard)
 *   3. Send Missing to Issues
 *   4. Reject
 *
 * Safety rules enforced in UI:
 *  - Mark Verified is blocked for OCR-only, conflict, generic, or incomplete rows.
 *  - Row-state badges show estimator what action is appropriate for each row.
 *  - Build summary disclaimer is shown above the table.
 *  - No totals are shown unless all required fields are present.
 */

import { useState, useMemo } from "react";
import type {
  CrossDrawingBuildResult,
  CrossDrawingQuantityCandidate,
  CrossDrawingValueSource,
} from "@/types/cross-drawing-quantity";
import {
  candidateHasSuspiciousDimensionSignals,
  candidateIsVerifiable,
  getCandidateRowState,
} from "@/services/drawing-package/cross-drawing-quantity-builder.service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Search,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

const CONF_COLORS: Record<"high" | "medium" | "low", string> = {
  high:   "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  low:    "bg-red-100 text-red-800",
};

const STATUS_COLORS: Record<string, string> = {
  draft:              "bg-slate-100 text-slate-700",
  needs_verification: "bg-amber-100 text-amber-800",
  verified:           "bg-green-100 text-green-800",
  rejected:           "bg-red-100 text-red-800",
  final:              "bg-blue-100 text-blue-800",
};

// Row-state badge config
const ROW_STATE_CONFIG = {
  verified_eligible: {
    label: "Complete",
    className: "bg-green-100 text-green-800",
    hint: "Complete and high confidence. Eligible to mark verified.",
  },
  conflict: {
    label: "Conflict",
    className: "bg-red-100 text-red-800",
    hint: "Cannot verify until conflict is resolved. Expand to see conflicting values.",
  },
  generic: {
    label: "Generic Code",
    className: "bg-orange-100 text-orange-800",
    hint: "Generic item code detected. Confirm exact item code from schedule/elevation.",
  },
  ocr_verify: {
    label: "OCR Verify",
    className: "bg-amber-100 text-amber-800",
    hint: "All sources are OCR-extracted. Verify manually from drawing.",
  },
  missing_info: {
    label: "Missing Info",
    className: "bg-red-100 text-red-700",
    hint: "Send to Missing Info or save as needs verification.",
  },
  needs_verification: {
    label: "Needs Verification",
    className: "bg-amber-100 text-amber-800",
    hint: "All fields present but confidence is not high. Review before finalising.",
  },
  rejected: {
    label: "Rejected",
    className: "bg-slate-100 text-slate-500",
    hint: "Rejected by estimator.",
  },
} as const;

// ---------------------------------------------------------------------------
// Source cell helper
// ---------------------------------------------------------------------------

function SourceCell({ src }: { src?: CrossDrawingValueSource }) {
  if (!src) {
    return (
      <span className="text-[10px] text-slate-400 italic">missing</span>
    );
  }
  const isOcr = src.sourceType === "ocr_text";
  return (
    <span
      className={cn(
        "text-[10px]",
        isOcr ? "text-amber-700 font-medium" : "text-slate-600"
      )}
      title={`From: ${src.drawingName}${src.pageNumber ? ` p.${src.pageNumber}` : ""} (${src.sourceType})`}
    >
      {isOcr ? "OCR — verify manually" : src.drawingName.slice(0, 20)}
      {src.drawingName.length > 20 ? "…" : ""}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Expanded row detail
// ---------------------------------------------------------------------------

function CandidateDetailRow({
  candidate,
}: {
  candidate: CrossDrawingQuantityCandidate;
}) {
  const rowState = getCandidateRowState(candidate);
  const stateConfig = ROW_STATE_CONFIG[rowState];
  const suspiciousDimensions = candidateHasSuspiciousDimensionSignals(candidate);

  return (
    <TableRow className="bg-slate-50/60">
      <TableCell colSpan={18} className="py-3 px-4">
        {/* Estimator hint banner */}
        <div className={cn(
          "mb-3 rounded px-3 py-1.5 text-[11px] font-medium flex items-center gap-1.5",
          stateConfig.className
        )}>
          <Info className="h-3 w-3 shrink-0" />
          {stateConfig.hint}
        </div>
        {suspiciousDimensions && (
          <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-900">
            Width/height shown are unverified possible values.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          {/* Source provenance */}
          <div className="space-y-1.5">
            <p className="font-semibold text-slate-700">Value Sources</p>
            {[
              { label: "Count",     src: candidate.countSource },
              { label: "Width",     src: candidate.widthSource },
              { label: "Height",    src: candidate.heightSource },
              { label: "Thickness", src: candidate.thicknessSource },
              { label: "Length",    src: candidate.lengthSource },
              { label: "Area",      src: candidate.areaSource },
            ]
              .filter((f) => f.src !== undefined || candidate.missingFields.includes(f.label.toLowerCase()))
              .map((f) => (
                <div key={f.label} className="flex gap-2">
                  <span className="w-16 shrink-0 text-slate-500">{f.label}:</span>
                  <SourceCell src={f.src} />
                </div>
              ))}
          </div>

          {/* Source drawings */}
          <div className="space-y-1.5">
            <p className="font-semibold text-slate-700">Source Drawings ({candidate.sourceDrawingIds.length})</p>
            {candidate.sourceDrawingNames.map((name, i) => (
              <p key={i} className="text-slate-600 truncate">• {name}</p>
            ))}
            {candidate.sourcePages.length > 0 && (
              <p className="text-slate-500">Pages: {candidate.sourcePages.join(", ")}</p>
            )}
            {candidate.occurrenceCount > 1 && (
              <p className="text-slate-500">{candidate.occurrenceCount} occurrences</p>
            )}
          </div>

          {/* Reasoning + warnings + possible values */}
          <div className="space-y-1.5">
            {candidate.reasoning.length > 0 && (
              <>
                <p className="font-semibold text-slate-700">Reasoning</p>
                {candidate.reasoning.map((r, i) => (
                  <p key={i} className="text-slate-600 text-[10px]">• {r}</p>
                ))}
              </>
            )}
            {(candidate.possibleWidths ?? candidate.possibleHeights ?? candidate.possibleCounts ?? candidate.possibleLengths) && (
              <>
                <p className="font-semibold text-red-700 mt-2">Conflicting Values — review before verifying</p>
                {candidate.possibleWidths  && candidate.possibleWidths.length > 1  && <p className="text-red-700 text-[10px]">Widths found: {candidate.possibleWidths.join(", ")} m</p>}
                {candidate.possibleHeights && candidate.possibleHeights.length > 1 && <p className="text-red-700 text-[10px]">Heights found: {candidate.possibleHeights.join(", ")} m</p>}
                {candidate.possibleCounts  && candidate.possibleCounts.length > 1  && <p className="text-red-700 text-[10px]">Counts found: {candidate.possibleCounts.join(", ")}</p>}
                {candidate.possibleLengths && candidate.possibleLengths.length > 1 && <p className="text-red-700 text-[10px]">Lengths found: {candidate.possibleLengths.join(", ")} lm</p>}
              </>
            )}
            {candidate.warnings.length > 0 && (
              <>
                <p className="font-semibold text-amber-700 mt-2">Warnings</p>
                {candidate.warnings.map((w, i) => (
                  <p key={i} className="text-amber-700 text-[10px]">⚠ {w}</p>
                ))}
              </>
            )}
            {candidate.missingFields.length > 0 && (
              <>
                <p className="font-semibold text-red-700 mt-2">Missing Fields</p>
                <p className="text-red-700 text-[10px]">{candidate.missingFields.join(", ")}</p>
              </>
            )}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CrossDrawingQuantityTableProps {
  result: CrossDrawingBuildResult;
  busy?: boolean;
  onSaveNeedsVerification: (candidates: CrossDrawingQuantityCandidate[]) => Promise<void>;
  onMarkVerified: (candidates: CrossDrawingQuantityCandidate[]) => Promise<void>;
  onSendToIssues: (candidates: CrossDrawingQuantityCandidate[]) => Promise<void>;
  onReject: (candidates: CrossDrawingQuantityCandidate[]) => void;
}

type RowFilter =
  | "all"
  | "complete"
  | "missing_info"
  | "conflict"
  | "generic"
  | "ocr_verify"
  | "needs_verification"
  | "rejected";

// ---------------------------------------------------------------------------
// Stats cards
// ---------------------------------------------------------------------------

function StatsCards({ result }: { result: CrossDrawingBuildResult }) {
  const { stats } = result;
  const missingInfoCount = result.candidates.filter((c) => c.missingFields.length > 0).length;
  const conflictCount = result.candidates.filter((c) => getCandidateRowState(c) === "conflict").length;
  const cards = [
    { label: "Grouped Items",      value: stats.groupedItems,        color: "bg-slate-100 text-slate-800" },
    { label: "Complete",           value: stats.completeCandidates,  color: stats.completeCandidates > 0 ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500" },
    { label: "Missing Info",       value: missingInfoCount,          color: missingInfoCount > 0 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-500" },
    { label: "Conflict Rows",      value: conflictCount,             color: conflictCount > 0 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-500" },
    { label: "Needs Verification", value: stats.needsVerification,   color: stats.needsVerification > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500" },
    { label: "High Confidence",      value: stats.highConfidence,      color: stats.highConfidence > 0 ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500" },
    { label: "Medium Confidence",    value: stats.mediumConfidence,    color: stats.mediumConfidence > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500" },
    { label: "Low Confidence",       value: stats.lowConfidence,       color: stats.lowConfidence > 0 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-500" },
    { label: "Generic Codes",      value: stats.genericCodes ?? 0,         color: (stats.genericCodes ?? 0) > 0 ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-500" },
    { label: "OCR Verify",         value: stats.ocrSourcedCandidates ?? 0, color: (stats.ocrSourcedCandidates ?? 0) > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {cards.map((c) => (
        <div
          key={c.label}
          className={cn("flex flex-col items-center rounded-lg px-3 py-2 min-w-[80px]", c.color)}
        >
          <span className="text-xl font-bold leading-none">{c.value}</span>
          <span className="mt-1 text-[10px] font-medium text-center leading-tight">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build summary disclaimer
// ---------------------------------------------------------------------------

function BuildSummaryNotice() {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 space-y-1.5">
      <p className="text-xs font-semibold text-blue-900 flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Cross-Drawing Quantity Builder
      </p>
      <p className="text-[11px] text-blue-800">
        Cross-Drawing Quantities combine evidence across drawings. They are estimator-reviewed
        and are <strong>not final</strong> until explicitly verified.
      </p>
      <p className="text-[11px] text-blue-700">
        No quantity is calculated unless required values are found with sources. Incomplete
        candidates must be sent to <strong>Missing Info</strong> for resolution or saved as{" "}
        <strong>Needs Verification</strong> for later review.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main table component
// ---------------------------------------------------------------------------

export default function CrossDrawingQuantityTable({
  result,
  busy = false,
  onSaveNeedsVerification,
  onMarkVerified,
  onSendToIssues,
  onReject,
}: CrossDrawingQuantityTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");

  const candidates = result.candidates;
  const trimmedSearch = searchTerm.trim().toLowerCase();

  const visibleCandidates = useMemo(() => {
    const priority: Record<ReturnType<typeof getCandidateRowState>, number> = {
      verified_eligible: 0,
      conflict: 1,
      missing_info: 2,
      needs_verification: 3,
      generic: 4,
      ocr_verify: 5,
      rejected: 6,
    };
    const confRank: Record<"high" | "medium" | "low", number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    const filtered = candidates.filter((c) => {
      const rowState = getCandidateRowState(c);
      const searchMatch =
        trimmedSearch.length === 0 ||
        c.itemCode.toLowerCase().includes(trimmedSearch) ||
        c.normalizedItemCode.toLowerCase().includes(trimmedSearch) ||
        c.description.toLowerCase().includes(trimmedSearch);
      if (!searchMatch) return false;
      if (rowFilter === "all") return true;
      if (rowFilter === "complete") return rowState === "verified_eligible";
      return rowState === rowFilter;
    });
    filtered.sort((a, b) => {
      const stateDiff =
        priority[getCandidateRowState(a)] - priority[getCandidateRowState(b)];
      if (stateDiff !== 0) return stateDiff;
      const confDiff = confRank[a.confidence] - confRank[b.confidence];
      if (confDiff !== 0) return confDiff;
      return (a.normalizedItemCode || a.itemCode).localeCompare(
        b.normalizedItemCode || b.itemCode
      );
    });
    return filtered;
  }, [candidates, rowFilter, trimmedSearch]);

  const selectedCandidates = useMemo(
    () => candidates.filter((c) => selected.has(c.id)),
    [candidates, selected]
  );

  // Strict verifiable subset using the Phase 4D helper
  const canVerify = useMemo(
    () => selectedCandidates.filter((c) => candidateIsVerifiable(c)),
    [selectedCandidates]
  );

  const canSendToIssues = useMemo(
    () => selectedCandidates.filter((c) => c.missingFields.length > 0),
    [selectedCandidates]
  );

  // Rows selected but blocked from verification
  const blockedFromVerify = useMemo(
    () => selectedCandidates.filter((c) => !candidateIsVerifiable(c)),
    [selectedCandidates]
  );

  const toggleRow = (id: string) => {
    setBlockedMessage(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setBlockedMessage(null);
    const visibleIds = new Set(visibleCandidates.map((c) => c.id));
    const allVisibleSelected = visibleCandidates.every((c) => selected.has(c.id));
    if (allVisibleSelected) {
      setSelected((prev) => new Set(Array.from(prev).filter((id) => !visibleIds.has(id))));
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        visibleCandidates.forEach((c) => next.add(c.id));
        return next;
      });
    }
  };

  const toggleExpand = (id: string) =>
    setExpandedId((v) => (v === id ? null : id));

  const run = async (fn: () => Promise<void>) => {
    setActionBusy(true);
    try {
      await fn();
      setSelected(new Set());
    } finally {
      setActionBusy(false);
    }
  };

  const handleMarkVerifiedClick = () => {
    if (canVerify.length === 0 && selectedCandidates.length > 0) {
      // Build an informative blocked reason
      const reasons: string[] = [];
      for (const c of blockedFromVerify) {
        const rowState = getCandidateRowState(c);
        if (rowState === "conflict") reasons.push(`${c.itemCode}: unresolved conflict`);
        else if (rowState === "generic") reasons.push(`${c.itemCode}: generic code`);
        else if (rowState === "ocr_verify") reasons.push(`${c.itemCode}: OCR-only source`);
        else if (rowState === "missing_info") reasons.push(`${c.itemCode}: missing ${c.missingFields.join(", ")}`);
        else if (rowState === "needs_verification") reasons.push(`${c.itemCode}: confidence is not high`);
      }
      const unique = Array.from(new Set(reasons)).slice(0, 4);
      setBlockedMessage(
        `Verify blocked — ${unique.join("; ")}. ` +
        `Save as Needs Verification or resolve issues first.`
      );
      return;
    }
    if (blockedFromVerify.length > 0) {
      setBlockedMessage(
        `${canVerify.length} row(s) will be verified, ${blockedFromVerify.length} blocked by safety rules.`
      );
    }
    void run(() => onMarkVerified(selectedCandidates));
  };

  if (candidates.length === 0) {
    return (
      <div className="space-y-3">
        <BuildSummaryNotice />
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-6 text-center">
          <p className="text-sm text-slate-500">No grouped candidates found.</p>
          <p className="text-xs text-slate-400 mt-1">
            Check Evidence and Missing Info, then rebuild Cross-Drawing Quantities.
          </p>
        </div>
      </div>
    );
  }

  const isBusy = busy || actionBusy;

  return (
    <div className="space-y-3">
      {/* Build summary disclaimer */}
      <BuildSummaryNotice />

      {/* Stats */}
      <StatsCards result={result} />

      {busy && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
          <Loader2 className="inline h-3.5 w-3.5 mr-1 animate-spin" />
          Building cross-drawing candidates... existing results stay visible until refresh completes.
        </div>
      )}

      {/* Blocked verify message */}
      {blockedMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-red-600 mt-0.5 shrink-0" />
          <p className="text-[11px] text-red-800">{blockedMessage}</p>
          <button
            type="button"
            className="ml-auto text-red-500 hover:text-red-700 text-[10px]"
            onClick={() => setBlockedMessage(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">
          {selected.size} selected · {visibleCandidates.length}/{candidates.length} shown
          {isBusy && <Loader2 className="inline h-3.5 w-3.5 animate-spin ml-2" />}
        </span>

        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          disabled={selectedCandidates.length === 0 || isBusy}
          onClick={() => run(() => onSaveNeedsVerification(selectedCandidates))}
        >
          <Send className="h-3.5 w-3.5" />
          Save as Needs Verification ({selectedCandidates.length})
        </Button>

        <Button
          size="sm"
          className="h-7 text-[11px] bg-green-700 hover:bg-green-800 text-white"
          disabled={selectedCandidates.length === 0 || isBusy}
          onClick={handleMarkVerifiedClick}
          title={canVerify.length === 0 && selectedCandidates.length > 0
            ? "Selected rows do not meet verification criteria — click for details"
            : canVerify.length === 0
              ? "Select rows to verify"
              : `Mark ${canVerify.length} row(s) verified`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Mark Verified
          {canVerify.length > 0 && ` (${canVerify.length})`}
          {canVerify.length === 0 && selectedCandidates.length > 0 && " — blocked"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] text-amber-700 border-amber-300"
          disabled={canSendToIssues.length === 0 || isBusy}
          onClick={() => run(() => onSendToIssues(canSendToIssues))}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Send Missing to Issues ({canSendToIssues.length})
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] text-red-600"
          disabled={selectedCandidates.length === 0 || isBusy}
          onClick={() => {
            onReject(selectedCandidates);
            setSelected(new Set());
          }}
        >
          <X className="h-3.5 w-3.5" />
          Reject
        </Button>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2 top-1.5" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search code or description..."
              className="h-7 w-full rounded border border-slate-300 bg-white pl-7 pr-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
          {(
            [
              ["all", "All"],
              ["complete", "Complete"],
              ["missing_info", "Missing Info"],
              ["conflict", "Conflict"],
              ["generic", "Generic Code"],
              ["ocr_verify", "OCR Verify"],
              ["needs_verification", "Needs Verification"],
              ["rejected", "Rejected"],
            ] as Array<[RowFilter, string]>
          ).map(([key, label]) => {
            const count = candidates.filter((c) => {
              if (key === "all") return true;
              const rowState = getCandidateRowState(c);
              if (key === "complete") return rowState === "verified_eligible";
              return rowState === key;
            }).length;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setRowFilter(key)}
                className={cn(
                  "h-7 rounded border px-2 text-[11px]",
                  rowFilter === key
                    ? "border-blue-300 bg-blue-100 text-blue-800"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                )}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {visibleCandidates.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-5 text-center">
          <p className="text-sm text-slate-600">No rows match the current filter/search.</p>
          <p className="text-[11px] text-slate-500 mt-1">Try switching to All or clearing the search text.</p>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <Table className="text-xs min-w-[1200px]">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={
                    visibleCandidates.length > 0 &&
                    visibleCandidates.every((c) => selected.has(c.id))
                  }
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Occ.</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">W (m)</TableHead>
              <TableHead className="text-right">H (m)</TableHead>
              <TableHead className="text-right">Len (lm)</TableHead>
              <TableHead className="text-right">Area/ea</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Missing</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Row State</TableHead>
              <TableHead>Sources</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleCandidates.map((c) => {
              const isSelected = selected.has(c.id);
              const isExpanded = expandedId === c.id;
              const rowState = getCandidateRowState(c);
              const stateConfig = ROW_STATE_CONFIG[rowState];
              const suspiciousDimensions = candidateHasSuspiciousDimensionSignals(c);

              return [
                <TableRow
                  key={c.id}
                  className={cn(
                    isSelected && "bg-blue-50/40",
                    rowState === "conflict" && !isSelected && "bg-red-50/10",
                    rowState === "missing_info" && !isSelected && "bg-amber-50/10",
                    c.status === "rejected" && "opacity-50"
                  )}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5"
                      checked={isSelected}
                      onChange={() => toggleRow(c.id)}
                    />
                  </TableCell>

                  <TableCell className="font-mono font-semibold">
                    <span className="text-[11px]">{c.normalizedItemCode || c.itemCode}</span>
                    {rowState === "generic" && (
                      <Badge className="ml-1 text-[9px] px-1 py-0 bg-orange-100 text-orange-800">generic</Badge>
                    )}
                    {rowState === "ocr_verify" && (
                      <Badge className="ml-1 text-[9px] px-1 py-0 bg-amber-100 text-amber-800">OCR</Badge>
                    )}
                    {rowState === "conflict" && (
                      <Badge className="ml-1 text-[9px] px-1 py-0 bg-red-100 text-red-800">conflict</Badge>
                    )}
                  </TableCell>

                  <TableCell className="max-w-[140px]">
                    <span className="line-clamp-1 text-[11px]">{c.description}</span>
                  </TableCell>

                  <TableCell className="text-[10px] text-slate-600">
                    {c.category.replace(/_/g, " ")}
                  </TableCell>

                  <TableCell className="text-right text-[10px]">{c.occurrenceCount}</TableCell>

                  <TableCell className="text-right">
                    {c.count !== undefined ? (
                      <span>{c.count}</span>
                    ) : (
                      <span className="text-slate-400 italic">—</span>
                    )}
                  </TableCell>

                  <TableCell className="text-right">
                    {c.width !== undefined ? (
                      <span className={cn(suspiciousDimensions && "text-amber-900 font-medium")}>
                        {c.width}
                        {suspiciousDimensions && (
                          <Badge className="ml-1 text-[9px] px-1 py-0 bg-amber-100 text-amber-800">
                            Possible / Verify
                          </Badge>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">—</span>
                    )}
                  </TableCell>

                  <TableCell className="text-right">
                    {c.height !== undefined ? (
                      <span className={cn(suspiciousDimensions && "text-amber-900 font-medium")}>
                        {c.height}
                        {suspiciousDimensions && (
                          <Badge className="ml-1 text-[9px] px-1 py-0 bg-amber-100 text-amber-800">
                            Possible / Verify
                          </Badge>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">—</span>
                    )}
                  </TableCell>

                  <TableCell className="text-right">
                    {c.length !== undefined ? (
                      <span>{c.length}</span>
                    ) : (
                      <span className="text-slate-400 italic">—</span>
                    )}
                  </TableCell>

                  <TableCell className="text-right">
                    {c.areaEach !== undefined ? (
                      <span className={cn(suspiciousDimensions && "text-amber-900 font-medium")}>
                        {c.areaEach} sqm
                        {suspiciousDimensions && (
                          <Badge className="ml-1 text-[9px] px-1 py-0 bg-amber-100 text-amber-800">
                            Possible / Verify
                          </Badge>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">—</span>
                    )}
                  </TableCell>

                  <TableCell className="text-right font-medium">
                    {c.totalArea !== undefined && c.count !== undefined ? (
                      <span className="text-green-800">{c.totalArea} sqm</span>
                    ) : (
                      <span className="text-slate-400 italic">—</span>
                    )}
                  </TableCell>

                  <TableCell className="text-[10px] uppercase text-slate-500">{c.unit}</TableCell>

                  <TableCell className="max-w-[100px]">
                    {c.missingFields.length > 0 ? (
                      <span className="text-[10px] text-red-700 font-medium">
                        {c.missingFields.join(", ")}
                      </span>
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    )}
                  </TableCell>

                  <TableCell>
                    <Badge className={cn("text-[10px] px-1.5 py-0", CONF_COLORS[c.confidence])}>
                      {c.confidence}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <Badge className={cn("text-[10px] px-1.5 py-0", STATUS_COLORS[c.status] ?? "bg-slate-100 text-slate-600")}>
                      {c.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>

                  {/* Row-state badge (Phase 4D) */}
                  <TableCell>
                    <Badge className={cn("text-[9px] px-1.5 py-0 whitespace-nowrap", stateConfig.className)}>
                      {stateConfig.label}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-[10px] text-slate-500 max-w-[100px]">
                    <span className="line-clamp-1" title={c.sourceDrawingNames.join(", ")}>
                      {c.sourceDrawingIds.length} drawing{c.sourceDrawingIds.length !== 1 ? "s" : ""}
                    </span>
                  </TableCell>

                  <TableCell>
                    <button
                      type="button"
                      onClick={() => toggleExpand(c.id)}
                      className="text-[10px] text-blue-600 hover:text-blue-800"
                      aria-label="Expand details"
                    >
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </TableCell>
                </TableRow>,

                isExpanded && (
                  <CandidateDetailRow key={`${c.id}-detail`} candidate={c} />
                ),
              ];
            })}
          </TableBody>
        </Table>
      </div>

      {/* Build warnings */}
      {result.warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 space-y-1">
          <p className="text-xs font-medium text-amber-800">Builder Warnings</p>
          {result.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-amber-700">
              <AlertTriangle className="inline h-3 w-3 mr-1" />
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
