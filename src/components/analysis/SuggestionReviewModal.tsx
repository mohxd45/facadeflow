"use client";

import { useState, useCallback } from "react";
import type { TakeoffSuggestion } from "@/services/analysis/rule-based-takeoff";
import type { DrawingFile } from "@/types/drawing";
import type { TakeoffCategory, ConfidenceLevel } from "@/types/takeoff";
import type { DrawingViewType } from "@/types/drawing";
import {
  DRAWING_VIEW_TYPE_LABELS,
  TAKEOFF_CATEGORY_LABELS,
  TAKEOFF_UNITS,
} from "@/lib/constants";
import { useTakeoffStore } from "@/stores/takeoff-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckSquare, Square, ChevronDown, ChevronUp, Map } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EditableSuggestion extends TakeoffSuggestion {
  selected: boolean;
  expanded: boolean;
}

interface SuggestionReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: TakeoffSuggestion[];
  drawing: DrawingFile;
  projectId: string;
  onAccepted: (count: number) => void;
  /**
   * Called when the user clicks "View source layer" on a DXF suggestion.
   * Passes the DXF layer name so the caller can open visual review.
   */
  onViewSourceLayer?: (layerName: string) => void;
}

// ---------------------------------------------------------------------------
// Default-selection logic
//
// • high confidence  → selected
// • medium confidence with a valid qty > 0 and non-empty unit → selected
// • low confidence   → NOT selected by default (user must opt in)
// ---------------------------------------------------------------------------

function defaultSelected(s: TakeoffSuggestion): boolean {
  if (s.confidence === "low") return false;
  if (s.confidence === "high") return true;
  // medium: only if quantity is meaningful
  return s.quantity !== null && s.quantity > 0 && s.unit !== "";
}

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------

const CONF_VARIANTS: Record<string, "warning" | "secondary" | "success" | "destructive"> = {
  high: "success",
  medium: "warning",
  low: "secondary",
  manual: "secondary",
};

function ConfidenceBadge({ level }: { level: string }) {
  return (
    <Badge variant={CONF_VARIANTS[level] ?? "secondary"} className="capitalize">
      {level}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Single editable row
// ---------------------------------------------------------------------------

interface RowProps {
  sug: EditableSuggestion;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onEdit: (patch: Partial<TakeoffSuggestion>) => void;
  onViewSourceLayer?: (layerName: string) => void;
}

/** Extract DXF layer name from the matchedText field (e.g. "Layer: BALUSTRADE_GLASS"). */
function extractDxfLayer(matchedText: string): string | null {
  const m = matchedText.match(/^Layer:\s*(.+)/i);
  return m ? m[1].trim() : null;
}

function SuggestionRow({ sug, onToggleSelect, onToggleExpand, onEdit, onViewSourceLayer }: RowProps) {
  const qtyDisplay =
    sug.quantity !== null && sug.quantity > 0
      ? sug.quantity.toLocaleString()
      : "—";
  const unitDisplay = sug.unit || "—";

  return (
    <>
      <TableRow className={sug.selected ? "bg-blue-50/40" : undefined}>
        {/* Checkbox */}
        <TableCell>
          <button
            type="button"
            onClick={onToggleSelect}
            className="flex items-center"
            aria-label={sug.selected ? "Deselect" : "Select"}
          >
            {sug.selected ? (
              <CheckSquare className="h-4 w-4 text-blue-600" />
            ) : (
              <Square className="h-4 w-4 text-slate-400" />
            )}
          </button>
        </TableCell>

        <TableCell className="font-mono text-xs">{sug.itemCode}</TableCell>
        <TableCell className="max-w-[160px] truncate text-sm">{sug.elementName}</TableCell>
        <TableCell className="whitespace-nowrap text-xs text-[var(--muted)]">
          {TAKEOFF_CATEGORY_LABELS[sug.category]}
        </TableCell>
        <TableCell className="text-right tabular-nums font-medium text-sm">
          {qtyDisplay}
        </TableCell>
        <TableCell className="text-sm">{unitDisplay}</TableCell>
        <TableCell>
          <ConfidenceBadge level={sug.confidence} />
        </TableCell>
        {/* Source / page */}
        <TableCell className="text-xs text-[var(--muted)]">
          {sug.pageNumber > 0 ? (
            `p.${sug.pageNumber}`
          ) : (
            <span className="flex items-center gap-1">
              DXF
              {onViewSourceLayer && sug.matchedText && (
                (() => {
                  const layer = extractDxfLayer(sug.matchedText);
                  return layer ? (
                    <button
                      type="button"
                      title={`View source layer: ${layer}`}
                      className="text-amber-600 hover:text-amber-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewSourceLayer(layer);
                      }}
                    >
                      <Map className="h-3 w-3" />
                    </button>
                  ) : null;
                })()
              )}
            </span>
          )}
        </TableCell>

        {/* Expand toggle */}
        <TableCell>
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            Edit
            {sug.expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        </TableCell>
      </TableRow>

      {/* Inline notes tooltip row (always visible, not just on expand) */}
      {!sug.expanded && sug.notes && (
        <TableRow className="border-t-0">
          <TableCell colSpan={9} className="pb-2 pt-0">
            <p className="text-xs text-[var(--muted)] italic pl-8">{sug.notes}</p>
          </TableCell>
        </TableRow>
      )}

      {/* Inline edit panel */}
      {sug.expanded && (
        <TableRow className="bg-slate-50">
          <TableCell colSpan={9} className="py-3">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">Item code</p>
                <Input
                  className="h-8 text-xs"
                  value={sug.itemCode}
                  onChange={(e) => onEdit({ itemCode: e.target.value })}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">Element name</p>
                <Input
                  className="h-8 text-xs"
                  value={sug.elementName}
                  onChange={(e) => onEdit({ elementName: e.target.value })}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">Category</p>
                <Select
                  value={sug.category}
                  onValueChange={(v) => onEdit({ category: v as TakeoffCategory })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TAKEOFF_CATEGORY_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">Drawing view type</p>
                <Select
                  value={sug.drawingViewType}
                  onValueChange={(v) => onEdit({ drawingViewType: v as DrawingViewType })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DRAWING_VIEW_TYPE_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">Location / floor</p>
                <Input
                  className="h-8 text-xs"
                  value={sug.locationFloor}
                  placeholder="e.g. Level 12"
                  onChange={(e) => onEdit({ locationFloor: e.target.value })}
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">
                  Quantity
                  {sug.quantity === null && (
                    <span className="ml-1 text-amber-600">(required)</span>
                  )}
                </p>
                <Input
                  className="h-8 text-xs"
                  type="number"
                  min={0}
                  step="any"
                  placeholder="Enter quantity"
                  value={sug.quantity !== null ? sug.quantity : ""}
                  onChange={(e) =>
                    onEdit({
                      quantity: e.target.value === "" ? null : parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">
                  Unit
                  {!sug.unit && (
                    <span className="ml-1 text-amber-600">(required)</span>
                  )}
                </p>
                <Select
                  value={sug.unit || "sqm"}
                  onValueChange={(v) => onEdit({ unit: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {TAKEOFF_UNITS.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">Confidence</p>
                <Select
                  value={sug.confidence}
                  onValueChange={(v) => onEdit({ confidence: v as ConfidenceLevel })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["manual", "high", "medium", "low"] as ConfidenceLevel[]).map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-3 lg:col-span-4">
                <p className="mb-1 text-xs font-medium text-[var(--muted)]">Notes</p>
                <Input
                  className="h-8 text-xs"
                  value={sug.notes}
                  onChange={(e) => onEdit({ notes: e.target.value })}
                />
              </div>
              {sug.matchedText && (
                <div className="sm:col-span-3 lg:col-span-4">
                  <p className="mb-1 text-xs font-medium text-[var(--muted)]">
                    {sug.pageNumber > 0
                      ? `Matched text (page ${sug.pageNumber})`
                      : "Source (DXF layer)"}
                  </p>
                  <p className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600 break-all">
                    {sug.matchedText}
                  </p>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export default function SuggestionReviewModal({
  open,
  onOpenChange,
  suggestions,
  drawing,
  projectId,
  onAccepted,
  onViewSourceLayer,
}: SuggestionReviewModalProps) {
  const createItem = useTakeoffStore((s) => s.createItem);

  const toEditableRows = (sugs: TakeoffSuggestion[]): EditableSuggestion[] =>
    sugs.map((s) => ({
      ...s,
      selected: defaultSelected(s),
      expanded: false,
    }));

  const [rows, setRows] = useState<EditableSuggestion[]>(() =>
    toEditableRows(suggestions)
  );

  // Re-initialise when a fresh analysis result arrives
  const [lastKey, setLastKey] = useState(
    suggestions.map((s) => s.suggestionId).join(",")
  );
  const currentKey = suggestions.map((s) => s.suggestionId).join(",");
  if (currentKey !== lastKey) {
    setRows(toEditableRows(suggestions));
    setLastKey(currentKey);
  }

  const [submitting, setSubmitting] = useState(false);

  const toggleSelect = (id: string) =>
    setRows((prev) =>
      prev.map((r) => (r.suggestionId === id ? { ...r, selected: !r.selected } : r))
    );

  const toggleExpand = (id: string) =>
    setRows((prev) =>
      prev.map((r) => (r.suggestionId === id ? { ...r, expanded: !r.expanded } : r))
    );

  const editRow = (id: string, patch: Partial<TakeoffSuggestion>) =>
    setRows((prev) =>
      prev.map((r) => (r.suggestionId === id ? { ...r, ...patch } : r))
    );

  const allSelected = rows.length > 0 && rows.every((r) => r.selected);
  const toggleAll = () =>
    setRows((prev) => prev.map((r) => ({ ...r, selected: !allSelected })));

  const selectedCount = rows.filter((r) => r.selected).length;
  const lowConfCount = rows.filter((r) => r.confidence === "low").length;

  const handleAccept = useCallback(async () => {
    const toAccept = rows.filter((r) => r.selected);
    if (toAccept.length === 0) return;

    setSubmitting(true);
    try {
      for (const row of toAccept) {
        await createItem({
          projectId,
          itemCode: row.itemCode,
          elementName: row.elementName,
          category: row.category,
          drawingViewType: row.drawingViewType,
          locationFloor: row.locationFloor,
          // Persist null quantity as 0; confidence stays "low" to remind user
          quantity: row.quantity ?? 0,
          unit: row.unit || "sqm",
          sourceDrawingId: drawing.id,
          confidence: row.confidence,
          notes: row.notes || undefined,
        });
      }
      onAccepted(toAccept.length);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [rows, createItem, projectId, drawing.id, onAccepted, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {suggestions.some((s) => s.pageNumber === 0)
              ? "DXF Takeoff — Suggested Quantity Items"
              : "PDF Analysis — Suggested Takeoff Items"}
          </DialogTitle>
          <DialogDescription>
            Suggestions extracted from{" "}
            <span className="font-medium">{drawing.fileName}</span>. High and
            medium-confidence items are pre-selected. Low-confidence rows (no
            quantity detected) are unchecked — opt in after reviewing. Nothing
            is saved until you click <em>Accept selected</em>.
            {suggestions.some((s) => s.pageNumber === 0) && onViewSourceLayer && (
              <> Click the <Map className="inline h-3 w-3 text-amber-600 mx-0.5" /> icon on a DXF row to view its source layer.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border)] py-10 text-center text-sm text-[var(--muted)]">
            No takeoff items could be detected from this PDF&apos;s text
            content. The drawing may be a scanned image without an embedded
            text layer.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-slate-50 px-4 py-2 text-sm">
              <span>
                <strong>{rows.length}</strong> suggestion
                {rows.length !== 1 && "s"} · <strong>{selectedCount}</strong>{" "}
                selected
                {lowConfCount > 0 && (
                  <span className="ml-2 text-[var(--muted)]">
                    · {lowConfCount} low-confidence (unchecked)
                  </span>
                )}
              </span>
              <button
                type="button"
                className="text-blue-600 hover:underline"
                onClick={toggleAll}
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="w-8" />
                    <TableHead>Code</TableHead>
                    <TableHead>Element name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Page</TableHead>
                    <TableHead>Edit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((sug) => (
                    <SuggestionRow
                      key={sug.suggestionId}
                      sug={sug}
                      onToggleSelect={() => toggleSelect(sug.suggestionId)}
                      onToggleExpand={() => toggleExpand(sug.suggestionId)}
                      onEdit={(patch) => editRow(sug.suggestionId, patch)}
                      onViewSourceLayer={onViewSourceLayer}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Reject all
              </Button>
              <Button
                onClick={handleAccept}
                disabled={submitting || selectedCount === 0}
              >
                {submitting
                  ? "Adding…"
                  : `Accept ${selectedCount} item${selectedCount !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
