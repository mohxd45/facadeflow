"use client";

/**
 * Drawing Takeoff Tab — Phase 4
 *
 * Primary workspace for the drawing-only takeoff workflow.
 *
 * Views:
 *   "list"     — Saved DrawingTakeoffItems for this project
 *   "analyze"  — Select a drawing, run extraction, review candidates
 *   "add"      — Manual verified row entry form
 *
 * The tab is intentionally placed first in the project tabs to signal it is
 * the primary workflow going forward.
 */

import { useState, useMemo, useCallback } from "react";
import { useDrawingTakeoffStore } from "@/stores/drawing-takeoff-store";
import type { DrawingFile } from "@/types/drawing";
import type {
  DrawingTakeoffItem,
  DrawingTakeoffCandidate,
  DrawingTakeoffUnit,
  DrawingItemCategory,
  CreateDrawingTakeoffItemInput,
} from "@/types/drawing-takeoff";
import { DRAWING_ITEM_CATEGORY_LABELS } from "@/types/drawing-takeoff";
import { extractFromDrawingText } from "@/services/takeoff/drawing-annotation-extraction.service";
import { extractPdfText } from "@/services/pdf/pdf-text-extractor";
import { resolveDrawingBlob } from "@/services/file/drawing-blob-resolver";
import DrawingTakeoffReviewTable from "./DrawingTakeoffReviewTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  ChevronDown,
  ChevronUp,
  FileSearch,
  Layers,
  Loader2,
  Plus,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DrawingTakeoffTabProps {
  projectId: string;
  drawings: DrawingFile[];
}

type View = "list" | "analyze" | "add";

const CONFIDENCE_COLORS: Record<"high" | "medium" | "low", string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-red-100 text-red-800",
};

const UNIT_OPTIONS: DrawingTakeoffUnit[] = ["sqm", "lm", "nos", "set"];

// ---------------------------------------------------------------------------
// Manual add form
// ---------------------------------------------------------------------------

interface ManualFormState {
  itemCode: string;
  description: string;
  category: DrawingItemCategory;
  count: string;
  width: string;
  height: string;
  length: string;
  unit: DrawingTakeoffUnit;
  drawingId: string;
  sourcePage: string;
  notes: string;
}

function blankForm(drawings: DrawingFile[]): ManualFormState {
  return {
    itemCode: "",
    description: "",
    category: "other",
    count: "1",
    width: "",
    height: "",
    length: "",
    unit: "sqm",
    drawingId: drawings[0]?.id ?? "",
    sourcePage: "",
    notes: "",
  };
}

interface ManualAddFormProps {
  projectId: string;
  drawings: DrawingFile[];
  onAdded: () => void;
  onCancel: () => void;
}

function ManualAddForm({
  projectId,
  drawings,
  onAdded,
  onCancel,
}: ManualAddFormProps) {
  const addItem = useDrawingTakeoffStore((s) => s.addItem);
  const [form, setForm] = useState<ManualFormState>(() => blankForm(drawings));
  const [busy, setBusy] = useState(false);

  const set = (field: keyof ManualFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const width = parseFloat(form.width) || undefined;
  const height = parseFloat(form.height) || undefined;
  const count = parseInt(form.count) || 1;
  const length = parseFloat(form.length) || undefined;

  const areaEach = width && height ? Math.round(width * height * 100) / 100 : undefined;
  const totalArea = areaEach ? Math.round(areaEach * count * 100) / 100 : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) return;

    setBusy(true);
    try {
      const input: CreateDrawingTakeoffItemInput = {
        projectId,
        drawingId: form.drawingId || undefined,
        sourcePage: form.sourcePage ? parseInt(form.sourcePage) : undefined,
        itemCode: form.itemCode.trim() || undefined,
        description: form.description.trim(),
        category: form.category,
        count: count > 1 ? count : undefined,
        width,
        height,
        areaEach,
        totalArea,
        length,
        unit: form.unit,
        sourceType: "manual_verify",
        confidence: "high",
        warnings: [],
        notes: form.notes.trim() || undefined,
      };
      await addItem(input);
      onAdded();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 max-w-2xl rounded-md border border-slate-200 bg-slate-50 p-4"
    >
      <h3 className="text-sm font-semibold">Add Verified Drawing Row</h3>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label className="text-[11px] font-medium">Item code</label>
          <Input className="h-8 text-sm" placeholder="W-01" value={form.itemCode} onChange={set("itemCode")} />
        </div>
        <div className="col-span-2 space-y-1">
          <label className="text-[11px] font-medium">Description *</label>
          <Input className="h-8 text-sm" placeholder="Aluminium sliding door" value={form.description} onChange={set("description")} required />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <label className="text-[11px] font-medium">Category</label>
          <select
            className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
            value={form.category}
            onChange={set("category")}
          >
            {(Object.entries(DRAWING_ITEM_CATEGORY_LABELS) as [DrawingItemCategory, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium">Unit</label>
          <select
            className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
            value={form.unit}
            onChange={set("unit")}
          >
            {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium">Count</label>
          <Input type="number" min={1} className="h-8 text-sm" value={form.count} onChange={set("count")} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-[11px] font-medium">Width (m)</label>
          <Input type="number" step="0.01" min={0} className="h-8 text-sm" placeholder="1.20" value={form.width} onChange={set("width")} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium">Height (m)</label>
          <Input type="number" step="0.01" min={0} className="h-8 text-sm" placeholder="2.90" value={form.height} onChange={set("height")} />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium">Length / lm</label>
          <Input type="number" step="0.1" min={0} className="h-8 text-sm" placeholder="45" value={form.length} onChange={set("length")} />
        </div>
      </div>

      {/* Live calc preview */}
      {(areaEach !== undefined || length !== undefined) && (
        <div className="rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-900">
          {areaEach !== undefined && (
            <span>
              Area each: <strong>{areaEach} sqm</strong>
              {count > 1 && (
                <> · Total: <strong>{totalArea} sqm</strong> ({count} × {areaEach})</>
              )}
            </span>
          )}
          {length !== undefined && (
            <span>Running length: <strong>{length} lm</strong></span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[11px] font-medium">Source drawing</label>
          <select
            className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs"
            value={form.drawingId}
            onChange={set("drawingId")}
          >
            <option value="">None</option>
            {drawings.map((d) => (
              <option key={d.id} value={d.id}>{d.fileName}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium">Source page</label>
          <Input type="number" min={1} className="h-8 text-sm" placeholder="1" value={form.sourcePage} onChange={set("sourcePage")} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[11px] font-medium">Notes</label>
        <Textarea rows={2} className="text-xs" placeholder="Measurement basis, assumptions…" value={form.notes} onChange={set("notes")} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !form.description.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Save row
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Saved items table
// ---------------------------------------------------------------------------

interface SavedItemsTableProps {
  items: DrawingTakeoffItem[];
  drawings: DrawingFile[];
  onDelete: (id: string) => void;
}

function SavedItemsTable({ items, drawings, onDelete }: SavedItemsTableProps) {
  const drawingMap = useMemo(
    () => new Map(drawings.map((d) => [d.id, d.fileName])),
    [drawings]
  );

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
        <Layers className="mx-auto h-8 w-8 text-slate-400 mb-2" />
        <p className="text-sm font-medium text-slate-600">No drawing takeoff rows yet</p>
        <p className="mt-1 text-xs text-slate-500">
          Upload a drawing PDF and click <strong>Analyze Drawing</strong>, or add a row manually.
        </p>
      </div>
    );
  }

  const totalSqm = items
    .filter((i) => i.unit === "sqm")
    .reduce((s, i) => s + (i.totalArea ?? i.areaEach ?? 0), 0);
  const totalLm = items
    .filter((i) => i.unit === "lm")
    .reduce((s, i) => s + (i.length ?? 0), 0);

  return (
    <div className="space-y-2">
      {/* Totals summary */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-4 py-2">
        <span><strong>{items.length}</strong> rows</span>
        {totalSqm > 0 && <span>Total area: <strong>{totalSqm.toFixed(2)} sqm</strong></span>}
        {totalLm > 0 && <span>Total length: <strong>{totalLm.toFixed(1)} lm</strong></span>}
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <Table className="text-xs min-w-[860px]">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">W (m)</TableHead>
              <TableHead className="text-right">H (m)</TableHead>
              <TableHead className="text-right">Area/ea</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Length</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Conf.</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className={cn(item.confidence === "low" && "bg-red-50/30")}>
                <TableCell className="font-mono text-[11px] font-semibold">{item.itemCode ?? "—"}</TableCell>
                <TableCell>
                  <div className="line-clamp-1">{item.description}</div>
                  {item.warnings && item.warnings.length > 0 && (
                    <div className="flex items-center gap-1 text-[10px] text-amber-700 mt-0.5">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      <span className="line-clamp-1">{item.warnings[0]}</span>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-[10px] text-slate-500">
                  {DRAWING_ITEM_CATEGORY_LABELS[item.category] ?? item.category}
                </TableCell>
                <TableCell className="text-right">{item.count ?? "—"}</TableCell>
                <TableCell className="text-right">{item.width?.toFixed(2) ?? "—"}</TableCell>
                <TableCell className="text-right">{item.height?.toFixed(2) ?? "—"}</TableCell>
                <TableCell className="text-right text-slate-600">
                  {item.areaEach !== undefined ? `${item.areaEach.toFixed(2)}` : "—"}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {item.totalArea !== undefined
                    ? `${item.totalArea.toFixed(2)} sqm`
                    : item.areaEach !== undefined
                    ? `${item.areaEach.toFixed(2)} sqm`
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {item.length !== undefined ? `${item.length} lm` : "—"}
                </TableCell>
                <TableCell>{item.unit}</TableCell>
                <TableCell className="text-[10px] text-slate-500 max-w-[100px]">
                  <div className="line-clamp-1">
                    {item.drawingId ? drawingMap.get(item.drawingId) ?? "—" : "—"}
                  </div>
                  {item.sourcePage && <div>p.{item.sourcePage}</div>}
                </TableCell>
                <TableCell>
                  <Badge className={cn("text-[10px] px-1.5 py-0", CONFIDENCE_COLORS[item.confidence])}>
                    {item.confidence}
                  </Badge>
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onDelete(item.id)}
                    className="p-1 text-slate-400 hover:text-red-600"
                    title="Delete row"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analyze panel
// ---------------------------------------------------------------------------

interface AnalyzePanelProps {
  projectId: string;
  drawings: DrawingFile[];
  onAccepted: () => void;
  onCancel: () => void;
}

type AnalyzeStatus = "idle" | "loading" | "review" | "error";

function AnalyzePanel({
  projectId,
  drawings,
  onAccepted,
  onCancel,
}: AnalyzePanelProps) {
  const addItems = useDrawingTakeoffStore((s) => s.addItems);

  const [selectedId, setSelectedId] = useState<string>(
    drawings.find((d) => d.fileType === "pdf")?.id ?? drawings[0]?.id ?? ""
  );
  const [status, setStatus] = useState<AnalyzeStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<DrawingTakeoffCandidate[]>([]);
  const [extractNotes, setExtractNotes] = useState<string[]>([]);
  const [sheetTitle, setSheetTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedDrawing = drawings.find((d) => d.id === selectedId);

  const handleAnalyze = useCallback(async () => {
    if (!selectedDrawing) return;
    setStatus("loading");
    setErrorMsg(null);
    setCandidates([]);

    try {
      const file = await resolveDrawingBlob(selectedDrawing);

      if (selectedDrawing.fileType !== "pdf") {
        setStatus("error");
        setErrorMsg("Drawing annotation extraction currently supports PDF files. DXF geometry extraction is planned for a future phase.");
        return;
      }

      const { text, isLikelyScanned, error } = await extractPdfText(file);

      if (error) {
        setStatus("error");
        setErrorMsg(error);
        return;
      }

      if (isLikelyScanned || !text.trim()) {
        setStatus("error");
        setErrorMsg("This PDF has no embedded text layer. Use a text-layer PDF for extraction.");
        return;
      }

      const result = extractFromDrawingText(text, selectedDrawing.id);
      setSheetTitle(result.detectedSheetTitle);
      setExtractNotes(result.notes);
      setCandidates(result.candidates);
      setStatus("review");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Extraction failed.");
    }
  }, [selectedDrawing]);

  const handleAccept = useCallback(
    async (rows: DrawingTakeoffCandidate[]) => {
      setBusy(true);
      try {
        const inputs: CreateDrawingTakeoffItemInput[] = rows.map((row) => ({
          projectId,
          drawingId: selectedId || undefined,
          sourcePage: row.sourcePage,
          sheetTitle: row.sheetTitle,
          itemCode: row.itemCode,
          description: row.description,
          category: row.category,
          count: row.count,
          width: row.width,
          height: row.height,
          areaEach: row.areaEach,
          totalArea: row.totalArea,
          length: row.length,
          unit: row.unit,
          sourceType: row.sourceType,
          confidence: row.confidence,
          warnings: row.warnings,
          notes: row.rawSnippet
            ? `Extracted from drawing. Snippet: ${row.rawSnippet.slice(0, 120)}`
            : undefined,
        }));
        await addItems(inputs);
        onAccepted();
      } finally {
        setBusy(false);
      }
    },
    [projectId, selectedId, addItems, onAccepted]
  );

  if (status === "review") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Review Extracted Rows</h3>
            {sheetTitle && (
              <p className="text-[11px] text-slate-500">Sheet: {sheetTitle}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-[11px]"
            onClick={() => { setCandidates([]); setStatus("idle"); }}
          >
            ← Back
          </Button>
        </div>

        {extractNotes.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 space-y-0.5">
            {extractNotes.map((n, i) => (
              <p key={i}><AlertTriangle className="inline h-3 w-3 mr-1" />{n}</p>
            ))}
          </div>
        )}
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
          Quick extraction only. Verify in Package Review before finalizing quantities.
        </div>

        {candidates.length === 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="inline h-4 w-4 mr-1" />
            No item codes detected in this drawing. Check that the PDF contains annotation text.
          </div>
        ) : (
          <DrawingTakeoffReviewTable
            candidates={candidates}
            onAccept={handleAccept}
            onDiscard={onCancel}
          />
        )}

        {busy && <p className="text-xs text-slate-500">Saving…</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <h3 className="text-sm font-semibold mb-1">Analyze Drawing</h3>
        <p className="text-xs text-slate-600">
          Select a drawing PDF. The system will scan it for item codes, sizes, and counts
          and generate takeoff candidates for your review.
          <br />
          <span className="text-slate-500">
            Quick extraction only: single-drawing results may be incomplete vs Package Review.
          </span>
        </p>
      </div>

      {/* Drawing selector */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-slate-700">Drawing file</label>
        <select
          className="h-9 w-full rounded border border-slate-300 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setStatus("idle");
            setErrorMsg(null);
          }}
        >
          <option value="" disabled>Choose a drawing…</option>
          {drawings.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fileName}{d.fileType !== "pdf" ? ` (${d.fileType.toUpperCase()})` : ""}
            </option>
          ))}
        </select>
        {selectedDrawing && selectedDrawing.fileType !== "pdf" && (
          <p className="text-[11px] text-amber-700">
            <AlertTriangle className="inline h-3 w-3 mr-1" />
            Annotation extraction is currently PDF-only. DXF geometry extraction is planned.
          </p>
        )}
      </div>

      {/* What is detected */}
      <div className="rounded-md border border-blue-100 bg-blue-50 px-4 py-2.5 text-[11px] text-blue-800 space-y-0.5">
        <p className="font-semibold">Detected from drawing PDF text:</p>
        <p>Item codes: W-01, SD-03, BL-R, CW-01, V-01, KP, SCR, ACP, LUR, A/FIN, D-01, ED-01</p>
        <p>Sizes: 1200 × 2900 mm or 1.20 × 2.90 m — auto-converted</p>
        <p>Counts: qty, nos, ea keywords near each code</p>
        <p>Sheet title: ELEVATION, PLAN, SECTION, SCHEDULE…</p>
      </div>

      {/* Error */}
      {status === "error" && errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="inline h-4 w-4 mr-1" />
          {errorMsg}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!selectedId || status === "loading"}
          onClick={handleAnalyze}
          className={cn(status === "loading" && "cursor-wait")}
        >
          {status === "loading" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <ScanSearch className="h-4 w-4" />
              Analyze Drawing
            </>
          )}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export default function DrawingTakeoffTab({
  projectId,
  drawings,
}: DrawingTakeoffTabProps) {
  const allItems = useDrawingTakeoffStore((s) => s.items);
  const deleteItem = useDrawingTakeoffStore((s) => s.deleteItem);

  const items = useMemo(
    () => allItems.filter((i) => i.projectId === projectId),
    [allItems, projectId]
  );

  const [view, setView] = useState<View>("list");
  const [showHelp, setShowHelp] = useState(false);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this row?")) return;
    await deleteItem(id);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            Drawing Takeoff
            <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-800">
              Primary workflow
            </Badge>
          </h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Extract quantity takeoff directly from uploaded drawings.
          </p>
        </div>
        {view === "list" && (
          <div className="flex flex-wrap gap-2">
            {drawings.length > 0 && (
              <Button size="sm" onClick={() => setView("analyze")}>
                <FileSearch className="h-4 w-4" />
                Analyze Drawing
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setView("add")}>
              <Plus className="h-4 w-4" />
              Add manual row
            </Button>
          </div>
        )}
      </div>

      {/* Help */}
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
        onClick={() => setShowHelp((v) => !v)}
      >
        <ScanSearch className="h-3.5 w-3.5" />
        How drawing-only takeoff works
        {showHelp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {showHelp && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-900 space-y-1.5">
          <p><strong>1.</strong> Upload a drawing PDF in the Drawings tab.</p>
          <p><strong>2.</strong> Click <strong>Analyze Drawing</strong> → the system scans the PDF text for item codes (W-01, SD-03, BL-R…) and sizes.</p>
          <p><strong>3.</strong> Review the extracted candidates → edit any rows → click <strong>Accept</strong> (quick extraction only).</p>
          <p><strong>4.</strong> All accepted rows appear in the table below. Export to Excel when ready.</p>
          <p><strong>5.</strong> Use <strong>Add manual row</strong> to enter items not detected automatically (verified from the drawing).</p>
          <p className="text-blue-600 italic">Phase 4 extracts text annotations. DXF geometry and AI review will be added in future phases.</p>
        </div>
      )}

      {/* Views */}
      {view === "analyze" && (
        <AnalyzePanel
          projectId={projectId}
          drawings={drawings}
          onAccepted={() => setView("list")}
          onCancel={() => setView("list")}
        />
      )}

      {view === "add" && (
        <ManualAddForm
          projectId={projectId}
          drawings={drawings}
          onAdded={() => setView("list")}
          onCancel={() => setView("list")}
        />
      )}

      {view === "list" && (
        <SavedItemsTable items={items} drawings={drawings} onDelete={handleDelete} />
      )}

      {view === "list" && items.length > 0 && (
        <p className="text-[10px] text-slate-500 border-t border-slate-100 pt-2">
          Drawing Takeoff rows are included in the Excel export (Drawing Takeoff sheet).
          Code Takeoff and DXF Layer results remain in their own tabs.
        </p>
      )}
    </div>
  );
}
