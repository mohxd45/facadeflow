"use client";

/**
 * BOQ Review Table — Phase 2
 *
 * Shows parsed BOQ rows before they are saved.
 * Users can edit/remove individual rows, then "Accept selected" to save.
 */

import { useState, useCallback } from "react";
import type { ParsedBoqRow, CodeTakeoffUnit } from "@/types/code-takeoff";
import { TAKEOFF_CATEGORY_LABELS } from "@/lib/constants";
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
import { AlertTriangle, Check, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface BoqReviewTableProps {
  rows: ParsedBoqRow[];
  onAccept: (rows: ParsedBoqRow[]) => void;
  onDiscard: () => void;
}

const CONFIDENCE_COLORS = {
  high: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-red-100 text-red-800",
};

const UNIT_OPTIONS: CodeTakeoffUnit[] = ["sqm", "lm", "nos", "set"];

export default function BoqReviewTable({
  rows: initialRows,
  onAccept,
  onDiscard,
}: BoqReviewTableProps) {
  const [rows, setRows] = useState<ParsedBoqRow[]>(initialRows);
  const [selected, setSelected] = useState<Set<number>>(
    new Set(initialRows.map((_, i) => i))
  );
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editBuf, setEditBuf] = useState<Partial<ParsedBoqRow>>({});

  const toggleSelect = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((_, i) => i)));
    }
  };

  const removeRow = (i: number) => {
    setRows((r) => r.filter((_, idx) => idx !== i));
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

  const startEdit = (i: number) => {
    setEditingIdx(i);
    setEditBuf({ ...rows[i] });
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setEditBuf({});
  };

  const saveEdit = useCallback(() => {
    if (editingIdx === null) return;
    setRows((prev) =>
      prev.map((r, i) => (i === editingIdx ? { ...r, ...editBuf } : r))
    );
    setEditingIdx(null);
    setEditBuf({});
  }, [editingIdx, editBuf]);

  const handleAccept = () => {
    const accepted = rows.filter((_, i) => selected.has(i));
    onAccept(accepted);
  };

  const selectedCount = selected.size;
  const highCount = rows.filter((_, i) => selected.has(i) && rows[i].confidence === "high").length;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 border border-slate-200 px-4 py-2.5 text-xs">
        <span className="text-slate-700">
          <strong>{rows.length}</strong> rows parsed ·{" "}
          <span className="text-green-700">{highCount} high confidence</span>
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={onDiscard}
          >
            <X className="h-3.5 w-3.5" />
            Discard all
          </Button>
          <Button
            size="sm"
            className="h-7 text-[11px]"
            disabled={selectedCount === 0}
            onClick={handleAccept}
          >
            <Check className="h-3.5 w-3.5" />
            Accept {selectedCount > 0 ? `(${selectedCount})` : "selected"}
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 text-[11px]">
              <TableHead className="h-8 py-0 w-8">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={selected.size === rows.length && rows.length > 0}
                  onChange={toggleAll}
                />
              </TableHead>
              <TableHead className="h-8 py-0 w-24">Code</TableHead>
              <TableHead className="h-8 py-0">Rule matched</TableHead>
              <TableHead className="h-8 py-0 w-16">W (m)</TableHead>
              <TableHead className="h-8 py-0 w-16">H (m)</TableHead>
              <TableHead className="h-8 py-0 w-14">Qty</TableHead>
              <TableHead className="h-8 py-0 w-20">Calculated</TableHead>
              <TableHead className="h-8 py-0 w-14">Unit</TableHead>
              <TableHead className="h-8 py-0 w-20">Confidence</TableHead>
              <TableHead className="h-8 py-0">Warnings</TableHead>
              <TableHead className="h-8 py-0 w-16 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => {
              const isEditing = editingIdx === i;
              const isSelected = selected.has(i);

              if (isEditing) {
                return (
                  <TableRow key={i} className="bg-blue-50">
                    <TableCell>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(i)} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.itemCode}</TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {row.matchedRule ? row.matchedRule.label : "—"}
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-6 text-[11px] w-16"
                        type="number"
                        step="0.01"
                        value={editBuf.width ?? ""}
                        onChange={(e) =>
                          setEditBuf((b) => ({ ...b, width: e.target.value ? parseFloat(e.target.value) : undefined }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-6 text-[11px] w-16"
                        type="number"
                        step="0.01"
                        value={editBuf.height ?? ""}
                        onChange={(e) =>
                          setEditBuf((b) => ({ ...b, height: e.target.value ? parseFloat(e.target.value) : undefined }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-6 text-[11px] w-14"
                        type="number"
                        step="1"
                        value={editBuf.count ?? ""}
                        onChange={(e) =>
                          setEditBuf((b) => ({ ...b, count: e.target.value ? parseFloat(e.target.value) : undefined }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-6 text-[11px] w-20"
                        type="number"
                        step="0.01"
                        value={editBuf.calculatedQuantity ?? ""}
                        onChange={(e) =>
                          setEditBuf((b) => ({ ...b, calculatedQuantity: e.target.value ? parseFloat(e.target.value) : 0 }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <select
                        className="h-6 text-[11px] border rounded px-1"
                        value={editBuf.unit ?? row.unit}
                        onChange={(e) =>
                          setEditBuf((b) => ({ ...b, unit: e.target.value as CodeTakeoffUnit }))
                        }
                      >
                        {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </TableCell>
                    <TableCell colSpan={2} />
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" className="h-6 px-2 text-[10px]" onClick={saveEdit}>
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={cancelEdit}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }

              return (
                <TableRow
                  key={i}
                  className={cn(
                    !isSelected && "opacity-60",
                    row.confidence === "low" && "bg-red-50/30"
                  )}
                >
                  <TableCell>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(i)} />
                  </TableCell>
                  <TableCell className="font-mono text-xs font-semibold">{row.itemCode}</TableCell>
                  <TableCell className="text-xs">
                    {row.matchedRule ? (
                      <span className="text-green-800">
                        {row.matchedRule.label}
                        <span className="text-slate-500 ml-1">
                          ({TAKEOFF_CATEGORY_LABELS[row.matchedRule.category]})
                        </span>
                      </span>
                    ) : (
                      <span className="text-red-600 italic">No rule matched</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {row.width != null ? row.width.toFixed(2) : "—"}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {row.height != null ? row.height.toFixed(2) : "—"}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {row.count ?? row.manualQuantity ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums font-semibold">
                    {row.calculatedQuantity > 0 ? row.calculatedQuantity.toFixed(3) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[9px]">{row.unit}</Badge>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        CONFIDENCE_COLORS[row.confidence]
                      )}
                    >
                      {row.confidence}
                    </span>
                  </TableCell>
                  <TableCell className="text-[10px] text-amber-700 max-w-[18ch] truncate">
                    {row.warnings.length > 0 && (
                      <span title={row.warnings.join("\n")}>
                        <AlertTriangle className="inline h-3 w-3 mr-0.5" />
                        {row.warnings[0]}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEdit(i)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => removeRow(i)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-[10px] text-slate-500">
        Uncheck rows to exclude them. Edit values inline if needed. Nothing is saved until you click &ldquo;Accept&rdquo;.
      </p>
    </div>
  );
}
