"use client";

/**
 * PDF Extract Panel — Phase 3
 *
 * User flow:
 *   1. Select uploaded PDF drawing from this project
 *   2. Click "Extract Code Takeoff"
 *   3. Loading → extraction summary → BoqReviewTable
 *   4. Edit / remove rows
 *   5. Accept selected → saved to store; nothing saved before this step
 */

import { useState, useCallback } from "react";
import type { DrawingFile } from "@/types/drawing";
import type { ParsedBoqRow } from "@/types/code-takeoff";
import { useCodeRuleStore } from "@/stores/code-rule-store";
import { useCodeTakeoffStore } from "@/stores/code-takeoff-store";
import {
  calculateCodeTakeoff,
  buildCodeTakeoffItemInput,
} from "@/services/takeoff/code-takeoff-calculation.service";
import { extractBoqFromPdf } from "@/services/takeoff/pdf-boq-extraction.service";
import { resolveDrawingBlob } from "@/services/file/drawing-blob-resolver";
import BoqReviewTable from "./BoqReviewTable";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, FileText, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface PdfExtractPanelProps {
  projectId: string;
  drawings: DrawingFile[];
  onAccepted: () => void;
  onCancel: () => void;
}

export default function PdfExtractPanel({
  projectId,
  drawings,
  onAccepted,
  onCancel,
}: PdfExtractPanelProps) {
  const findMatchingRule = useCodeRuleStore((s) => s.findMatchingRule);
  const addItems = useCodeTakeoffStore((s) => s.addItems);

  // ── Extraction state ─────────────────────────────────────────────────────
  const [selectedDrawingId, setSelectedDrawingId] = useState<string>(
    drawings.find((d) => d.fileType === "pdf")?.id ?? ""
  );
  const [status, setStatus] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<ParsedBoqRow[] | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const pdfDrawings = drawings.filter((d) => d.fileType === "pdf");

  // ── Summary stats ─────────────────────────────────────────────────────────
  const highCount = parsedRows?.filter((r) => r.confidence === "high").length ?? 0;
  const mediumCount = parsedRows?.filter((r) => r.confidence === "medium").length ?? 0;
  const lowCount = parsedRows?.filter((r) => r.confidence === "low").length ?? 0;

  // ── Extract handler ───────────────────────────────────────────────────────
  const handleExtract = useCallback(async () => {
    const drawing = drawings.find((d) => d.id === selectedDrawingId);
    if (!drawing) return;

    setStatus("loading");
    setErrorMsg(null);
    setParsedRows(null);
    setExtractionWarnings([]);

    try {
      const file = await resolveDrawingBlob(drawing);
      const result = await extractBoqFromPdf(file, findMatchingRule);

      if (result.error) {
        setStatus("error");
        setErrorMsg(result.error);
        return;
      }

      setExtractionWarnings(result.extractionWarnings);
      setPageCount(result.pageCount);
      setParsedRows(result.rows);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Extraction failed.");
    }
  }, [drawings, selectedDrawingId, findMatchingRule]);

  // ── Accept handler ────────────────────────────────────────────────────────
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
              description: row.description,
              width: row.width,
              height: row.height,
              count: row.count,
              manualQuantity: row.manualQuantity,
              unitOverride: row.unit,
              methodOverride: row.calculationMethod,
              projectId,
              sourceType: "boq",
              notes: `Extracted from PDF. Raw: ${row.rawText}`,
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

  // ── Render ────────────────────────────────────────────────────────────────

  if (pdfDrawings.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center space-y-3">
        <FileText className="mx-auto h-7 w-7 text-slate-400" />
        <p className="text-sm font-medium text-slate-600">No PDF drawings uploaded</p>
        <p className="text-xs text-slate-500">
          Upload a quotation or BOQ PDF in the Drawings tab first.
        </p>
        <Button size="sm" variant="outline" onClick={onCancel}>
          <X className="h-4 w-4" />
          Cancel
        </Button>
      </div>
    );
  }

  // ── Review phase ──────────────────────────────────────────────────────────
  if (status === "done" && parsedRows !== null) {
    return (
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Review Extracted Rows</h3>
          <Button
            size="sm"
            variant="ghost"
            className="text-[11px]"
            onClick={() => { setParsedRows(null); setStatus("idle"); }}
          >
            ← Back to PDF selection
          </Button>
        </div>

        {/* Summary */}
        <div className="flex flex-wrap gap-3 rounded-md bg-slate-50 border border-slate-200 px-4 py-2.5 text-xs">
          <span>
            <strong>{parsedRows.length}</strong> rows extracted · {pageCount} page{pageCount !== 1 ? "s" : ""}
          </span>
          <span className="text-green-700">
            <CheckCircle2 className="inline h-3 w-3 mr-0.5" />
            {highCount + mediumCount} matched
          </span>
          {lowCount > 0 && (
            <span className="text-amber-700">
              <AlertTriangle className="inline h-3 w-3 mr-0.5" />
              {lowCount} low confidence
            </span>
          )}
          {extractionWarnings.map((w, i) => (
            <span key={i} className="text-amber-700 w-full">
              <AlertTriangle className="inline h-3 w-3 mr-0.5" />
              {w}
            </span>
          ))}
        </div>

        {/* Always review — never auto-save */}
        {parsedRows.length === 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="inline h-4 w-4 mr-1" />
            No recognisable item codes found in this PDF. Try{" "}
            <strong>Paste BOQ</strong> instead to paste text manually.
          </div>
        ) : (
          <BoqReviewTable
            rows={parsedRows}
            onAccept={handleAccept}
            onDiscard={onCancel}
          />
        )}

        {busy && <p className="text-xs text-slate-500">Saving items…</p>}
      </div>
    );
  }

  // ── Selection / loading phase ─────────────────────────────────────────────
  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <h3 className="text-sm font-semibold mb-1">Extract Code Takeoff from PDF</h3>
        <p className="text-xs text-slate-600">
          Select an uploaded quotation or BOQ PDF. The app will extract item codes,
          dimensions, and quantities into review rows. Nothing is saved until you
          click <strong>Accept selected</strong>.
        </p>
      </div>

      {/* PDF selection */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-slate-700">
          Select PDF drawing
        </label>
        <select
          className="h-9 w-full rounded border border-slate-300 bg-white px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={selectedDrawingId}
          onChange={(e) => {
            setSelectedDrawingId(e.target.value);
            setParsedRows(null);
            setStatus("idle");
            setErrorMsg(null);
          }}
        >
          <option value="" disabled>
            Choose a PDF…
          </option>
          {pdfDrawings.map((d) => (
            <option key={d.id} value={d.id}>
              {d.fileName}
            </option>
          ))}
        </select>
      </div>

      {/* What will be detected */}
      <div className="rounded-md border border-blue-100 bg-blue-50 px-4 py-2.5 text-[11px] text-blue-800 space-y-0.5">
        <p className="font-semibold">Detected automatically:</p>
        <p>
          Item codes (W-01, SD-03, BL-R…) · dimensions (W×H in m or mm) · counts ·
          units (SQM, RM/LM)
        </p>
        <p>
          Descriptions mapped: BALCONY GLASS BALUSTRADE → BL-R · CANOPY → KP ·
          ALUMINIUM SCREEN → SCR · STAIRCASE RAILING → BL-R
        </p>
        <p className="text-blue-600 italic">
          Price columns are stripped automatically.
        </p>
      </div>

      {/* Error state */}
      {status === "error" && errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="inline h-4 w-4 mr-1" />
          {errorMsg}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!selectedDrawingId || status === "loading"}
          onClick={handleExtract}
          className={cn(status === "loading" && "cursor-wait")}
        >
          {status === "loading" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Extracting…
            </>
          ) : (
            <>
              <FileText className="h-4 w-4" />
              Extract Code Takeoff
            </>
          )}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <p className="text-[10px] text-slate-500">
        Requires a PDF with an embedded text layer (not a scanned image). All rows
        are shown for review — nothing is saved automatically.
      </p>
    </div>
  );
}
