"use client";

/**
 * Code-Based Takeoff Tab — Phase 2
 *
 * Primary workflow:
 *   1. Manually enter a single item code row, OR
 *   2. Paste BOQ / quotation text → auto-parse → review → accept
 *
 * All saved items are stored in useCodeTakeoffStore per project.
 */

import { useState, useMemo, useCallback } from "react";
import { useCodeRuleStore } from "@/stores/code-rule-store";
import { useCodeTakeoffStore } from "@/stores/code-takeoff-store";
import type {
  CodeTakeoffItem,
  CodeTakeoffUnit,
  CalculationMethod,
  ParsedBoqRow,
} from "@/types/code-takeoff";
import type { DrawingFile } from "@/types/drawing";
import {
  calculateCodeTakeoff,
  buildCodeTakeoffItemInput,
} from "@/services/takeoff/code-takeoff-calculation.service";
import { parseBoqText } from "@/services/takeoff/code-boq-text-parser.service";
import { TAKEOFF_CATEGORY_LABELS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import BoqReviewTable from "./BoqReviewTable";
import PdfExtractPanel from "./PdfExtractPanel";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  FileSearch,
  Plus,
  Trash2,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodeTakeoffTabProps {
  projectId: string;
  drawings: DrawingFile[];
}

type View = "list" | "add" | "paste" | "pdf-extract";

type CodeTakeoffUnitWithLm = CodeTakeoffUnit;

const UNIT_OPTIONS: CodeTakeoffUnitWithLm[] = ["sqm", "lm", "nos", "set"];
const METHOD_OPTIONS: CalculationMethod[] = [
  "width_height_qty",
  "entered_area",
  "entered_length",
  "manual_quantity",
];
const METHOD_LABELS: Record<CalculationMethod, string> = {
  width_height_qty: "W × H × Qty (sqm)",
  entered_area: "Enter area directly (sqm)",
  entered_length: "Enter length directly (lm)",
  manual_quantity: "Manual quantity",
};

const CONFIDENCE_COLORS = {
  high: "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-red-100 text-red-800",
};

const SOURCE_LABELS: Record<CodeTakeoffItem["sourceType"], string> = {
  manual: "Manual",
  boq: "BOQ",
  quotation: "Quotation",
  schedule: "Schedule",
  drawing: "Drawing",
};

// ---------------------------------------------------------------------------
// Manual entry form
// ---------------------------------------------------------------------------

interface EntryFormState {
  itemCode: string;
  description: string;
  width: string;
  height: string;
  count: string;
  manualQuantity: string;
  unit: CodeTakeoffUnit;
  method: CalculationMethod;
  notes: string;
  sourceType: CodeTakeoffItem["sourceType"];
}

function blankForm(): EntryFormState {
  return {
    itemCode: "",
    description: "",
    width: "",
    height: "",
    count: "1",
    manualQuantity: "",
    unit: "sqm",
    method: "width_height_qty",
    notes: "",
    sourceType: "manual",
  };
}

function ManualEntryForm({
  projectId,
  onAdded,
  onCancel,
}: {
  projectId: string;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const findMatchingRule = useCodeRuleStore((s) => s.findMatchingRule);
  const addItem = useCodeTakeoffStore((s) => s.addItem);

  const [form, setForm] = useState<EntryFormState>(blankForm());
  const [busy, setBusy] = useState(false);

  const set = (k: keyof EntryFormState, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Auto-detect rule when item code changes
  const matchedRule = useMemo(
    () => (form.itemCode.trim() ? findMatchingRule(form.itemCode.trim()) : null),
    [form.itemCode, findMatchingRule]
  );

  // Auto-fill unit/method from rule (if user hasn't overridden yet)
  const handleCodeChange = (code: string) => {
    setForm((f) => {
      const rule = code.trim() ? findMatchingRule(code.trim()) : null;
      return {
        ...f,
        itemCode: code,
        unit: rule?.defaultUnit ?? f.unit,
        method: rule?.calculationMethod ?? f.method,
      };
    });
  };

  // Preview calculated quantity
  const preview = useMemo(() => {
    if (!form.itemCode.trim()) return null;
    return calculateCodeTakeoff({
      itemCode: form.itemCode.trim(),
      matchedRule,
      width: form.width ? parseFloat(form.width) : undefined,
      height: form.height ? parseFloat(form.height) : undefined,
      count: form.count ? parseFloat(form.count) : undefined,
      manualQuantity: form.manualQuantity ? parseFloat(form.manualQuantity) : undefined,
      unitOverride: form.unit,
      methodOverride: form.method,
      projectId,
    });
  }, [form, matchedRule, projectId]);

  const handleSubmit = async () => {
    if (!form.itemCode.trim() || !preview) return;
    setBusy(true);
    try {
      const input = buildCodeTakeoffItemInput(
        {
          itemCode: form.itemCode.trim(),
          matchedRule,
          description: form.description || undefined,
          width: form.width ? parseFloat(form.width) : undefined,
          height: form.height ? parseFloat(form.height) : undefined,
          count: form.count ? parseFloat(form.count) : undefined,
          manualQuantity: form.manualQuantity ? parseFloat(form.manualQuantity) : undefined,
          unitOverride: form.unit,
          methodOverride: form.method,
          projectId,
          sourceType: form.sourceType,
          notes: form.notes || undefined,
        },
        preview
      );
      await addItem(input);
      onAdded();
    } finally {
      setBusy(false);
    }
  };

  const needsWH = form.method === "width_height_qty";
  const needsQty = form.method !== "width_height_qty";

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 space-y-4 max-w-2xl">
      <h3 className="text-sm font-semibold">Add Item Code Row</h3>

      <div className="grid grid-cols-2 gap-3">
        {/* Item code + auto-detect */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">
            Item Code *
          </label>
          <Input
            className="h-8 text-sm font-mono uppercase"
            placeholder="e.g. W-01, SD-03, BL-R"
            value={form.itemCode}
            onChange={(e) => handleCodeChange(e.target.value)}
          />
          {matchedRule && (
            <p className="text-[10px] text-green-700">
              ✓ Matched: <strong>{matchedRule.label}</strong> ·{" "}
              {TAKEOFF_CATEGORY_LABELS[matchedRule.category]}
            </p>
          )}
          {form.itemCode && !matchedRule && (
            <p className="text-[10px] text-amber-600">
              No rule matched — will be saved as low confidence.
            </p>
          )}
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">
            Description
          </label>
          <Input
            className="h-8 text-sm"
            placeholder="Optional description"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>

        {/* Method */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">
            Calculation Method
          </label>
          <select
            className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={form.method}
            onChange={(e) => set("method", e.target.value)}
          >
            {METHOD_OPTIONS.map((m) => (
              <option key={m} value={m}>{METHOD_LABELS[m]}</option>
            ))}
          </select>
        </div>

        {/* Unit */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">
            Unit
          </label>
          <select
            className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={form.unit}
            onChange={(e) => set("unit", e.target.value)}
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        {/* Width / Height (W×H method) */}
        {needsWH && (
          <>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-700">Width (m)</label>
              <Input
                className="h-8 text-sm"
                type="number"
                step="0.01"
                placeholder="e.g. 1.200"
                value={form.width}
                onChange={(e) => set("width", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-700">Height (m)</label>
              <Input
                className="h-8 text-sm"
                type="number"
                step="0.01"
                placeholder="e.g. 2.400"
                value={form.height}
                onChange={(e) => set("height", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-700">Count</label>
              <Input
                className="h-8 text-sm"
                type="number"
                step="1"
                min="1"
                value={form.count}
                onChange={(e) => set("count", e.target.value)}
              />
            </div>
          </>
        )}

        {/* Quantity (area/length/manual method) */}
        {needsQty && (
          <div className="space-y-1 col-span-2">
            <label className="text-[11px] font-medium text-slate-700">
              {form.method === "entered_area"
                ? "Area (sqm)"
                : form.method === "entered_length"
                ? "Length (lm)"
                : "Quantity"}
            </label>
            <Input
              className="h-8 text-sm w-40"
              type="number"
              step="0.01"
              placeholder="Enter value"
              value={form.manualQuantity}
              onChange={(e) => set("manualQuantity", e.target.value)}
            />
          </div>
        )}

        {/* Source type */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">Source</label>
          <select
            className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={form.sourceType}
            onChange={(e) => set("sourceType", e.target.value)}
          >
            {(Object.keys(SOURCE_LABELS) as Array<CodeTakeoffItem["sourceType"]>).map(
              (k) => (
                <option key={k} value={k}>{SOURCE_LABELS[k]}</option>
              )
            )}
          </select>
        </div>

        {/* Notes */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-700">Notes</label>
          <Input
            className="h-8 text-sm"
            placeholder="Optional notes"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>
      </div>

      {/* Preview */}
      {preview && form.itemCode.trim() && (
        <div
          className={cn(
            "rounded-md border px-4 py-2.5 text-sm",
            preview.confidence === "high"
              ? "border-green-200 bg-green-50"
              : preview.confidence === "medium"
              ? "border-amber-200 bg-amber-50"
              : "border-red-200 bg-red-50"
          )}
        >
          <div className="flex items-center gap-3">
            {preview.confidence === "high" ? (
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            )}
            <span className="font-medium tabular-nums text-base">
              {preview.calculatedQuantity > 0
                ? `${preview.calculatedQuantity.toFixed(3)} ${preview.unit}`
                : "—"}
            </span>
            <Badge
              className={cn("text-[10px]", CONFIDENCE_COLORS[preview.confidence])}
              variant="secondary"
            >
              {preview.confidence}
            </Badge>
          </div>
          {preview.warnings.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800">
              {preview.warnings.map((w, i) => (
                <li key={i}>· {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || !form.itemCode.trim()}
          onClick={handleSubmit}
        >
          <Plus className="h-4 w-4" />
          Add row
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BOQ paste panel
// ---------------------------------------------------------------------------

function BoqPastePanel({
  projectId,
  onAccepted,
  onCancel,
}: {
  projectId: string;
  onAccepted: () => void;
  onCancel: () => void;
}) {
  const findMatchingRule = useCodeRuleStore((s) => s.findMatchingRule);
  const addItems = useCodeTakeoffStore((s) => s.addItems);

  const [text, setText] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedBoqRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const handleParse = () => {
    const rows = parseBoqText(text, findMatchingRule);
    setParsedRows(rows);
  };

  const handleAccept = useCallback(
    async (rows: ParsedBoqRow[]) => {
      setBusy(true);
      try {
        const inputs = rows.map((row) => {
          const calc = calculateCodeTakeoff({
            itemCode: row.itemCode,
            matchedRule: row.matchedRule,
            width: row.width,
            height: row.height,
            count: row.count,
            manualQuantity: row.manualQuantity,
            unitOverride: row.unit,
            methodOverride: row.calculationMethod,
            projectId,
          });
          return buildCodeTakeoffItemInput(
            {
              itemCode: row.itemCode,
              matchedRule: row.matchedRule,
              width: row.width,
              height: row.height,
              count: row.count,
              manualQuantity: row.manualQuantity,
              unitOverride: row.unit,
              methodOverride: row.calculationMethod,
              projectId,
              sourceType: "boq",
            },
            { ...calc, calculatedQuantity: row.calculatedQuantity, unit: row.unit }
          );
        });
        await addItems(inputs);
        onAccepted();
      } finally {
        setBusy(false);
      }
    },
    [projectId, addItems, onAccepted]
  );

  if (parsedRows !== null) {
    if (parsedRows.length === 0) {
      return (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="inline h-4 w-4 mr-1" />
          No recognisable item codes found in the pasted text. Check format and try again.
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={() => setParsedRows(null)}>
              Try again
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Review Parsed Rows</h3>
          <Button size="sm" variant="ghost" className="text-[11px]" onClick={() => setParsedRows(null)}>
            ← Back to text
          </Button>
        </div>
        <BoqReviewTable
          rows={parsedRows}
          onAccept={handleAccept}
          onDiscard={onCancel}
        />
        {busy && (
          <p className="text-xs text-slate-500">Saving items…</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold mb-1">Paste BOQ / Quotation Rows</h3>
        <p className="text-xs text-slate-600">
          Paste lines from a BOQ, quotation, or schedule. Supported formats:
        </p>
        <pre className="mt-1.5 rounded bg-slate-900 text-slate-300 text-[11px] px-3 py-2 leading-relaxed">
{`W-01 4.60 x 2.90 qty 1
SD-03 3.50 x 2.90 2
BL-R 45 RM
CANOPY 64 SQM
A/FIN-01  12.50  lm
CW-01  3000 x 2400  nos 5`}
        </pre>
        <p className="mt-1 text-[10px] text-slate-500">
          Dimensions in mm are auto-converted to metres if greater than 50.
        </p>
      </div>

      <Textarea
        className="font-mono text-xs h-40"
        placeholder="Paste BOQ rows here…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!text.trim()}
          onClick={handleParse}
        >
          <ClipboardPaste className="h-4 w-4" />
          Parse and review
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Items list table
// ---------------------------------------------------------------------------

function ItemsTable({
  items,
  onDelete,
}: {
  items: CodeTakeoffItem[];
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
        <Info className="mx-auto h-6 w-6 text-slate-400 mb-2" />
        <p className="text-sm text-slate-600 font-medium">No code takeoff items yet</p>
        <p className="text-xs text-slate-500 mt-1">
          Add items manually or paste a BOQ above.
        </p>
      </div>
    );
  }

  // Summary by unit
  const totals = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.unit] = (acc[i.unit] ?? 0) + i.calculatedQuantity;
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {/* Totals bar */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(totals).map(([unit, qty]) => (
          <span key={unit} className="rounded-full bg-slate-100 px-3 py-1 font-mono font-medium">
            {qty.toFixed(3)} {unit}
          </span>
        ))}
        <span className="text-slate-400">· {items.length} rows</span>
      </div>

      <div className="rounded-md border border-slate-200 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 text-[11px]">
              <TableHead className="h-8 py-0 w-28">Code</TableHead>
              <TableHead className="h-8 py-0">Description</TableHead>
              <TableHead className="h-8 py-0">Category</TableHead>
              <TableHead className="h-8 py-0 w-16 text-right">W (m)</TableHead>
              <TableHead className="h-8 py-0 w-16 text-right">H (m)</TableHead>
              <TableHead className="h-8 py-0 w-14 text-right">Qty</TableHead>
              <TableHead className="h-8 py-0 w-24 text-right">Calculated</TableHead>
              <TableHead className="h-8 py-0 w-14">Unit</TableHead>
              <TableHead className="h-8 py-0 w-20">Confidence</TableHead>
              <TableHead className="h-8 py-0 w-16">Source</TableHead>
              <TableHead className="h-8 py-0 w-10 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-xs font-semibold">{item.itemCode}</TableCell>
                <TableCell className="text-xs max-w-[20ch] truncate" title={item.description}>
                  {item.description || "—"}
                </TableCell>
                <TableCell className="text-xs">{TAKEOFF_CATEGORY_LABELS[item.category]}</TableCell>
                <TableCell className="text-xs text-right tabular-nums">
                  {item.width != null ? item.width.toFixed(3) : "—"}
                </TableCell>
                <TableCell className="text-xs text-right tabular-nums">
                  {item.height != null ? item.height.toFixed(3) : "—"}
                </TableCell>
                <TableCell className="text-xs text-right tabular-nums">
                  {item.count ?? item.manualQuantity ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-right tabular-nums font-medium">
                  {item.calculatedQuantity.toFixed(3)}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-[9px]">{item.unit}</Badge>
                </TableCell>
                <TableCell>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", CONFIDENCE_COLORS[item.confidence])}>
                    {item.confidence}
                  </span>
                </TableCell>
                <TableCell className="text-[10px] text-slate-500">
                  {SOURCE_LABELS[item.sourceType]}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-red-400 hover:text-red-600"
                    onClick={() => onDelete(item.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
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
// Main tab component
// ---------------------------------------------------------------------------

export default function CodeTakeoffTab({ projectId, drawings }: CodeTakeoffTabProps) {
  const allItems = useCodeTakeoffStore((s) => s.items);
  const deleteItem = useCodeTakeoffStore((s) => s.deleteItem);

  const items = useMemo(
    () => allItems.filter((i) => i.projectId === projectId),
    [allItems, projectId]
  );

  const [view, setView] = useState<View>("list");
  const [showHelp, setShowHelp] = useState(false);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this item?")) return;
    await deleteItem(id);
  };

  const handleAdded = () => setView("list");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            Code-Based Takeoff
            <Badge variant="secondary" className="text-[10px]">Recommended</Badge>
          </h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Enter item codes (W-01, SD-03, BL-R…) → auto-match rules → calculate sqm / lm.
          </p>
        </div>
        {view === "list" && (
          <div className="flex flex-wrap gap-2">
            {drawings.some((d) => d.fileType === "pdf") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setView("pdf-extract")}
              >
                <FileSearch className="h-4 w-4" />
                Extract from PDF
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setView("paste")}
            >
              <ClipboardPaste className="h-4 w-4" />
              Paste BOQ
            </Button>
            <Button size="sm" onClick={() => setView("add")}>
              <Plus className="h-4 w-4" />
              Add row
            </Button>
          </div>
        )}
      </div>

      {/* Help toggle */}
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
        onClick={() => setShowHelp((v) => !v)}
      >
        <Info className="h-3.5 w-3.5" />
        How code-based takeoff works
        {showHelp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {showHelp && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-900 space-y-1.5">
          <p><strong>1.</strong> Type an item code (e.g. <code>W-01</code>) → system matches the W (Window) rule → auto-fills sqm + W×H method.</p>
          <p><strong>2.</strong> Enter width, height, count (or direct area/length) → quantity is calculated instantly.</p>
          <p><strong>3.</strong> For bulk entry, use &ldquo;Paste BOQ&rdquo; to paste lines from Excel/quotation → review detected rows → accept.</p>
          <p><strong>Codes:</strong> W = Window, SD = Sliding Door, D = Door, ED = Entrance Door, CW = Curtain Wall, V = Ventilator, KP = Canopy, BL-R = Balustrade/Railing, SCR = Screen, ACP = ACP Cladding, LUR = Louver, A/FIN = Aluminium Fins.</p>
          <p className="text-blue-600 italic">DXF Layer Takeoff is still available in the Drawings tab for geometry verification.</p>
        </div>
      )}

      {/* Views */}
      {view === "add" && (
        <ManualEntryForm
          projectId={projectId}
          onAdded={handleAdded}
          onCancel={() => setView("list")}
        />
      )}

      {view === "paste" && (
        <BoqPastePanel
          projectId={projectId}
          onAccepted={handleAdded}
          onCancel={() => setView("list")}
        />
      )}

      {view === "pdf-extract" && (
        <PdfExtractPanel
          projectId={projectId}
          drawings={drawings}
          onAccepted={handleAdded}
          onCancel={() => setView("list")}
        />
      )}

      {view === "list" && (
        <ItemsTable items={items} onDelete={handleDelete} />
      )}

      {/* Note about DXF */}
      {view === "list" && items.length > 0 && (
        <p className="text-[10px] text-slate-500 border-t border-slate-100 pt-2">
          Code Takeoff items are included in the Excel export (Code-Based Takeoff sheet).
          DXF Layer Takeoff results remain in Quantity Takeoff and Accuracy tabs.
        </p>
      )}
    </div>
  );
}
