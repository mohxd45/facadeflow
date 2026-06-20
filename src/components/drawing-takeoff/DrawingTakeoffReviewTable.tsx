"use client";

import { useState, useCallback, useMemo } from "react";
import type { DrawingTakeoffCandidate } from "@/types/drawing-takeoff";
import {
  canSaveAsVerified,
  hasIncompleteSelected,
  isCandidateComplete,
  summarizeCandidates,
} from "@/services/takeoff/candidate-safety.service";
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
import { Check, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DrawingTakeoffReviewTableProps {
  candidates: DrawingTakeoffCandidate[];
  onDiscard: () => void;
  onAccept?: (rows: DrawingTakeoffCandidate[]) => void;
  onSaveVerified?: (rows: DrawingTakeoffCandidate[]) => void;
  onSaveNeedsVerification?: (rows: DrawingTakeoffCandidate[]) => void;
  onSendToIssues?: (rows: DrawingTakeoffCandidate[]) => void;
}

const CONFIDENCE_COLORS: Record<"high" | "medium" | "low", string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-red-100 text-red-800",
};

export default function DrawingTakeoffReviewTable({
  candidates: initialCandidates,
  onDiscard,
  onAccept,
  onSaveVerified,
  onSaveNeedsVerification,
  onSendToIssues,
}: DrawingTakeoffReviewTableProps) {
  const safeMode = !!(onSaveVerified || onSaveNeedsVerification || onSendToIssues);

  const [rows, setRows] = useState<DrawingTakeoffCandidate[]>(initialCandidates);
  const [selected, setSelected] = useState<Set<number>>(() => {
    if (safeMode) {
      return new Set(
        initialCandidates
          .map((c, i) => (canSaveAsVerified(c) ? i : -1))
          .filter((i) => i >= 0)
      );
    }
    return new Set(initialCandidates.map((_, i) => i));
  });
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editBuf, setEditBuf] = useState<Partial<DrawingTakeoffCandidate>>({});
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const summary = useMemo(() => summarizeCandidates(rows), [rows]);
  const selectedRows = useMemo(
    () => rows.filter((_, i) => selected.has(i)),
    [rows, selected]
  );
  const verifiedEligible = selectedRows.filter(canSaveAsVerified);

  const toggleRow = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(
      selected.size === rows.length ? new Set() : new Set(rows.map((_, i) => i))
    );
  };

  const removeRow = (i: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    setSelected((prev) => {
      const next = new Set<number>();
      prev.forEach((s) => {
        if (s < i) next.add(s);
        else if (s > i) next.add(s - 1);
      });
      return next;
    });
    if (editingIdx === i) setEditingIdx(null);
  };

  const saveEdit = useCallback(() => {
    if (editingIdx === null) return;
    const updated = { ...rows[editingIdx], ...editBuf } as DrawingTakeoffCandidate;
    if (updated.unit === "sqm" && updated.width && updated.height) {
      updated.areaEach = round2(updated.width * updated.height);
      updated.totalArea =
        updated.count !== undefined
          ? round2(updated.areaEach * updated.count)
          : undefined;
    }
    setRows((prev) => prev.map((r, i) => (i === editingIdx ? updated : r)));
    setEditingIdx(null);
    setEditBuf({});
  }, [editingIdx, editBuf, rows]);

  const handleSaveVerified = () => {
    if (verifiedEligible.length === 0) {
      setActionMsg("No complete high-confidence rows selected for verified save.");
      return;
    }
    if (hasIncompleteSelected(selectedRows)) {
      setActionMsg(
        "Selected candidates are incomplete. Send them to Missing Info or save as Needs Verification."
      );
      return;
    }
    setActionMsg(null);
    onSaveVerified?.(verifiedEligible);
  };

  return (
    <div className="space-y-3">
      {safeMode && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
          <p className="text-xs text-amber-900 font-medium">
            Most candidates are evidence-only. Missing size/count rows are not quantities yet.
          </p>
          <div className="flex flex-wrap gap-2 text-[10px]">
            <Badge variant="secondary" className="bg-white">Complete: {summary.complete}</Badge>
            <Badge variant="secondary" className="bg-white">Needs verification: {summary.needsVerification}</Badge>
            <Badge variant="secondary" className="bg-white">Missing size/count: {summary.missingSizeOrCount}</Badge>
            <Badge variant="secondary" className="bg-white">Grouped duplicates: {summary.groupedDuplicates}</Badge>
            <Badge variant="secondary" className="bg-white">Generic codes: {summary.genericCodes}</Badge>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 border border-slate-200 px-4 py-2.5 text-xs flex-wrap">
        <span className="text-slate-700">
          <strong>{rows.length}</strong> candidates · {summary.complete} complete · {summary.missingSizeOrCount} missing data
        </span>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onDiscard}>
            Discard all
          </Button>
          {safeMode ? (
            <>
              <Button size="sm" className="h-7 text-[11px]" disabled={verifiedEligible.length === 0} onClick={handleSaveVerified}>
                Save Verified Only ({verifiedEligible.length})
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={selectedRows.length === 0} onClick={() => onSaveNeedsVerification?.(selectedRows)}>
                Save as Needs Verification ({selectedRows.length})
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={selectedRows.length === 0} onClick={() => onSendToIssues?.(selectedRows)}>
                Send Missing to Issues ({selectedRows.length})
              </Button>
            </>
          ) : (
            <Button size="sm" className="h-7 text-[11px]" disabled={selected.size === 0} onClick={() => onAccept?.(selectedRows)}>
              Accept ({selected.size})
            </Button>
          )}
        </div>
      </div>

      {actionMsg && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{actionMsg}</p>
      )}

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <Table className="text-xs min-w-[900px]">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-8"><button type="button" onClick={toggleAll}>{selected.size === rows.length ? "☑" : "☐"}</button></TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Occ.</TableHead>
              <TableHead>Count</TableHead>
              <TableHead>W</TableHead>
              <TableHead>H</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Evidence Conf.</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={row._tempId} className={cn(!isCandidateComplete(row) && "bg-amber-50/20")}>
                <TableCell><button type="button" onClick={() => toggleRow(i)}>{selected.has(i) ? "☑" : "☐"}</button></TableCell>
                <TableCell className="font-mono">{row.itemCode ?? "—"}</TableCell>
                <TableCell>
                  {editingIdx === i ? (
                    <Input className="h-6 text-[11px]" value={editBuf.description ?? row.description} onChange={(e) => setEditBuf({ description: e.target.value })} />
                  ) : row.description}
                  {row.warnings[0] && <p className="text-[10px] text-amber-700 mt-0.5">{row.warnings.join(" · ")}</p>}
                </TableCell>
                <TableCell>{row.occurrenceCount && row.occurrenceCount > 1 ? row.occurrenceCount : "—"}</TableCell>
                <TableCell>{row.count ?? "—"}</TableCell>
                <TableCell>{row.width?.toFixed(2) ?? "—"}</TableCell>
                <TableCell>{row.height?.toFixed(2) ?? "—"}</TableCell>
                <TableCell>{row.totalArea !== undefined ? `${row.totalArea.toFixed(2)} sqm` : "—"}</TableCell>
                <TableCell><Badge className={cn("text-[10px]", CONFIDENCE_COLORS[row.confidence])}>{row.confidence}</Badge></TableCell>
                <TableCell>
                  {editingIdx === i ? (
                    <button type="button" onClick={saveEdit}><Check className="h-3.5 w-3.5" /></button>
                  ) : (
                    <>
                      <button type="button" onClick={() => { setEditingIdx(i); setEditBuf({ ...row }); }}><Pencil className="h-3.5 w-3.5 inline" /></button>
                      <button type="button" onClick={() => removeRow(i)}><Trash2 className="h-3.5 w-3.5 inline ml-1" /></button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
