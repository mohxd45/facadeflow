"use client";

/**
 * Drawing Package Review Tab — Phase 1B
 *
 * Multi-drawing analysis workflow:
 *   1. Package Summary — all drawings, auto-classified, extraction status, OCR badge
 *   2. Run Package Analysis — extract evidence from every PDF
 *   3. Package Metrics — summary cards (drawn, scanned, evidence, qty, issues)
 *   4. Evidence Table — per-item findings across all drawings
 *   5. Quantity Candidates — items with sufficient data, accept → DrawingTakeoffStore
 *   6. Missing Information — issues grouped by type, manual fill → convert
 *
 * Phase 1B improvements:
 *   • Priority-based drawing classification (filename > title block > body)
 *   • "balustrade_detail" never assigned from body text alone
 *   • Scanned PDFs shown in summary with OCR badge, not silently skipped
 *   • Package metrics summary cards
 *   • Missing info grouped by category with count badges
 *   • Only critical per-file warnings shown (not low-confidence noise)
 */

import { useState, useMemo, useCallback, useEffect, Fragment } from "react";
import type { DrawingFile } from "@/types/drawing";
import type { Project } from "@/types/project";
import type {
  DrawingTakeoffCandidate,
  DrawingIssueItem,
  CreateDrawingIssueItemInput,
  CreateDrawingTakeoffItemInput,
  DrawingItemCategory,
  DrawingTakeoffUnit,
} from "@/types/drawing-takeoff";
import {
  DRAWING_CODE_RULES,
  DRAWING_ISSUE_TYPE_LABELS,
} from "@/types/drawing-takeoff";
import type {
  CrossDrawingBuildResult,
  CrossDrawingQuantityCandidate,
} from "@/types/cross-drawing-quantity";
import type { AiReviewRunInput, FailedDrawingDiagnostic } from "@/types/ai-review";
import {
  buildCrossDrawingQuantities,
  candidateIsVerifiable,
  candidateHasValueConflict,
  candidateIsOcrOnly,
} from "@/services/drawing-package/cross-drawing-quantity-builder.service";
import CrossDrawingQuantityTable from "@/components/projects/CrossDrawingQuantityTable";
import AiReviewSection from "@/components/projects/AiReviewSection";
import type {
  ClassifiedDrawing,
  DrawingEvidence,
  DrawingAnalysisStatus,
} from "@/types/drawing-package";
import { DRAWING_PACKAGE_TYPE_LABELS } from "@/types/drawing-package";
import type { DrawingOcrResult, OcrStatus } from "@/types/ocr";
import { OCR_STATUS_LABELS } from "@/types/ocr";
import {
  classifyDrawingByName,
  classifyDrawingByText,
} from "@/services/drawing-package/drawing-package-classifier.service";
import { detectMissingInformation } from "@/services/drawing-package/missing-information.service";
import {
  selectDrawingsForPackageAnalysis,
  summarizeDuplicateIdentities,
} from "@/services/drawing-package/drawing-identity.service";
import { extractFromDrawingText } from "@/services/takeoff/drawing-annotation-extraction.service";
import {
  candidatesToMissingInfoIssues,
  canSaveAsVerified,
} from "@/services/takeoff/candidate-safety.service";
import { extractPdfText } from "@/services/pdf/pdf-text-extractor";
import {
  getBestAvailableTextForDrawing,
  applyOcrCandidateAdjustments,
  runOcrOnPdf,
  resolveDrawingOcrStatus,
  countOcrCompletedDrawings,
  createFailedOcrResultInput,
  getOcrFailureWarnings,
  ocrInputsHaveCompletedText,
} from "@/services/ocr/pdf-ocr.service";
import {
  resolveDrawingBlob,
  DrawingBlobResolveError,
} from "@/services/file/drawing-blob-resolver";
import { exportDrawingTakeoffToPdf } from "@/services/export/pdf-report.service";
import { useDrawingTakeoffStore } from "@/stores/drawing-takeoff-store";
import { useDrawingIssueStore } from "@/stores/drawing-issue-store";
import { useOcrResultStore } from "@/stores/ocr-result-store";
import { useCompanyStore } from "@/stores/company-store";
import { useAiReviewStore } from "@/stores/ai-review-store";
import DrawingTakeoffReviewTable from "@/components/drawing-takeoff/DrawingTakeoffReviewTable";
import ZipPackageUploadPanel from "@/components/projects/ZipPackageUploadPanel";
import { runMockAiDrawingReview } from "@/services/ai-review/ai-drawing-review.service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSearch,
  GitMerge,
  Layers,
  Loader2,
  Printer,
  ScanSearch,
  Wrench,
  X,
  ScanLine,
  Archive,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DrawingPackageReviewTabProps {
  projectId: string;
  project?: Project;
  drawings: DrawingFile[];
}

interface CrossDrawingActionFeedback {
  kind: "success" | "warning" | "error";
  message: string;
}

interface AiReviewActionFeedback {
  kind: "success" | "warning" | "error";
  message: string;
}

interface AnalysisState {
  status: "idle" | "running" | "done" | "error";
  progress: string;
  /** ALL drawings get an entry here after analysis (including scanned/failed) */
  classifiedDrawings: ClassifiedDrawing[];
  evidence: DrawingEvidence[];
  quantityCandidates: DrawingTakeoffCandidate[];
  issueCandidates: CreateDrawingIssueItemInput[];
  /** Only important warnings: scanned PDF, extraction fail, no type detected */
  warnings: string[];
  errorMsg: string | null;
}

interface OcrBatchSummary {
  completed: number;
  failed: number;
  total: number;
}

function makeQaCrossDrawingCandidates(projectId: string): CrossDrawingQuantityCandidate[] {
  const now = new Date().toISOString();
  return [
    {
      id: "qa-generic-sd",
      projectId,
      itemCode: "SD",
      normalizedItemCode: "SD",
      description: "Sliding door generic code",
      category: "doors",
      unit: "sqm",
      linkedEvidenceIds: ["qa-ev-1"],
      sourceDrawingIds: ["qa-dwg-plan"],
      sourceDrawingNames: ["QA-PLAN-01.pdf"],
      sourcePages: [1],
      occurrenceCount: 2,
      missingFields: ["width", "height", "count"],
      warnings: ['Generic item code "SD" — assign a specific numbered code before finalising.'],
      reasoning: ["Generic code found in plan only."],
      confidence: "low",
      status: "needs_verification",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "qa-conflict-w13",
      projectId,
      itemCode: "W-13",
      normalizedItemCode: "W-13",
      description: "Window W-13 conflict scenario",
      category: "windows",
      unit: "sqm",
      count: 2,
      width: 2.0,
      height: 2.2,
      widthSource: {
        drawingId: "qa-dwg-schedule",
        drawingName: "QA-SCHED-01.pdf",
        sourceType: "schedule",
        confidence: "high",
      },
      heightSource: {
        drawingId: "qa-dwg-elev",
        drawingName: "QA-ELEV-01.pdf",
        sourceType: "elevation",
        confidence: "high",
      },
      countSource: {
        drawingId: "qa-dwg-plan",
        drawingName: "QA-PLAN-01.pdf",
        sourceType: "plan",
        confidence: "medium",
      },
      linkedEvidenceIds: ["qa-ev-2", "qa-ev-3"],
      sourceDrawingIds: ["qa-dwg-schedule", "qa-dwg-elev"],
      sourceDrawingNames: ["QA-SCHED-01.pdf", "QA-ELEV-01.pdf"],
      sourcePages: [2, 4],
      occurrenceCount: 3,
      missingFields: [],
      warnings: ["Multiple possible widths found: 2.0m, 4.5m — conflict flagged."],
      reasoning: ["Width values diverge significantly across schedule/elevation."],
      possibleWidths: [2.0, 4.5],
      confidence: "medium",
      status: "needs_verification",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "qa-ocr-w04",
      projectId,
      itemCode: "W-04",
      normalizedItemCode: "W-04",
      description: "Window W-04 OCR-only scenario",
      category: "windows",
      unit: "sqm",
      count: 3,
      width: 1.0,
      height: 1.5,
      widthSource: {
        drawingId: "qa-dwg-scan",
        drawingName: "QA-SCAN-01.pdf",
        sourceType: "ocr_text",
        confidence: "low",
      },
      heightSource: {
        drawingId: "qa-dwg-scan",
        drawingName: "QA-SCAN-01.pdf",
        sourceType: "ocr_text",
        confidence: "low",
      },
      countSource: {
        drawingId: "qa-dwg-scan",
        drawingName: "QA-SCAN-01.pdf",
        sourceType: "ocr_text",
        confidence: "low",
      },
      linkedEvidenceIds: ["qa-ev-4"],
      sourceDrawingIds: ["qa-dwg-scan"],
      sourceDrawingNames: ["QA-SCAN-01.pdf"],
      sourcePages: [5],
      occurrenceCount: 1,
      missingFields: [],
      warnings: ["All values originated from OCR text."],
      reasoning: ["Detected only from scanned PDF OCR output."],
      confidence: "medium",
      status: "needs_verification",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "qa-missing-w01",
      projectId,
      itemCode: "W-01",
      normalizedItemCode: "W-01",
      description: "Window W-01 missing dimensions",
      category: "windows",
      unit: "sqm",
      linkedEvidenceIds: ["qa-ev-5"],
      sourceDrawingIds: ["qa-dwg-plan"],
      sourceDrawingNames: ["QA-PLAN-01.pdf"],
      sourcePages: [3],
      occurrenceCount: 2,
      missingFields: ["width", "height", "count"],
      warnings: ["Dimensions not found in current package evidence."],
      reasoning: ["Code detected but no schedule/elevation values found."],
      confidence: "low",
      status: "needs_verification",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "qa-safe-w02",
      projectId,
      itemCode: "W-02",
      normalizedItemCode: "W-02",
      description: "Window W-02 safe complete candidate",
      category: "windows",
      unit: "sqm",
      count: 4,
      width: 1.2,
      height: 1.8,
      areaEach: 2.16,
      totalArea: 8.64,
      widthSource: {
        drawingId: "qa-dwg-schedule",
        drawingName: "QA-SCHED-01.pdf",
        sourceType: "schedule",
        confidence: "high",
      },
      heightSource: {
        drawingId: "qa-dwg-schedule",
        drawingName: "QA-SCHED-01.pdf",
        sourceType: "schedule",
        confidence: "high",
      },
      countSource: {
        drawingId: "qa-dwg-plan",
        drawingName: "QA-PLAN-01.pdf",
        sourceType: "plan",
        confidence: "high",
      },
      linkedEvidenceIds: ["qa-ev-6", "qa-ev-7"],
      sourceDrawingIds: ["qa-dwg-schedule", "qa-dwg-plan"],
      sourceDrawingNames: ["QA-SCHED-01.pdf", "QA-PLAN-01.pdf"],
      sourcePages: [2, 1],
      occurrenceCount: 2,
      missingFields: [],
      warnings: [],
      reasoning: ["Complete values aligned across plan and schedule."],
      confidence: "high",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "qa-suspicious-w99",
      projectId,
      itemCode: "W-99",
      normalizedItemCode: "W-99",
      description: "Window W-99 suspicious dimension candidate",
      category: "windows",
      unit: "sqm",
      count: 1,
      width: 22,
      height: 2.4,
      areaEach: 52.8,
      totalArea: 52.8,
      widthSource: {
        drawingId: "qa-dwg-elev",
        drawingName: "QA-ELEV-01.pdf",
        sourceType: "elevation",
        confidence: "medium",
      },
      heightSource: {
        drawingId: "qa-dwg-elev",
        drawingName: "QA-ELEV-01.pdf",
        sourceType: "elevation",
        confidence: "medium",
      },
      countSource: {
        drawingId: "qa-dwg-plan",
        drawingName: "QA-PLAN-01.pdf",
        sourceType: "plan",
        confidence: "medium",
      },
      linkedEvidenceIds: ["qa-ev-8"],
      sourceDrawingIds: ["qa-dwg-elev"],
      sourceDrawingNames: ["QA-ELEV-01.pdf"],
      sourcePages: [6],
      occurrenceCount: 1,
      missingFields: [],
      warnings: ["Dimension value appears unusually large for an opening."],
      reasoning: ["Possible grid/overall dimension picked as opening width."],
      confidence: "medium",
      status: "needs_verification",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

const INITIAL_ANALYSIS: AnalysisState = {
  status: "idle",
  progress: "",
  classifiedDrawings: [],
  evidence: [],
  quantityCandidates: [],
  issueCandidates: [],
  warnings: [],
  errorMsg: null,
};

// ---------------------------------------------------------------------------
// Shared style helpers
// ---------------------------------------------------------------------------

const CONF_COLORS: Record<"high" | "medium" | "low", string> = {
  high:   "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  low:    "bg-red-100 text-red-800",
};

const STATUS_COLORS: Record<string, string> = {
  open:                 "bg-amber-100 text-amber-800",
  filled:               "bg-blue-100 text-blue-800",
  converted_to_takeoff: "bg-green-100 text-green-800",
  ignored:              "bg-slate-100 text-slate-600",
};

const ANALYSIS_STATUS_STYLES: Record<DrawingAnalysisStatus, { label: string; color: string }> = {
  not_analysed:         { label: "Not analysed",     color: "bg-slate-100 text-slate-600" },
  text_extractable:     { label: "Analysed",          color: "bg-green-100 text-green-800" },
  scanned_or_image_pdf: { label: "Scanned / OCR",     color: "bg-orange-100 text-orange-800" },
  extraction_failed:    { label: "Extraction failed", color: "bg-red-100 text-red-800" },
  unsupported_format:   { label: "Unsupported",       color: "bg-slate-100 text-slate-500" },
  duplicate_skipped:    { label: "Duplicate (skipped)", color: "bg-amber-100 text-amber-800" },
};

const DRAWING_TYPE_BADGE_COLORS: Record<string, string> = {
  plan:              "bg-blue-100 text-blue-800",
  elevation:         "bg-purple-100 text-purple-800",
  section:           "bg-teal-100 text-teal-800",
  schedule:          "bg-orange-100 text-orange-800",
  detail:            "bg-pink-100 text-pink-800",
  balustrade_detail: "bg-pink-100 text-pink-800",
  cad_dxf:           "bg-slate-100 text-slate-700",
  general:           "bg-cyan-100 text-cyan-800",
  unknown:           "bg-slate-100 text-slate-500",
};

const OCR_STATUS_COLORS: Record<OcrStatus, string> = {
  not_needed: "bg-slate-100 text-slate-500",
  needed:     "bg-orange-100 text-orange-800",
  running:    "bg-blue-100 text-blue-800",
  completed:  "bg-green-100 text-green-800",
  failed:     "bg-red-100 text-red-800",
};

/** Notes column — prefer live OCR store state over stale analysis snapshot. */
function resolvePackageSummaryNotes(
  drawingId: string,
  ocrStatus: OcrStatus,
  cls: ClassifiedDrawing,
  evidence: DrawingEvidence[],
  ocrFailureReason?: string
): string {
  if (ocrStatus === "failed" && ocrFailureReason) {
    return ocrFailureReason;
  }

  if (ocrStatus === "completed") {
    const analysisUsedOcr = evidence.some(
      (e) => e.drawingId === drawingId && e.textSource === "ocr_text"
    );
    if (analysisUsedOcr) {
      return "OCR text used for analysis. Verify results manually.";
    }
    return "OCR text extracted. Re-analyze Package to extract evidence from OCR text.";
  }

  if (ocrStatus === "needed") {
    return (
      cls.extractionNotes?.join(" ") ||
      "Scanned PDF — run OCR to extract text for evidence and quantity analysis."
    );
  }

  const joined = cls.extractionNotes?.join(" ") ?? "";
  return joined || "—";
}

function buildBlobFailureNotes(drawing: DrawingFile, err: unknown): string[] {
  if (err instanceof DrawingBlobResolveError) {
    const details = err.details;
    const notes = [
      `File load failed: ${details.fileName}.`,
      `Blob available: ${details.hasLocalBlob ? "yes (metadata)" : "no"}.`,
      `File size: ${typeof details.fileSize === "number" ? `${(details.fileSize / 1024 / 1024).toFixed(1)} MB` : "unknown"}.`,
      details.sourceHint ? `ZIP/source path: ${details.sourceHint}.` : undefined,
      details.storagePath ? `Storage path: ${details.storagePath}.` : "Storage path: not set.",
      details.causes.length > 0 ? `Error detail: ${details.causes[0]}` : undefined,
      "Action: Re-import this drawing or replace drawing file, then rerun Package Analysis.",
    ];
    return notes.filter(Boolean) as string[];
  }
  return [
    `File load failed: ${drawing.fileName}.`,
    `Blob available: ${drawing.hasLocalBlob ? "yes (metadata)" : "no"}.`,
    `File size: ${typeof drawing.fileSize === "number" ? `${(drawing.fileSize / 1024 / 1024).toFixed(1)} MB` : "unknown"}.`,
    `Error detail: ${err instanceof Error ? err.message : "unknown file loading error"}.`,
    "Action: Re-import this drawing or replace drawing file, then rerun Package Analysis.",
  ];
}

// ---------------------------------------------------------------------------
// Package Metrics Summary Cards
// ---------------------------------------------------------------------------

function PackageMetricsCards({
  analysis,
  projectIssues,
  drawings,
  ocrResults,
}: {
  analysis: AnalysisState;
  projectIssues: DrawingIssueItem[];
  drawings: DrawingFile[];
  ocrResults: DrawingOcrResult[];
}) {
  if (analysis.status !== "done") return null;

  const totalDrawings = analysis.classifiedDrawings.length;
  const ocrCompletedCount = countOcrCompletedDrawings(drawings, ocrResults);
  const scannedCount = analysis.classifiedDrawings.filter((d) => {
    if (d.analysisStatus !== "scanned_or_image_pdf") return false;
    const drawing = drawings.find((dr) => dr.id === d.drawingId);
    if (!drawing) return true;
    return resolveDrawingOcrStatus(drawing, ocrResults, d.ocrStatus) !== "completed";
  }).length;
  const analysedCount = analysis.classifiedDrawings.filter(
    (d) => d.analysisStatus === "text_extractable"
  ).length;
  const evidenceCount = analysis.evidence.flatMap((e) => e.candidates).length;
  const qtyCount = analysis.quantityCandidates.length;
  const issueCount = analysis.issueCandidates.length + projectIssues.filter((i) => i.status === "open").length;
  const lowConfCount = analysis.quantityCandidates.filter((c) => c.confidence === "low").length;

  const cards = [
    { label: "Drawings",       value: totalDrawings, color: "bg-slate-100 text-slate-800" },
    { label: "Analysed",       value: analysedCount, color: "bg-green-100 text-green-800" },
    { label: "Scanned / OCR",  value: scannedCount,  color: scannedCount > 0 ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-500" },
    { label: "OCR Completed", value: ocrCompletedCount, color: ocrCompletedCount > 0 ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500" },
    { label: "Evidence Items", value: evidenceCount, color: "bg-blue-100 text-blue-800" },
    { label: "Qty Candidates", value: qtyCount,      color: "bg-indigo-100 text-indigo-800" },
    { label: "Missing Info",   value: issueCount,    color: issueCount > 0 ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800" },
    { label: "Low Confidence", value: lowConfCount,  color: lowConfCount > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {cards.map((c) => (
        <div
          key={c.label}
          className={cn("flex flex-col items-center rounded-lg px-4 py-2.5 min-w-[80px]", c.color)}
        >
          <span className="text-xl font-bold leading-none">{c.value}</span>
          <span className="mt-1 text-[10px] font-medium text-center leading-tight">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Package Summary Table
// ---------------------------------------------------------------------------

function PackageSummary({
  drawings,
  classifiedDrawings,
  analysed,
  evidence,
  ocrResults,
  ocrRunningId,
  onRunOcr,
  duplicateIdentities,
}: {
  drawings: DrawingFile[];
  classifiedDrawings: ClassifiedDrawing[];
  analysed: boolean;
  evidence: DrawingEvidence[];
  ocrResults: DrawingOcrResult[];
  ocrRunningId: string | null;
  onRunOcr: (drawing: DrawingFile) => void;
  duplicateIdentities: ReturnType<typeof summarizeDuplicateIdentities>;
}) {
  const classMap = useMemo(
    () => new Map(classifiedDrawings.map((c) => [c.drawingId, c])),
    [classifiedDrawings]
  );

  const ocrByDrawing = useMemo(() => {
    const map = new Map<string, DrawingOcrResult[]>();
    for (const r of ocrResults) {
      const list = map.get(r.drawingId) ?? [];
      list.push(r);
      map.set(r.drawingId, list);
    }
    return map;
  }, [ocrResults]);

  const [expandedOcr, setExpandedOcr] = useState<Set<string>>(new Set());

  const toggleOcrPreview = (drawingId: string) => {
    setExpandedOcr((prev) => {
      const next = new Set(prev);
      if (next.has(drawingId)) next.delete(drawingId);
      else next.add(drawingId);
      return next;
    });
  };

  if (drawings.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-6 text-center">
        <Layers className="mx-auto h-7 w-7 text-slate-400 mb-2" />
        <p className="text-sm font-medium text-slate-600">No drawings uploaded</p>
        <p className="text-xs text-slate-500 mt-1">Upload drawings in the Drawings tab first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {duplicateIdentities.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 space-y-1.5">
          <p className="font-medium">
            <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
            Duplicate drawings detected. Package analysis may double-count evidence unless duplicates are removed or skipped.
          </p>
          <ul className="list-disc list-inside text-[11px] space-y-0.5">
            {duplicateIdentities.map((d) => (
              <li key={d.identity}>
                <span className="font-mono">{d.identity}</span> appears {d.count} times
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-amber-800">
            Analysis uses one drawing per number (ZIP import preferred). OCR results match exact drawing IDs — a duplicate copy may not have OCR run yet.
          </p>
        </div>
      )}

    <div className="overflow-x-auto rounded-md border border-slate-200">
      <Table className="text-xs min-w-[700px]">
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead>Drawing File</TableHead>
            <TableHead>Format</TableHead>
            <TableHead>Detected Type</TableHead>
            <TableHead>Sheet Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>OCR</TableHead>
            <TableHead>Actions</TableHead>
            <TableHead>Type Confidence</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {drawings.map((d) => {
            const cls = classMap.get(d.id) ?? classifyDrawingByName(d.fileName, d.fileType, d.id);
            const statusStyle = ANALYSIS_STATUS_STYLES[cls.analysisStatus ?? "not_analysed"];
            const drawingOcr = ocrByDrawing.get(d.id) ?? [];
            const ocrStatus: OcrStatus = resolveDrawingOcrStatus(
              d,
              ocrResults,
              cls.ocrStatus
            );
            const ocrFailureReason =
              ocrStatus === "failed"
                ? getOcrFailureWarnings(d.id, ocrResults)[0]
                : undefined;
            const rowNotes = resolvePackageSummaryNotes(
              d.id,
              ocrStatus,
              cls,
              evidence,
              ocrFailureReason
            );
            const displayStatusStyle =
              ocrStatus === "completed" &&
              cls.analysisStatus === "scanned_or_image_pdf"
                ? { label: "OCR Ready", color: "bg-green-100 text-green-800" }
                : statusStyle;
            const isOcrRunning = ocrRunningId === d.id;
            const ocrTextPreview = drawingOcr
              .filter((r) => r.status === "completed" && r.extractedText.trim())
              .map((r) => r.extractedText)
              .join("\n")
              .slice(0, 500);
            const showOcrPreview = expandedOcr.has(d.id) && ocrTextPreview.length > 0;

            return (
              <Fragment key={d.id}>
              <TableRow className={cn(
                ocrStatus === "completed" && "bg-green-50/30",
                ocrStatus !== "completed" && cls.analysisStatus === "scanned_or_image_pdf" && "bg-orange-50/30",
                cls.analysisStatus === "duplicate_skipped" && "bg-amber-50/30"
              )}>
                <TableCell className="font-medium max-w-[200px]">
                  <span className="line-clamp-1">{d.fileName}</span>
                </TableCell>
                <TableCell className="uppercase text-[10px] text-slate-500">{d.fileType}</TableCell>
                <TableCell>
                  <Badge className={cn("text-[10px] px-2 py-0", DRAWING_TYPE_BADGE_COLORS[cls.drawingType] ?? "bg-slate-100 text-slate-600")}>
                    {DRAWING_PACKAGE_TYPE_LABELS[cls.drawingType]}
                  </Badge>
                  {analysed && classMap.has(d.id) && (
                    <span className="ml-1 text-[9px] text-slate-400">✓</span>
                  )}
                </TableCell>
                <TableCell className="text-[10px] text-slate-600 max-w-[120px]">
                  <span className="line-clamp-1">{cls.sheetTitle ?? "—"}</span>
                </TableCell>
                <TableCell>
                  <Badge className={cn("text-[10px] px-1.5 py-0", displayStatusStyle.color)}>
                    {displayStatusStyle.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    {isOcrRunning ? (
                      <Badge className={cn("text-[10px] px-1.5 py-0 w-fit", OCR_STATUS_COLORS.running)}>
                        OCR running…
                      </Badge>
                    ) : ocrStatus === "needed" ? (
                      <Badge className="text-[10px] px-1.5 py-0 bg-orange-200 text-orange-900 flex items-center gap-0.5 w-fit">
                        <ScanLine className="h-2.5 w-2.5" />OCR Needed
                      </Badge>
                    ) : ocrStatus !== "not_needed" ? (
                      <Badge className={cn("text-[10px] px-1.5 py-0 w-fit", OCR_STATUS_COLORS[ocrStatus])}>
                        {OCR_STATUS_LABELS[ocrStatus]}
                      </Badge>
                    ) : null}
                    {ocrFailureReason && (
                      <span className="text-[9px] text-red-700 line-clamp-2 max-w-[140px]">
                        {ocrFailureReason}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {d.fileType === "pdf" && (ocrStatus === "needed" || ocrStatus === "failed") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2"
                      disabled={isOcrRunning || ocrRunningId !== null}
                      onClick={() => onRunOcr(d)}
                    >
                      {isOcrRunning ? (
                        <><Loader2 className="h-3 w-3 animate-spin" />OCR…</>
                      ) : (
                        <><ScanLine className="h-3 w-3" />Run OCR</>
                      )}
                    </Button>
                  )}
                  {ocrStatus === "completed" && ocrTextPreview && (
                    <button
                      type="button"
                      onClick={() => toggleOcrPreview(d.id)}
                      className="text-[10px] text-blue-600 hover:underline"
                    >
                      {showOcrPreview ? "Hide text" : "Preview OCR text"}
                    </button>
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={cn("text-[10px] px-1.5 py-0", CONF_COLORS[cls.confidence])}>
                    {cls.confidence}
                  </Badge>
                  <span className="block text-[9px] text-slate-400 mt-0.5">classification</span>
                </TableCell>
                <TableCell className="text-[10px] text-slate-500 max-w-[160px]">
                  <span className="line-clamp-2">{rowNotes}</span>
                </TableCell>
              </TableRow>
              {showOcrPreview && (
                <TableRow key={`${d.id}-ocr-preview`} className="bg-blue-50/30">
                  <TableCell colSpan={9} className="py-2">
                    <p className="text-[10px] font-medium text-slate-600 mb-1">OCR extracted text (preview):</p>
                    <pre className="text-[10px] text-slate-700 whitespace-pre-wrap max-h-32 overflow-y-auto font-mono bg-white border border-slate-200 rounded p-2">
                      {ocrTextPreview}{ocrTextPreview.length >= 500 ? "…" : ""}
                    </pre>
                    <p className="text-[9px] text-amber-700 mt-1">
                      OCR may be imperfect. Verify all quantities manually.
                    </p>
                  </TableCell>
                </TableRow>
              )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evidence Section
// ---------------------------------------------------------------------------

function EvidenceSection({ evidence }: { evidence: DrawingEvidence[] }) {
  const allCandidates = useMemo(
    () =>
      evidence.flatMap((ev) =>
        ev.candidates.map((c) => ({
          ...c,
          _drawingName: ev.drawingName,
          _drawingType: ev.drawingType,
        }))
      ),
    [evidence]
  );

  if (allCandidates.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic px-1">
        No item-level evidence found. Check that your PDFs have a text layer and contain item codes (W-01, SD-01, etc.), or run OCR on scanned PDFs first.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <Table className="text-xs min-w-[760px]">
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead>Item / Possible Item</TableHead>
            <TableHead>Drawing Type</TableHead>
            <TableHead>Source Drawing</TableHead>
            <TableHead>Page</TableHead>
            <TableHead>Evidence Found</TableHead>
            <TableHead>Evidence Confidence</TableHead>
            <TableHead>Notes / Warnings</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {allCandidates.map((c) => {
            const evidenceParts: string[] = [];
            if (c.itemCode) evidenceParts.push(`Code: ${c.itemCode}`);
            if (c.width !== undefined && c.height !== undefined)
              evidenceParts.push(`${c.width}×${c.height}m`);
            else if (c.width !== undefined) evidenceParts.push(`W: ${c.width}m`);
            else if (c.height !== undefined) evidenceParts.push(`H: ${c.height}m`);
            if (c.count !== undefined) evidenceParts.push(`qty: ${c.count}`);
            if (c.length !== undefined) evidenceParts.push(`${c.length}lm`);
            if (c.areaEach !== undefined) evidenceParts.push(`${c.areaEach}sqm/ea`);

            return (
              <TableRow key={c._tempId} className={cn(c.confidence === "low" && "bg-red-50/20")}>
                <TableCell className="font-medium">
                  {c.itemCode && <span className="font-mono text-[11px] mr-1">{c.itemCode}</span>}
                  {c.description}
                </TableCell>
                <TableCell className="text-[10px] text-slate-600">
                  {DRAWING_PACKAGE_TYPE_LABELS[c._drawingType as keyof typeof DRAWING_PACKAGE_TYPE_LABELS] ?? c._drawingType}
                </TableCell>
                <TableCell className="text-[10px] text-slate-600 max-w-[130px]">
                  <span className="line-clamp-1">{c._drawingName}</span>
                </TableCell>
                <TableCell>{c.sourcePage ?? "—"}</TableCell>
                <TableCell className="text-[10px]">
                  {evidenceParts.length > 0 ? evidenceParts.join(", ") : "—"}
                </TableCell>
                <TableCell>
                  <Badge className={cn("text-[10px] px-1.5 py-0", CONF_COLORS[c.confidence])}>
                    {c.confidence}
                  </Badge>
                  {c.sourceType === "ocr_text" && (
                    <span className="block text-[9px] text-amber-700 mt-0.5">OCR (capped)</span>
                  )}
                </TableCell>
                <TableCell className="text-[10px] text-amber-700 max-w-[140px]">
                  <span className="line-clamp-2">{c.warnings.length > 0 ? c.warnings.join("; ") : "—"}</span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual Fill Form
// ---------------------------------------------------------------------------

interface ManualFillFormProps {
  issue: DrawingIssueItem;
  onConvert: (issue: DrawingIssueItem, updates: Partial<DrawingIssueItem>) => void;
  onIgnore: (issue: DrawingIssueItem) => void;
  onClose: () => void;
}

function ManualFillForm({ issue, onConvert, onIgnore, onClose }: ManualFillFormProps) {
  const [code, setCode]           = useState(issue.manualItemCode ?? "");
  const [desc, setDesc]           = useState(issue.manualDescription ?? issue.possibleDescription ?? "");
  const [count, setCount]         = useState(issue.manualCount ?? "1");
  const [width, setWidth]         = useState(issue.manualWidth ?? "");
  const [height, setHeight]       = useState(issue.manualHeight ?? "");
  const [thickness, setThickness] = useState(issue.manualThickness ?? "");
  const [length, setLength]       = useState(issue.manualLength ?? "");
  const [unit, setUnit]           = useState<DrawingTakeoffUnit>(issue.manualUnit ?? issue.suggestedUnit ?? "sqm");
  const [notes, setNotes]         = useState(issue.manualNotes ?? "");

  const w   = parseFloat(width)  || undefined;
  const h   = parseFloat(height) || undefined;
  const cnt = parseInt(count)    || 1;
  const areaEach  = w && h ? Math.round(w * h * 100) / 100 : undefined;
  const totalArea = areaEach ? Math.round(areaEach * cnt * 100) / 100 : undefined;

  return (
    <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-blue-900">Fill Missing Data</h4>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
        <div className="space-y-0.5">
          <label className="text-[10px] font-medium text-slate-700">Item code</label>
          <Input className="h-7 text-xs" placeholder="W-01" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="col-span-3 space-y-0.5">
          <label className="text-[10px] font-medium text-slate-700">Description</label>
          <Input className="h-7 text-xs" placeholder="Item description" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 text-xs">
        {[
          { label: "Count",        value: count,     set: setCount,     type: "number", placeholder: "1",    step: "1" },
          { label: "Width (m)",    value: width,     set: setWidth,     type: "number", placeholder: "1.20", step: "0.01" },
          { label: "Height (m)",   value: height,    set: setHeight,    type: "number", placeholder: "2.90", step: "0.01" },
          { label: "Thickness (m)",value: thickness, set: setThickness, type: "number", placeholder: "0.012",step: "0.001" },
          { label: "Length (lm)",  value: length,    set: setLength,    type: "number", placeholder: "45",   step: "0.1" },
        ].map((f) => (
          <div key={f.label} className="space-y-0.5">
            <label className="text-[10px] font-medium text-slate-700">{f.label}</label>
            <Input
              type={f.type}
              step={f.step}
              min={0}
              className="h-7 text-xs"
              placeholder={f.placeholder}
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
            />
          </div>
        ))}
        <div className="space-y-0.5">
          <label className="text-[10px] font-medium text-slate-700">Unit</label>
          <select
            className="h-7 w-full rounded border border-slate-300 bg-white px-1.5 text-xs"
            value={unit}
            onChange={(e) => setUnit(e.target.value as DrawingTakeoffUnit)}
          >
            <option value="sqm">sqm</option>
            <option value="lm">lm</option>
            <option value="nos">nos</option>
            <option value="set">set</option>
          </select>
        </div>
      </div>

      {(areaEach !== undefined || parseFloat(length) > 0) && (
        <div className="rounded bg-white border border-blue-200 px-3 py-1.5 text-[10px] text-blue-900">
          {areaEach !== undefined && (
            <span>
              Area each: <strong>{areaEach} sqm</strong>
              {cnt > 1 && <> · Total: <strong>{totalArea} sqm</strong></>}
            </span>
          )}
          {parseFloat(length) > 0 && (
            <span className="ml-3">Length: <strong>{length} lm</strong></span>
          )}
        </div>
      )}

      <div className="space-y-0.5">
        <label className="text-[10px] font-medium text-slate-700">Notes</label>
        <Textarea
          rows={1}
          className="text-xs resize-none"
          placeholder="Measurement basis, assumptions…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="h-7 text-[11px]"
          onClick={() =>
            onConvert(issue, {
              manualItemCode: code.trim() || undefined,
              manualDescription: desc.trim() || undefined,
              manualCount: count,
              manualWidth: width,
              manualHeight: height,
              manualThickness: thickness,
              manualLength: length,
              manualUnit: unit,
              manualNotes: notes,
            })
          }
          disabled={!desc.trim()}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Convert to Takeoff
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] text-amber-700 border-amber-300"
          onClick={() => onIgnore(issue)}
        >
          Ignore
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue Row
// ---------------------------------------------------------------------------

function IssueRow({
  issue,
  isExpanded,
  onToggleExpand,
  onConvert,
  onIgnore,
}: {
  issue: DrawingIssueItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onConvert: (issue: DrawingIssueItem, updates: Partial<DrawingIssueItem>) => Promise<void>;
  onIgnore: (issue: DrawingIssueItem) => Promise<void>;
}) {
  const isCrossDrawingIssue =
    (issue.reason ?? "").toLowerCase().includes("cross-drawing quantity builder") ||
    (issue.detectedEvidence ?? "").toLowerCase().includes("cross-drawing quantity builder");
  const handleConvert = async (iss: DrawingIssueItem, updates: Partial<DrawingIssueItem>) => {
    await onConvert(iss, updates);
    onToggleExpand();
  };

  return (
    <>
      <TableRow className={cn(issue.confidence === "low" && "bg-red-50/30")}>
        <TableCell className="font-medium text-[11px]">
          {DRAWING_ISSUE_TYPE_LABELS[issue.issueType] ?? issue.issueType}
          {isCrossDrawingIssue && (
            <Badge className="ml-1 text-[9px] px-1 bg-blue-100 text-blue-800">
              cross-drawing
            </Badge>
          )}
        </TableCell>
        <TableCell className="text-[10px]">{issue.possibleDescription ?? "—"}</TableCell>
        <TableCell className="text-[10px] text-slate-600 max-w-[120px]">
          <span className="line-clamp-1">{issue.sourceDrawingName ?? "—"}</span>
        </TableCell>
        <TableCell className="text-[10px]">{issue.sourcePage ?? "—"}</TableCell>
        <TableCell className="text-[10px] text-amber-700">{issue.missingFields.join(", ")}</TableCell>
        <TableCell className="text-[10px] text-slate-600 max-w-[180px]">
          <span className="line-clamp-2">{issue.recommendation}</span>
        </TableCell>
        <TableCell>
          <Badge className={cn("text-[10px] px-1.5 py-0", CONF_COLORS[issue.confidence])}>
            {issue.confidence}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge className={cn("text-[10px] px-1.5 py-0", STATUS_COLORS[issue.status] ?? "")}>
            {issue.status.replace(/_/g, " ")}
          </Badge>
        </TableCell>
        <TableCell>
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex items-center gap-1 text-[10px] text-blue-600 hover:underline"
          >
            <Wrench className="h-3 w-3" />
            Fill
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow>
          <TableCell colSpan={9} className="p-0">
            <div className="px-4 py-2">
              <ManualFillForm
                issue={issue}
                onConvert={handleConvert}
                onIgnore={onIgnore}
                onClose={onToggleExpand}
              />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Missing Info Section
// ---------------------------------------------------------------------------

function MissingInfoSection({
  projectId,
  savedIssues,
  freshCandidates,
  onSaveIssues,
  onConvert,
  onIgnore,
}: {
  projectId: string;
  savedIssues: DrawingIssueItem[];
  freshCandidates: CreateDrawingIssueItemInput[];
  onSaveIssues: (inputs: CreateDrawingIssueItemInput[]) => Promise<void>;
  onConvert: (issue: DrawingIssueItem, updates: Partial<DrawingIssueItem>) => Promise<void>;
  onIgnore: (issue: DrawingIssueItem) => Promise<void>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filteredSaved = savedIssues.filter(
    (i) => i.projectId === projectId && i.status !== "ignored" && i.status !== "converted_to_takeoff"
  );
  const openFresh = freshCandidates.filter((c) => c.status === "open");
  const allIssues = [...filteredSaved];

  const total = allIssues.length + openFresh.length;

  // Summary counts for the top cards
  const missingDimCount  = allIssues.filter((i) =>
    ["missing_width", "missing_height", "missing_count"].includes(i.issueType)
  ).length + openFresh.filter((i) =>
    ["missing_width", "missing_height", "missing_count"].includes(i.issueType)
  ).length;

  const manualMeasCount  = allIssues.filter((i) => i.issueType === "manual_measurement_required").length
    + openFresh.filter((i) => i.issueType === "manual_measurement_required").length;

  const needsDrawingCount = allIssues.filter((i) =>
    ["needs_elevation", "needs_schedule", "needs_section"].includes(i.issueType)
  ).length + openFresh.filter((i) =>
    ["needs_elevation", "needs_schedule", "needs_section"].includes(i.issueType)
  ).length;

  const uncodedCount = allIssues.filter((i) =>
    ["uncoded_opening", "missing_code"].includes(i.issueType)
  ).length + openFresh.filter((i) =>
    ["uncoded_opening", "missing_code"].includes(i.issueType)
  ).length;

  const handleSaveAll = async () => {
    setSaving(true);
    try { await onSaveIssues(openFresh); }
    finally { setSaving(false); }
  };

  // Summary cards
  const summaryCards = [
    { label: "Missing Dimensions",        count: missingDimCount,   color: missingDimCount   > 0 ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-500" },
    { label: "Manual Measurement Needed", count: manualMeasCount,   color: manualMeasCount   > 0 ? "bg-red-100 text-red-900"    : "bg-slate-100 text-slate-500" },
    { label: "Needs Schedule/Elevation",  count: needsDrawingCount, color: needsDrawingCount > 0 ? "bg-blue-100 text-blue-900"  : "bg-slate-100 text-slate-500" },
    { label: "Uncoded Openings",          count: uncodedCount,      color: uncodedCount      > 0 ? "bg-orange-100 text-orange-900" : "bg-slate-100 text-slate-500" },
  ];

  return (
    <div className="space-y-4">
      {/* Issue category summary cards */}
      <div className="flex flex-wrap gap-2">
        {summaryCards.map((c) => (
          <div key={c.label} className={cn("flex items-center gap-2 rounded-lg px-3 py-2", c.color)}>
            <span className="text-lg font-bold">{c.count}</span>
            <span className="text-[11px] font-medium">{c.label}</span>
          </div>
        ))}
      </div>

      {total === 0 && openFresh.length === 0 ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 className="inline h-4 w-4 mr-1" />
          No missing information issues. All detected items have sufficient data.
        </div>
      ) : (
        <>
          {openFresh.length > 0 && (
            <div className="flex items-center justify-between rounded-md bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-800">
              <span>
                <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                <strong>{openFresh.length}</strong> new issue{openFresh.length > 1 ? "s" : ""} from this analysis (not yet saved)
              </span>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={handleSaveAll} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save issues to project
              </Button>
            </div>
          )}

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <Table className="text-xs min-w-[860px]">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Issue Type</TableHead>
                  <TableHead>Possible Item</TableHead>
                  <TableHead>Source Drawing</TableHead>
                  <TableHead>Page</TableHead>
                  <TableHead>Missing Fields</TableHead>
                  <TableHead>Recommendation</TableHead>
                  <TableHead>Conf.</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSaved.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    isExpanded={expandedId === issue.id}
                    onToggleExpand={() =>
                      setExpandedId((v) => (v === issue.id ? null : issue.id))
                    }
                    onConvert={onConvert}
                    onIgnore={onIgnore}
                  />
                ))}
                {/* Fresh unsaved candidates (read-only preview) */}
                {openFresh.map((input, idx) => (
                  <TableRow key={`fresh-${idx}`} className="bg-amber-50/40">
                    <TableCell className="text-[10px] text-amber-800 font-medium">
                      {DRAWING_ISSUE_TYPE_LABELS[input.issueType] ?? input.issueType}
                      <Badge className="ml-1 text-[9px] px-1 bg-amber-200 text-amber-900">new</Badge>
                    </TableCell>
                    <TableCell className="text-[10px]">{input.possibleDescription ?? "—"}</TableCell>
                    <TableCell className="text-[10px] text-slate-500">{input.sourceDrawingName ?? "—"}</TableCell>
                    <TableCell className="text-[10px]">{input.sourcePage ?? "—"}</TableCell>
                    <TableCell className="text-[10px] text-amber-700">{input.missingFields.join(", ")}</TableCell>
                    <TableCell className="text-[10px] text-slate-500 max-w-[160px]">
                      <span className="line-clamp-2">{input.recommendation}</span>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-[10px] px-1.5 py-0", CONF_COLORS[input.confidence])}>
                        {input.confidence}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[10px] text-amber-700">open</TableCell>
                    <TableCell className="text-[10px] text-slate-400 italic">Save first</TableCell>
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

// ---------------------------------------------------------------------------
// Cross-Drawing helper utilities
// ---------------------------------------------------------------------------

/** Map a missing field name to the closest DrawingIssueType. */
function fieldToIssueType(
  field: string,
  category: string
): import("@/types/drawing-takeoff").DrawingIssueType {
  switch (field.toLowerCase()) {
    case "width":     return "missing_width";
    case "height":    return "missing_height";
    case "count":     return "missing_count";
    case "length":    return "missing_width"; // closest available for lm items
    case "unit":      return "missing_unit";
    case "thickness": return "missing_thickness";
    default: {
      const c = category.toLowerCase();
      if (c.includes("curtain") || c.includes("elevation")) return "needs_elevation";
      if (c.includes("schedule")) return "needs_schedule";
      if (c.includes("section") || c.includes("detail")) return "needs_section";
      return "unclear_item";
    }
  }
}

/**
 * Pick the primary issueType for a candidate with multiple missing fields.
 * Priority: width > height > count > length > thickness > unit > category fallback.
 */
function primaryIssueType(
  missingFields: string[],
  category: string
): import("@/types/drawing-takeoff").DrawingIssueType {
  const priority = ["width", "height", "count", "length", "thickness", "unit"];
  for (const f of priority) {
    if (missingFields.map((x) => x.toLowerCase()).includes(f)) {
      return fieldToIssueType(f, category);
    }
  }
  return fieldToIssueType(missingFields[0] ?? "", category);
}

/**
 * Return a human-readable recommendation for finding a missing field based on
 * item category — guides estimators to the right drawing type.
 */
function suggestSource(field: string, category: string): string {
  const f = field.toLowerCase();
  const c = category.toLowerCase();

  if (f === "width" || f === "height") {
    if (c.includes("window") || c.includes("door"))
      return "Check window/door schedule or elevation drawing for exact dimensions.";
    if (c.includes("curtain"))
      return "Check elevation drawing or CAD model for curtain wall dimensions.";
    return "Check elevation or schedule drawing for dimensions.";
  }
  if (f === "count") {
    if (c.includes("window") || c.includes("door"))
      return "Check floor plan for item count (each opening should be coded).";
    return "Check floor plan or schedule for quantity.";
  }
  if (f === "length") {
    if (c.includes("balustrade") || c.includes("railing"))
      return "Check floor plan or CAD for railing run length.";
    if (c.includes("fin"))
      return "Check elevation or floor plan for aluminium fin total run.";
    return "Check plan or elevation for running length.";
  }
  if (f === "thickness") {
    return "Check section drawing or detail for glass/frame thickness specification.";
  }
  return "Manual measurement required — check relevant drawing type.";
}

/**
 * Produce a consolidated recommendation for ALL missing fields on a candidate.
 */
function consolidatedRecommendation(missingFields: string[], category: string): string {
  const parts = missingFields.map((f) => suggestSource(f, category));
  const unique = Array.from(new Set(parts));
  return unique.join(" ");
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export default function DrawingPackageReviewTab({
  projectId,
  project,
  drawings,
}: DrawingPackageReviewTabProps) {
  const addTakeoffItems = useDrawingTakeoffStore((s) => s.addItems);
  const allTakeoffItems = useDrawingTakeoffStore((s) => s.items);
  const addIssues = useDrawingIssueStore((s) => s.addItems);
  const updateIssue = useDrawingIssueStore((s) => s.updateItem);
  const allIssues = useDrawingIssueStore((s) => s.items);
  const companyProfile = useCompanyStore((s) => s.profile);
  const allOcrResults = useOcrResultStore((s) => s.results);
  const saveOcrForDrawing = useOcrResultStore((s) => s.saveForDrawing);
  const aiReviewResultsByProject = useAiReviewStore((s) => s.resultsByProject);
  const aiReviewIsHydrated = useAiReviewStore((s) => s.isHydrated);
  const hydrateAiReview = useAiReviewStore((s) => s.hydrate);
  const saveAiReviewResult = useAiReviewStore((s) => s.saveResult);

  const projectOcrResults = useMemo(
    () => allOcrResults.filter((r) => r.projectId === projectId),
    [allOcrResults, projectId]
  );

  const projectTakeoffItems = useMemo(
    () => allTakeoffItems.filter((i) => i.projectId === projectId),
    [allTakeoffItems, projectId]
  );
  const projectIssues = useMemo(
    () => allIssues.filter((i) => i.projectId === projectId),
    [allIssues, projectId]
  );

  const duplicateIdentities = useMemo(
    () => summarizeDuplicateIdentities(drawings),
    [drawings]
  );

  const [analysis, setAnalysis] = useState<AnalysisState>(INITIAL_ANALYSIS);
  const [activeSection, setActiveSection] = useState<
    "summary" | "evidence" | "quantities" | "crossDrawing" | "aiReview" | "issues"
  >("summary");
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [showZipUpload, setShowZipUpload] = useState(false);
  const [zipImportedCount, setZipImportedCount] = useState(0);
  const [ocrRunningId, setOcrRunningId] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState("");
  const [ocrBatchSummary, setOcrBatchSummary] = useState<OcrBatchSummary | null>(null);

  // ── Cross-Drawing Quantity Builder state ──────────────────────────────────
  const [crossDrawingResult, setCrossDrawingResult] = useState<CrossDrawingBuildResult | null>(null);
  const [isBuildingCrossDrawing, setIsBuildingCrossDrawing] = useState(false);
  const [crossDrawingError, setCrossDrawingError] = useState<string | null>(null);
  const [crossDrawingActionFeedback, setCrossDrawingActionFeedback] =
    useState<CrossDrawingActionFeedback | null>(null);
  const [isRunningAiReview, setIsRunningAiReview] = useState(false);
  const [aiReviewError, setAiReviewError] = useState<string | null>(null);
  const [aiReviewFeedback, setAiReviewFeedback] =
    useState<AiReviewActionFeedback | null>(null);

  const projectAiReviewResult = useMemo(
    () => aiReviewResultsByProject[projectId] ?? null,
    [aiReviewResultsByProject, projectId]
  );

  useEffect(() => {
    if (!aiReviewIsHydrated) {
      hydrateAiReview();
    }
  }, [aiReviewIsHydrated, hydrateAiReview]);

  /** Run OCR for one drawing; always saves results (including failures) to store. */
  const runOcrForDrawing = useCallback(
    async (drawing: DrawingFile): Promise<"completed" | "failed"> => {
      if (drawing.fileType !== "pdf") return "failed";

      try {
        const inputs = await runOcrOnPdf(drawing, (p) =>
          setOcrProgress(`${drawing.fileName}: ${p.message}`)
        );
        await saveOcrForDrawing(drawing.id, inputs);
        return ocrInputsHaveCompletedText(inputs) ? "completed" : "failed";
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "OCR failed unexpectedly.";
        await saveOcrForDrawing(drawing.id, [
          createFailedOcrResultInput(drawing, message),
        ]);
        return "failed";
      }
    },
    [saveOcrForDrawing]
  );

  // ── Run OCR on a single drawing ───────────────────────────────────────────
  const handleRunOcr = useCallback(
    async (drawing: DrawingFile) => {
      setOcrRunningId(drawing.id);
      setOcrProgress(`Starting OCR on ${drawing.fileName}…`);
      setOcrBatchSummary(null);

      try {
        const outcome = await runOcrForDrawing(drawing);
        setOcrBatchSummary({
          completed: outcome === "completed" ? 1 : 0,
          failed: outcome === "failed" ? 1 : 0,
          total: 1,
        });
      } finally {
        setOcrRunningId(null);
        setOcrProgress("");
      }
    },
    [runOcrForDrawing]
  );

  // ── Run OCR on all scanned PDFs in project ────────────────────────────────
  const handleRunOcrForAllScanned = useCallback(async () => {
    const scannedPdfs = drawings.filter((d) => {
      if (d.fileType !== "pdf") return false;
      const cls = analysis.classifiedDrawings.find((c) => c.drawingId === d.id);
      const status = resolveDrawingOcrStatus(d, projectOcrResults, cls?.ocrStatus);
      return status === "needed" || status === "failed";
    });

    if (scannedPdfs.length === 0) return;

    setOcrBatchSummary(null);
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < scannedPdfs.length; i++) {
      const drawing = scannedPdfs[i];
      setOcrRunningId(drawing.id);
      setOcrProgress(
        `OCR batch (${i + 1}/${scannedPdfs.length}): ${drawing.fileName}…`
      );

      try {
        const outcome = await runOcrForDrawing(drawing);
        if (outcome === "completed") completed++;
        else failed++;
      } catch {
        failed++;
      } finally {
        setOcrRunningId(null);
      }
    }

    setOcrProgress("");
    setOcrBatchSummary({
      completed,
      failed,
      total: scannedPdfs.length,
    });
  }, [drawings, analysis.classifiedDrawings, projectOcrResults, runOcrForDrawing]);

  // ── Run full package analysis ─────────────────────────────────────────────
  const handleRunAnalysis = useCallback(async () => {
    setAnalysis({ ...INITIAL_ANALYSIS, status: "running", progress: "Starting analysis…" });
    setActiveSection("summary");
    setOcrBatchSummary(null);

    const ocrResults = useOcrResultStore.getState().getByProjectId(projectId);

    try {
      const classifiedDrawings: ClassifiedDrawing[] = [];
      const evidence: DrawingEvidence[] = [];
      const warnings: string[] = [];

      const { skippedDuplicates } = selectDrawingsForPackageAnalysis(drawings);

      for (const drawing of drawings) {
        setAnalysis((prev) => ({
          ...prev,
          progress: `Analysing: ${drawing.fileName} (${drawings.indexOf(drawing) + 1}/${drawings.length})`,
        }));

        const skipInfo = skippedDuplicates.get(drawing.id);
        if (skipInfo) {
          classifiedDrawings.push({
            ...classifyDrawingByName(drawing.fileName, drawing.fileType, drawing.id),
            analysisStatus: "duplicate_skipped",
            needsOcr: false,
            ocrStatus: resolveDrawingOcrStatus(drawing, ocrResults),
            extractionNotes: [
              `Duplicate skipped to avoid double counting (${skipInfo.identity}). Using ${skipInfo.keptFileName} instead.`,
              "OCR results match exact drawing IDs; run OCR on the kept copy if needed.",
            ],
          });
          warnings.push(
            `Duplicate drawing skipped: ${drawing.fileName} (${skipInfo.identity}). Using ${skipInfo.keptFileName} for analysis.`
          );
          continue;
        }

        // ── DXF / DWG — unsupported for text extraction ────────────────────
        if (drawing.fileType === "dxf" || drawing.fileType === "dwg") {
          classifiedDrawings.push({
            ...classifyDrawingByName(drawing.fileName, drawing.fileType, drawing.id),
            analysisStatus: "unsupported_format",
            needsOcr: false,
            ocrStatus: "not_needed",
            extractionNotes: ["DXF/DWG: text extraction not available. Use the DXF Layer Mapping tab."],
          });
          continue;
        }

        // ── Load the file ──────────────────────────────────────────────────
        let file: File;
        try {
          file = await resolveDrawingBlob(drawing);
        } catch (err) {
          const failureNotes = buildBlobFailureNotes(drawing, err);
          classifiedDrawings.push({
            ...classifyDrawingByName(drawing.fileName, drawing.fileType, drawing.id),
            analysisStatus: "extraction_failed",
            needsOcr: false,
            ocrStatus: "not_needed",
            extractionNotes: failureNotes,
          });
          warnings.push(`${drawing.fileName}: ${failureNotes.join(" ")}`);
          continue;
        }

        // ── Extract PDF text + merge with OCR if available ─────────────────
        const pdfResult = await extractPdfText(file);
        const bestText = getBestAvailableTextForDrawing(drawing, pdfResult, ocrResults);

        if (pdfResult.error && bestText.source === "none") {
          const sourceHint = drawing.notes?.match(/\[ZIP:\s*(.+?)\]/)?.[1];
          classifiedDrawings.push({
            ...classifyDrawingByName(drawing.fileName, drawing.fileType, drawing.id),
            analysisStatus: "extraction_failed",
            needsOcr: false,
            ocrStatus: "not_needed",
            extractionNotes: [
              `PDF extraction error: ${pdfResult.error}`,
              `Blob available: ${drawing.hasLocalBlob ? "yes" : "no"}.`,
              `File size: ${(drawing.fileSize / 1024 / 1024).toFixed(1)} MB.`,
              sourceHint ? `ZIP/source path: ${sourceHint}.` : "ZIP/source path: unknown.",
              "Action: Re-import this drawing or replace drawing file. If the PDF is scanned/image-only, run OCR after re-import.",
            ],
          });
          warnings.push(`${drawing.fileName}: PDF extraction error — ${pdfResult.error}`);
          continue;
        }

        // ── Scanned PDF with no OCR text yet ───────────────────────────────
        if (bestText.source === "none" && bestText.needsOcr) {
          const clsByName = classifyDrawingByName(drawing.fileName, drawing.fileType, drawing.id);
          classifiedDrawings.push({
            ...clsByName,
            analysisStatus: "scanned_or_image_pdf",
            needsOcr: true,
            ocrStatus: "needed",
            extractionNotes: [
              "Scanned / image PDF detected. Text could not be extracted.",
              "Run OCR to extract text for evidence and quantity analysis.",
            ],
          });
          warnings.push(`${drawing.fileName}: scanned PDF — run OCR to extract text.`);
          continue;
        }

        // ── Text available (PDF layer or OCR) ──────────────────────────────
        const isOcrSource = bestText.source === "ocr_text";
        let cls = classifyDrawingByText(bestText.text, drawing.fileName, drawing.fileType, drawing.id);

        if (isOcrSource && cls.confidence === "high") {
          cls = { ...cls, confidence: "medium" };
        }

        classifiedDrawings.push({
          ...cls,
          analysisStatus: "text_extractable",
          needsOcr: false,
          ocrStatus: bestText.ocrStatus,
          extractionNotes: isOcrSource
            ? [
                "OCR text used for analysis. Verify results manually.",
                ...bestText.warnings.slice(0, 1),
              ]
            : [],
        });

        const extractResult = extractFromDrawingText(bestText.text, drawing.id);
        let candidates = extractResult.candidates;
        if (isOcrSource) {
          candidates = applyOcrCandidateAdjustments(candidates);
        }

        evidence.push({
          drawingId: drawing.id,
          drawingName: drawing.fileName,
          drawingType: cls.drawingType,
          classificationConfidence: cls.confidence,
          sheetTitle: cls.sheetTitle,
          rawText: bestText.text,
          textSource: bestText.source,
          candidates,
        });

        if (isOcrSource) {
          warnings.push(
            `${drawing.fileName}: evidence from OCR text — verify manually (confidence capped).`
          );
        }
      }

      // ── Detect missing information ─────────────────────────────────────────
      const { issues } = detectMissingInformation(projectId, evidence);

      setAnalysis({
        status: "done",
        progress: "",
        classifiedDrawings,
        evidence,
        quantityCandidates: evidence.flatMap((ev) => ev.candidates),
        issueCandidates: issues,
        warnings,
        errorMsg: null,
      });
      setActiveSection("summary");
    } catch (err) {
      setAnalysis((prev) => ({
        ...prev,
        status: "error",
        progress: "",
        errorMsg: err instanceof Error ? err.message : "Analysis failed unexpectedly.",
      }));
    }
  }, [drawings, projectId]);

  // ── Save quantity candidates → Drawing Takeoff (safe actions) ─────────────
  const mapCandidatesToTakeoffInputs = useCallback(
    (
      candidates: DrawingTakeoffCandidate[],
      status: "verified" | "needs_verification" | "draft"
    ): CreateDrawingTakeoffItemInput[] =>
      candidates.map((c) => {
        const ev = analysis.evidence.find(
          (e) =>
            e.drawingId === c.drawingId ||
            e.candidates.some((cc) => cc._tempId === c._tempId)
        );
        return {
          projectId,
          drawingId: c.drawingId ?? ev?.drawingId,
          sourcePage: c.sourcePage,
          sheetTitle: c.sheetTitle ?? ev?.sheetTitle ?? undefined,
          sourceDrawingName: ev?.drawingName,
          itemCode: c.itemCode,
          description: c.description,
          category: c.category,
          count: c.count,
          width: c.width,
          height: c.height,
          areaEach: c.areaEach,
          totalArea: c.totalArea,
          length: c.length,
          unit: c.unit,
          sourceType: c.sourceType,
          confidence: c.confidence,
          warnings: c.warnings,
          status,
          notes: c.rawSnippet?.slice(0, 100)
            ? `Package analysis: ${c.rawSnippet.slice(0, 100)}`
            : undefined,
        };
      }),
    [analysis.evidence, projectId]
  );

  const removeSavedCandidates = useCallback(
    (saved: DrawingTakeoffCandidate[]) => {
      const ids = new Set<string>();
      for (const c of saved) {
        ids.add(c._tempId);
        c.linkedEvidenceIds?.forEach((id) => ids.add(id));
      }
      setAnalysis((prev) => ({
        ...prev,
        quantityCandidates: prev.quantityCandidates.filter((c) => !ids.has(c._tempId)),
      }));
    },
    []
  );

  const handleSaveVerifiedCandidates = useCallback(
    async (candidates: DrawingTakeoffCandidate[]) => {
      const eligible = candidates.filter(canSaveAsVerified);
      if (eligible.length === 0) return;
      setAcceptBusy(true);
      try {
        await addTakeoffItems(mapCandidatesToTakeoffInputs(eligible, "verified"));
        removeSavedCandidates(eligible);
      } finally {
        setAcceptBusy(false);
      }
    },
    [addTakeoffItems, mapCandidatesToTakeoffInputs, removeSavedCandidates]
  );

  const handleSaveNeedsVerificationCandidates = useCallback(
    async (candidates: DrawingTakeoffCandidate[]) => {
      if (candidates.length === 0) return;
      setAcceptBusy(true);
      try {
        await addTakeoffItems(
          mapCandidatesToTakeoffInputs(candidates, "needs_verification")
        );
        removeSavedCandidates(candidates);
      } finally {
        setAcceptBusy(false);
      }
    },
    [addTakeoffItems, mapCandidatesToTakeoffInputs, removeSavedCandidates]
  );

  const handleSendCandidatesToIssues = useCallback(
    async (candidates: DrawingTakeoffCandidate[]) => {
      if (candidates.length === 0) return;
      setAcceptBusy(true);
      try {
        const issues = candidatesToMissingInfoIssues(
          projectId,
          candidates,
          analysis.evidence
        );
        if (issues.length > 0) {
          await addIssues(issues);
        }
        removeSavedCandidates(candidates);
      } finally {
        setAcceptBusy(false);
      }
    },
    [addIssues, analysis.evidence, projectId, removeSavedCandidates]
  );

  // ── Save fresh issues to store ────────────────────────────────────────────
  const handleSaveIssues = useCallback(
    async (inputs: CreateDrawingIssueItemInput[]) => {
      await addIssues(inputs);
      setAnalysis((prev) => ({ ...prev, issueCandidates: [] }));
    },
    [addIssues]
  );

  // ── Convert issue → DrawingTakeoffItem ────────────────────────────────────
  const handleConvertIssue = useCallback(
    async (issue: DrawingIssueItem, updates: Partial<DrawingIssueItem>) => {
      const merged = { ...issue, ...updates };
      const w   = parseFloat(merged.manualWidth    ?? "") || undefined;
      const h   = parseFloat(merged.manualHeight   ?? "") || undefined;
      const cnt = parseInt(merged.manualCount      ?? "1") || 1;
      const len = parseFloat(merged.manualLength   ?? "") || undefined;
      const areaEach  = w && h ? Math.round(w * h * 100) / 100 : undefined;
      const totalArea = areaEach ? Math.round(areaEach * cnt * 100) / 100 : undefined;

      const code = merged.manualItemCode?.trim();
      const rule = code
        ? DRAWING_CODE_RULES.find(
            (r) =>
              code.toUpperCase() === r.prefix.toUpperCase() ||
              code.toUpperCase().startsWith(r.prefix.toUpperCase() + "-")
          )
        : undefined;
      const fromCrossDrawing =
        (issue.reason ?? "").toLowerCase().includes("cross-drawing quantity builder") ||
        (issue.detectedEvidence ?? "").toLowerCase().includes("cross-drawing quantity builder");
      const convertedNotes = merged.manualNotes?.trim()
        || [
          fromCrossDrawing ? "Created from Cross-Drawing Quantity Builder." : "Converted from missing-info issue.",
          issue.detectedEvidence ? `Evidence: ${issue.detectedEvidence}` : "",
          issue.sourceDrawingName ? `Source drawing: ${issue.sourceDrawingName}.` : "",
          issue.sourcePage ? `Page: ${issue.sourcePage}.` : "",
        ].filter(Boolean).join(" ");

      const takeoffInput: CreateDrawingTakeoffItemInput = {
        projectId,
        drawingId: issue.sourceDrawingId,
        sourcePage: issue.sourcePage,
        sheetTitle: issue.sourceSheetTitle,
        sourceDrawingName: issue.sourceDrawingName,
        itemCode: code || undefined,
        description: merged.manualDescription?.trim() || issue.possibleDescription || "—",
        category: (rule?.category as DrawingItemCategory | undefined) ?? issue.possibleCategory ?? "other",
        count: cnt > 1 ? cnt : undefined,
        width: w,
        height: h,
        thickness: parseFloat(merged.manualThickness ?? "") || undefined,
        areaEach,
        totalArea,
        length: len,
        unit: merged.manualUnit ?? issue.suggestedUnit ?? "sqm",
        sourceType: "manual_verify",
        confidence: "medium",
        warnings: [`Manually filled from issue: ${issue.issueType}`],
        notes: convertedNotes,
        status: "needs_verification",
      };

      const created = await addTakeoffItems([takeoffInput]);
      await updateIssue(issue.id, {
        ...updates,
        status: "converted_to_takeoff",
        convertedItemId: created[0]?.id,
      });
    },
    [projectId, addTakeoffItems, updateIssue]
  );

  const handleIgnoreIssue = useCallback(
    async (issue: DrawingIssueItem) => {
      await updateIssue(issue.id, { status: "ignored" });
    },
    [updateIssue]
  );

  // ── Build Cross-Drawing Quantities ────────────────────────────────────────
  const handleBuildCrossDrawing = useCallback(() => {
    if (analysis.status !== "done") {
      setCrossDrawingError(
        "Run Package Analysis first, then build Cross-Drawing Quantities."
      );
      return;
    }
    setIsBuildingCrossDrawing(true);
    setCrossDrawingError(null);
    setCrossDrawingActionFeedback(null);
    try {
      const result = buildCrossDrawingQuantities({
        projectId,
        drawings: drawings as Parameters<typeof buildCrossDrawingQuantities>[0]["drawings"],
        classifiedDrawings: analysis.classifiedDrawings as Parameters<typeof buildCrossDrawingQuantities>[0]["classifiedDrawings"],
        evidenceItems: analysis.evidence as Parameters<typeof buildCrossDrawingQuantities>[0]["evidenceItems"],
        drawingTakeoffCandidates: analysis.quantityCandidates as Parameters<typeof buildCrossDrawingQuantities>[0]["drawingTakeoffCandidates"],
        missingInfoItems: projectIssues as Parameters<typeof buildCrossDrawingQuantities>[0]["missingInfoItems"],
      });
      setCrossDrawingResult(result);
      setActiveSection("crossDrawing");
    } catch (err) {
      setCrossDrawingError(
        err instanceof Error
          ? `Cross-drawing build failed: ${err.message}`
          : "Cross-drawing build failed. Check evidence and try again."
      );
    } finally {
      setIsBuildingCrossDrawing(false);
    }
  }, [analysis, drawings, projectId, projectIssues]);

  // ── Save cross-drawing candidates → Drawing Takeoff (needs_verification) ────
  const handleCrossDrawingSaveNeedsVerification = useCallback(
    async (candidates: CrossDrawingQuantityCandidate[]) => {
      if (candidates.length === 0) return;
      const inputs: CreateDrawingTakeoffItemInput[] = candidates.map((c) => {
        // Build rich notes that preserve cross-drawing provenance
        const sourceNote = `Created from Cross-Drawing Quantity Builder.`;
        const drawingNote = `Sources: ${c.sourceDrawingNames.join(", ")}.`;
        const reasoningNote = c.reasoning.slice(0, 3).join(" ");
        const warningNote = c.warnings.length > 0
          ? `Warnings: ${c.warnings.slice(0, 2).join("; ")}.`
          : "";
        const missingNote = c.missingFields.length > 0
          ? `Missing: ${c.missingFields.join(", ")}.`
          : "";
        const conflictNote = candidateHasValueConflict(c)
          ? "Conflicting values detected — review before verifying."
          : "";
        const ocrNote = candidateIsOcrOnly(c)
          ? "OCR-only source — verify manually from drawing."
          : "";
        const notes = [sourceNote, drawingNote, reasoningNote, warningNote, missingNote, conflictNote, ocrNote]
          .filter(Boolean)
          .join(" ");

        // Do not calculate totals if required fields are missing
        const hasMissing = c.missingFields.length > 0;

        return {
          projectId,
          drawingId: c.sourceDrawingIds[0],
          sourceDrawingName: c.sourceDrawingNames[0] ?? "Cross-Drawing",
          itemCode: c.itemCode,
          description: c.description,
          category: c.category as DrawingItemCategory,
          count: c.count,
          width: c.width,
          height: c.height,
          thickness: c.thickness,
          depthOrProjection: c.depthOrProjection,
          areaEach: hasMissing ? undefined : c.areaEach,
          totalArea: hasMissing ? undefined : c.totalArea,
          length: c.length,
          material: c.material,
          glassType: c.glassType,
          frameType: c.frameType,
          unit: (c.unit as DrawingTakeoffUnit) ?? "sqm",
          sourceType: "drawing_annotation",
          confidence: c.confidence,
          warnings: [
            ...c.warnings,
            `Cross-drawing build: ${c.sourceDrawingNames.length} source drawing(s), ${c.occurrenceCount} occurrence(s).`,
          ],
          missingFields: c.missingFields,
          status: "needs_verification",
          notes: notes.slice(0, 500),
        };
      });
      await addTakeoffItems(inputs);
      setCrossDrawingActionFeedback({
        kind: "success",
        message: `Saved ${inputs.length} row(s) to Drawing Takeoff as needs verification.`,
      });
      setCrossDrawingResult((prev) => {
        if (!prev) return prev;
        const savedIds = new Set(candidates.map((c) => c.id));
        return {
          ...prev,
          candidates: prev.candidates.filter((c) => !savedIds.has(c.id)),
        };
      });
    },
    [addTakeoffItems, projectId]
  );

  const handleCrossDrawingMarkVerified = useCallback(
    async (candidates: CrossDrawingQuantityCandidate[]) => {
      // Strict server-side eligibility re-check — matches Phase 4D rules
      const eligible = candidates.filter((c) => candidateIsVerifiable(c));
      const blocked = candidates.length - eligible.length;
      if (eligible.length === 0) {
        setCrossDrawingActionFeedback({
          kind: "warning",
          message:
            blocked > 0
              ? `Mark Verified blocked: ${blocked} row(s) do not meet safety rules.`
              : "Mark Verified blocked: no rows selected.",
        });
        return;
      }

      const inputs: CreateDrawingTakeoffItemInput[] = eligible.map((c) => {
        const notes = [
          "Created from Cross-Drawing Quantity Builder.",
          `Sources: ${c.sourceDrawingNames.join(", ")}.`,
          c.reasoning.slice(0, 2).join(" "),
        ].filter(Boolean).join(" ");

        return {
          projectId,
          drawingId: c.sourceDrawingIds[0],
          sourceDrawingName: c.sourceDrawingNames[0] ?? "Cross-Drawing",
          itemCode: c.itemCode,
          description: c.description,
          category: c.category as DrawingItemCategory,
          count: c.count,
          width: c.width,
          height: c.height,
          thickness: c.thickness,
          depthOrProjection: c.depthOrProjection,
          areaEach: c.areaEach,
          totalArea: c.totalArea,
          length: c.length,
          material: c.material,
          glassType: c.glassType,
          frameType: c.frameType,
          unit: (c.unit as DrawingTakeoffUnit) ?? "sqm",
          sourceType: "drawing_annotation",
          confidence: "high",
          warnings: c.warnings,
          missingFields: [],
          status: "verified",
          notes: notes.slice(0, 500),
        };
      });
      await addTakeoffItems(inputs);
      setCrossDrawingActionFeedback({
        kind: blocked > 0 ? "warning" : "success",
        message:
          blocked > 0
            ? `Marked ${eligible.length} row(s) verified. ${blocked} row(s) blocked by safety rules.`
            : `Marked ${eligible.length} row(s) verified.`,
      });
      setCrossDrawingResult((prev) => {
        if (!prev) return prev;
        const savedIds = new Set(eligible.map((c) => c.id));
        return {
          ...prev,
          candidates: prev.candidates.filter((c) => !savedIds.has(c.id)),
        };
      });
    },
    [addTakeoffItems, projectId]
  );

  // ── Send incomplete cross-drawing candidates → Missing Info ───────────────
  // One issue per grouped candidate (not per field).
  const handleCrossDrawingSendToIssues = useCallback(
    async (candidates: CrossDrawingQuantityCandidate[]) => {
      const incomplete = candidates.filter((c) => c.missingFields.length > 0);
      if (incomplete.length === 0) {
        setCrossDrawingActionFeedback({
          kind: "warning",
          message: "No incomplete rows selected. Nothing sent to Missing Info.",
        });
        return;
      }

      // Deduplicate: one open issue per itemCode (any issueType)
      const existingItemCodes = new Set(
        projectIssues
          .filter((i) => i.status === "open")
          .map((i) => (i.manualItemCode ?? "").toUpperCase())
      );

      let skippedDuplicates = 0;
      const inputs: CreateDrawingIssueItemInput[] = incomplete
        .filter((c) => {
          const key = c.itemCode.toUpperCase();
          if (existingItemCodes.has(key)) {
            skippedDuplicates++;
            return false;
          }
          existingItemCodes.add(key); // dedupe within this batch too
          return true;
        })
        .map((c): CreateDrawingIssueItemInput => {
          // Pick the primary issueType from all missing fields
          const issueType = primaryIssueType(c.missingFields, c.category);

          // Consolidated evidence — source drawings + reasoning
          const sourceList = c.sourceDrawingNames.slice(0, 4).join(", ");
          const reasoningSnippet = c.reasoning.slice(0, 2).join(" ");
          const warningSnippet = c.warnings.slice(0, 1).join("");
          const detectedEvidence = [
            `Cross-Drawing Quantity Builder: ${c.occurrenceCount} occurrence(s) across ${c.sourceDrawingNames.length} drawing(s).`,
            `Sources: ${sourceList}.`,
            c.sourcePages.length > 0 ? `Pages: ${c.sourcePages.join(", ")}.` : "",
            reasoningSnippet,
            warningSnippet,
          ].filter(Boolean).join(" ");

          // Examples by field + category
          const recommendation = consolidatedRecommendation(c.missingFields, c.category);

          return {
            projectId,
            sourceDrawingId: c.sourceDrawingIds[0],
            sourceDrawingName: c.sourceDrawingNames[0] ?? "Unknown",
            sourcePage: c.sourcePages[0],
            issueType,
            possibleCategory: c.category as DrawingItemCategory,
            possibleDescription: `${c.itemCode} — ${c.description}`,
            detectedEvidence: detectedEvidence.slice(0, 500),
            missingFields: c.missingFields,
            suggestedUnit: (c.unit as DrawingTakeoffUnit) ?? undefined,
            confidence: c.confidence,
            reason: [
              `Cross-Drawing Quantity Builder: missing ${c.missingFields.join(", ")} for ${c.itemCode}.`,
              c.sourcePages.length > 0 ? `Source pages: ${c.sourcePages.join(", ")}.` : "",
              c.warnings.length > 0 ? `Warnings: ${c.warnings.slice(0, 2).join("; ")}.` : "",
            ].filter(Boolean).join(" ").slice(0, 300),
            recommendation: recommendation.slice(0, 300),
            status: "open",
            manualItemCode: c.itemCode,
          };
        });

      if (inputs.length > 0) {
        await addIssues(inputs);
      }
      setCrossDrawingActionFeedback({
        kind: skippedDuplicates > 0 ? "warning" : "success",
        message:
          skippedDuplicates > 0
            ? `Created ${inputs.length} Missing Info issue(s); skipped ${skippedDuplicates} duplicate open issue(s).`
            : `Created ${inputs.length} Missing Info issue(s).`,
      });

      // Remove sent candidates from result
      setCrossDrawingResult((prev) => {
        if (!prev) return prev;
        const sentIds = new Set(incomplete.map((c) => c.id));
        return {
          ...prev,
          candidates: prev.candidates.filter((c) => !sentIds.has(c.id)),
        };
      });
    },
    [addIssues, projectId, projectIssues]
  );

  const handleCrossDrawingReject = useCallback(
    (candidates: CrossDrawingQuantityCandidate[]) => {
      if (candidates.length === 0) {
        setCrossDrawingActionFeedback({
          kind: "warning",
          message: "No rows selected to reject.",
        });
        return;
      }
      const rejectedIds = new Set(candidates.map((c) => c.id));
      setCrossDrawingResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          candidates: prev.candidates.map((c) =>
            rejectedIds.has(c.id) ? { ...c, status: "rejected" } : c
          ),
        };
      });
      setCrossDrawingActionFeedback({
        kind: "success",
        message: `Rejected ${candidates.length} row(s).`,
      });
    },
    []
  );

  const getCrossDrawingCandidateById = useCallback(
    (candidateId: string): CrossDrawingQuantityCandidate | null => {
      return crossDrawingResult?.candidates.find((c) => c.id === candidateId) ?? null;
    },
    [crossDrawingResult]
  );

  const handleRunAiReview = useCallback(() => {
    if (analysis.status !== "done") {
      setAiReviewError(
        "Run Package Analysis first so AI Review has drawing evidence to review."
      );
      setAiReviewFeedback(null);
      return;
    }

    setIsRunningAiReview(true);
    setAiReviewError(null);
    setAiReviewFeedback(null);

    try {
      const hasType = (type: string) =>
        analysis.classifiedDrawings.some((c) => c.drawingType === type);

      const failedDrawingDiagnostics: FailedDrawingDiagnostic[] =
        analysis.classifiedDrawings
          .filter((c) => c.analysisStatus === "extraction_failed")
          .map((c) => {
            const drawing = drawings.find((d) => d.id === c.drawingId);
            return {
              drawingId: c.drawingId,
              drawingName: drawing?.fileName ?? c.drawingId,
              errorMessage:
                c.extractionNotes?.[0] ??
                "Drawing could not be loaded or parsed during package analysis.",
              suggestion:
                "Re-import or replace the failed drawing before relying on package quantities.",
            };
          });

      const missingInfoItems: AiReviewRunInput["missingInfoItems"] = [
        ...projectIssues
          .filter((issue) => issue.status === "open")
          .map((issue) => ({
            id: issue.id,
            manualItemCode: issue.manualItemCode,
            issueType: issue.issueType,
            status: issue.status,
          })),
        ...analysis.issueCandidates.map((issue, index) => ({
          id: `fresh-${index}`,
          manualItemCode: issue.manualItemCode,
          issueType: issue.issueType,
          status: issue.status,
        })),
      ];

      const ocrByDrawing = projectOcrResults.reduce<
        Record<string, { confidence?: number; hasText?: boolean }>
      >((acc, r) => {
        const current = acc[r.drawingId] ?? {};
        const prevConf =
          typeof current.confidence === "number" ? current.confidence : undefined;
        const confs = [prevConf, r.confidence].filter(
          (v): v is number => typeof v === "number"
        );
        const avgConf =
          confs.length > 0
            ? confs.reduce((sum, v) => sum + v, 0) / confs.length
            : undefined;
        acc[r.drawingId] = {
          confidence: avgConf,
          hasText: Boolean(current.hasText || r.extractedText.trim().length > 0),
        };
        return acc;
      }, {});

      const input: AiReviewRunInput = {
        projectId,
        packageAnalysisResult: {
          hasPlan: hasType("plan"),
          hasElevation: hasType("elevation"),
          hasSchedule: hasType("schedule"),
          hasSection: hasType("section") || hasType("detail"),
        },
        crossDrawingResult: crossDrawingResult ?? undefined,
        missingInfoItems,
        failedDrawingDiagnostics,
        ocrResults: ocrByDrawing,
      };

      const result = runMockAiDrawingReview(input);
      saveAiReviewResult(result);
      setAiReviewFeedback({
        kind: "success",
        message: `AI Review completed with ${result.findings.length} finding(s).`,
      });
      setActiveSection("aiReview");
    } catch (err) {
      setAiReviewError(
        err instanceof Error
          ? `AI Review failed: ${err.message}`
          : "AI Review failed unexpectedly."
      );
      setAiReviewFeedback({
        kind: "error",
        message: "AI Review could not be completed.",
      });
    } finally {
      setIsRunningAiReview(false);
    }
  }, [
    analysis,
    crossDrawingResult,
    drawings,
    projectId,
    projectIssues,
    projectOcrResults,
    saveAiReviewResult,
  ]);

  const handleAiViewCandidate = useCallback((candidateId: string) => {
    const candidate = getCrossDrawingCandidateById(candidateId);
    if (!candidate) {
      setAiReviewError(
        "Candidate is not available in current Cross-Drawing results. Rebuild Cross-Drawing Quantities and re-run AI Review."
      );
      return;
    }
    setAiReviewError(null);
    setActiveSection("crossDrawing");
    setCrossDrawingActionFeedback({
      kind: "warning",
      message: `AI finding linked to ${candidate.itemCode}. Review this candidate in Cross-Drawing Quantities.`,
    });
  }, [getCrossDrawingCandidateById]);

  const handleAiSendToMissingInfo = useCallback(
    async (candidateId: string) => {
      const candidate = getCrossDrawingCandidateById(candidateId);
      if (!candidate) {
        setAiReviewError(
          "Candidate not found in current Cross-Drawing result. Rebuild and re-run AI Review."
        );
        return;
      }
      await handleCrossDrawingSendToIssues([candidate]);
      setActiveSection("issues");
    },
    [getCrossDrawingCandidateById, handleCrossDrawingSendToIssues]
  );

  const handleAiMarkNeedsVerification = useCallback(
    async (candidateId: string) => {
      const candidate = getCrossDrawingCandidateById(candidateId);
      if (!candidate) {
        setAiReviewError(
          "Candidate not found in current Cross-Drawing result. Rebuild and re-run AI Review."
        );
        return;
      }
      await handleCrossDrawingSaveNeedsVerification([candidate]);
      setActiveSection("quantities");
    },
    [getCrossDrawingCandidateById, handleCrossDrawingSaveNeedsVerification]
  );

  const handleAiRejectCandidate = useCallback(
    (candidateId: string) => {
      const candidate = getCrossDrawingCandidateById(candidateId);
      if (!candidate) {
        setAiReviewError(
          "Candidate not found in current Cross-Drawing result. Rebuild and re-run AI Review."
        );
        return;
      }
      handleCrossDrawingReject([candidate]);
      setActiveSection("crossDrawing");
    },
    [getCrossDrawingCandidateById, handleCrossDrawingReject]
  );

  const handleLoadAiReviewQaScenario = useCallback(() => {
    if (process.env.NODE_ENV === "production") return;
    const qaCandidates = makeQaCrossDrawingCandidates(projectId);
    setAnalysis({
      status: "done",
      progress: "",
      classifiedDrawings: [
        {
          drawingId: "qa-dwg-plan",
          drawingName: "QA-PLAN-01.pdf",
          fileType: "pdf",
          drawingType: "plan",
          reasons: ["QA scenario seed"],
          confidence: "high",
          sheetTitle: "QA PLAN",
          analysisStatus: "text_extractable",
          needsOcr: false,
          ocrStatus: "not_needed",
          extractionNotes: [],
        },
        {
          drawingId: "qa-dwg-elev",
          drawingName: "QA-ELEV-01.pdf",
          fileType: "pdf",
          drawingType: "elevation",
          reasons: ["QA scenario seed"],
          confidence: "high",
          sheetTitle: "QA ELEVATION",
          analysisStatus: "text_extractable",
          needsOcr: false,
          ocrStatus: "not_needed",
          extractionNotes: [],
        },
        {
          drawingId: "qa-dwg-schedule",
          drawingName: "QA-SCHED-01.pdf",
          fileType: "pdf",
          drawingType: "schedule",
          reasons: ["QA scenario seed"],
          confidence: "high",
          sheetTitle: "QA SCHEDULE",
          analysisStatus: "text_extractable",
          needsOcr: false,
          ocrStatus: "not_needed",
          extractionNotes: [],
        },
        {
          drawingId: "qa-dwg-section",
          drawingName: "QA-SECTION-01.pdf",
          fileType: "pdf",
          drawingType: "section",
          reasons: ["QA scenario seed"],
          confidence: "medium",
          sheetTitle: "QA SECTION",
          analysisStatus: "text_extractable",
          needsOcr: false,
          ocrStatus: "not_needed",
          extractionNotes: [],
        },
      ],
      evidence: [],
      quantityCandidates: [],
      issueCandidates: [],
      warnings: [],
      errorMsg: null,
    });
    setCrossDrawingResult({
      projectId,
      candidates: qaCandidates,
      unresolvedIssueIds: [],
      warnings: [],
      stats: {
        totalEvidence: 8,
        groupedItems: qaCandidates.length,
        completeCandidates: 3,
        needsVerification: 4,
        missingInfoCreated: 0,
        highConfidence: 1,
        mediumConfidence: 3,
        lowConfidence: 2,
        conflictingValues: 1,
        genericCodes: 1,
        ocrSourcedCandidates: 1,
      },
    });
    setCrossDrawingError(null);
    setCrossDrawingActionFeedback({
      kind: "success",
      message:
        "QA candidate scenario loaded (dev-only). Run AI Review to generate candidate-linked findings.",
    });
    setAiReviewError(null);
    setAiReviewFeedback(null);
    setActiveSection("aiReview");
  }, [projectId]);

  const handleExportPdf = () => {
    exportDrawingTakeoffToPdf({
      project: project ?? {
        id: projectId,
        name: projectId,
        status: "active",
        createdAt: "",
        updatedAt: "",
      },
      takeoffItems: projectTakeoffItems,
      issues: projectIssues,
      classifiedDrawings: analysis.classifiedDrawings,
      companyName: companyProfile?.companyName,
    });
  };

  // ── Section tabs ──────────────────────────────────────────────────────────
  const evidenceCount    = analysis.evidence.flatMap((e) => e.candidates).length;
  const crossDrawingCount = crossDrawingResult?.candidates.length ?? 0;
  const aiReviewCount = projectAiReviewResult?.findings.length ?? 0;
  const failedPdfDrawings = useMemo(
    () =>
      analysis.classifiedDrawings
        .filter((c) => c.analysisStatus === "extraction_failed")
        .map((c) => drawings.find((d) => d.id === c.drawingId))
        .filter((d): d is DrawingFile => !!d && d.fileType === "pdf"),
    [analysis.classifiedDrawings, drawings]
  );
  const sections = [
    { key: "summary",      label: "Package Summary",          count: drawings.length },
    { key: "evidence",     label: "Evidence",                 count: evidenceCount },
    { key: "quantities",   label: "Qty Candidates",           count: analysis.quantityCandidates.length },
    { key: "crossDrawing", label: "Cross-Drawing Quantities", count: crossDrawingCount },
    { key: "aiReview",     label: "AI Review",                count: aiReviewCount },
    { key: "issues",       label: "Missing Info",             count: analysis.issueCandidates.length + projectIssues.filter((i) => i.status === "open").length },
  ] as const;

  const criticalWarnings = analysis.warnings.filter(
    (w) => w.includes("scanned") || w.includes("error") || w.includes("could not")
  );

  const scannedForOcrCount = useMemo(() => {
    return drawings.filter((d) => {
      if (d.fileType !== "pdf") return false;
      const cls = analysis.classifiedDrawings.find((c) => c.drawingId === d.id);
      const status = resolveDrawingOcrStatus(d, projectOcrResults, cls?.ocrStatus);
      return status === "needed" || status === "failed";
    }).length;
  }, [drawings, projectOcrResults, analysis.classifiedDrawings]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            Drawing Package Review
            <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-700">
              Phase 3
            </Badge>
          </h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            Analyse all drawings — classify types, extract evidence, run OCR on scanned PDFs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={showZipUpload ? "default" : "outline"}
            onClick={() => setShowZipUpload((v) => !v)}
          >
            <Archive className="h-4 w-4" />
            {showZipUpload ? "Hide ZIP Upload" : "Upload ZIP Package"}
          </Button>
          {scannedForOcrCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunOcrForAllScanned}
              disabled={ocrRunningId !== null || analysis.status === "running"}
            >
              {ocrRunningId ? (
                <><Loader2 className="h-4 w-4 animate-spin" />OCR Running…</>
              ) : (
                <><ScanLine className="h-4 w-4" />Run OCR for Scanned PDFs ({scannedForOcrCount})</>
              )}
            </Button>
          )}
          {analysis.status === "done" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBuildCrossDrawing}
                disabled={isBuildingCrossDrawing || analysis.status !== "done"}
                title="Group evidence from all drawings into unified quantity candidates"
              >
                {isBuildingCrossDrawing ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Building…</>
                ) : (
                  <><GitMerge className="h-4 w-4" />Build Cross-Drawing Quantities</>
                )}
              </Button>
              <Button size="sm" variant="outline" onClick={handleExportPdf}>
                <Printer className="h-4 w-4" />
                Export PDF Report
              </Button>
            </>
          )}
          <Button
            size="sm"
            onClick={handleRunAnalysis}
            disabled={drawings.length === 0 || analysis.status === "running"}
          >
            {analysis.status === "running" ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Analysing…</>
            ) : (
              <><ScanSearch className="h-4 w-4" />Run Package Analysis</>
            )}
          </Button>
        </div>
      </div>

      {/* OCR progress */}
      {ocrRunningId && ocrProgress && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2.5 text-xs text-blue-800">
          <Loader2 className="inline h-3.5 w-3.5 animate-spin mr-1" />
          {ocrProgress}
        </div>
      )}

      {/* OCR batch result banner */}
      {ocrBatchSummary && !ocrRunningId && (
        <div
          className={cn(
            "rounded-md border px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2",
            ocrBatchSummary.failed === 0
              ? "bg-green-50 border-green-200 text-green-800"
              : ocrBatchSummary.completed === 0
                ? "bg-red-50 border-red-200 text-red-800"
                : "bg-amber-50 border-amber-200 text-amber-800"
          )}
        >
          <span>
            {ocrBatchSummary.failed === 0 && (
              <>
                <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
                OCR complete. Re-run Package Analysis to extract evidence from OCR text.
              </>
            )}
            {ocrBatchSummary.completed === 0 && ocrBatchSummary.failed > 0 && (
              <>
                <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                OCR failed for all scanned drawings. Open failed rows for details.
              </>
            )}
            {ocrBatchSummary.completed > 0 && ocrBatchSummary.failed > 0 && (
              <>
                <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                OCR finished: {ocrBatchSummary.completed} completed, {ocrBatchSummary.failed} failed.
              </>
            )}
          </span>
          {ocrBatchSummary.completed > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleRunAnalysis}>
              <ScanSearch className="h-3 w-3 mr-1" />Re-analyze Package
            </Button>
          )}
        </div>
      )}

      {/* OCR accuracy warning */}
      {(scannedForOcrCount > 0 || projectOcrResults.some((r) => r.status === "completed")) && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-800">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
          OCR may be imperfect. Verify all quantities manually before accepting into takeoff.
        </div>
      )}

      {/* Running progress */}
      {analysis.status === "running" && analysis.progress && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-2.5 text-xs text-blue-800">
          <Loader2 className="inline h-3.5 w-3.5 animate-spin mr-1" />
          {analysis.progress}
        </div>
      )}

      {/* Error */}
      {analysis.status === "error" && analysis.errorMsg && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="inline h-4 w-4 mr-1" />
          {analysis.errorMsg}
        </div>
      )}

      {/* Critical warnings only (scanned PDFs, extraction failures) */}
      {criticalWarnings.length > 0 && (
        <div className="rounded-md bg-orange-50 border border-orange-200 px-4 py-2.5 space-y-1">
          {criticalWarnings.map((w, i) => (
            <p key={i} className="text-xs text-orange-800">
              <AlertTriangle className="inline h-3 w-3 mr-1" />
              {w}
            </p>
          ))}
        </div>
      )}

      {/* ZIP Package Upload Panel (collapsible) */}
      {showZipUpload && (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-800">Upload Full Client Package</span>
              <span className="text-xs text-slate-500">— extract, classify, and import from ZIP</span>
            </div>
            {zipImportedCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {zipImportedCount} imported this session
              </span>
            )}
          </div>
          <ZipPackageUploadPanel
            projectId={projectId}
            onImported={(count) => setZipImportedCount((prev) => prev + count)}
          />
        </div>
      )}

      {/* Package metrics summary cards (post-analysis only) */}
      <PackageMetricsCards
        analysis={analysis}
        projectIssues={projectIssues}
        drawings={drawings}
        ocrResults={projectOcrResults}
      />

      {/* Section navigation */}
      <div className="flex gap-1 border-b border-slate-200">
        {sections.map((sec) => (
          <button
            key={sec.key}
            type="button"
            onClick={() => setActiveSection(sec.key as typeof activeSection)}
            className={cn(
              "px-3 py-2 text-xs font-medium border-b-2 transition-colors",
              activeSection === sec.key
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-600 hover:text-slate-800"
            )}
          >
            {sec.label}
            {sec.count > 0 && (
              <span className="ml-1.5 rounded-full bg-slate-100 text-slate-700 px-1.5 py-0.5 text-[10px]">
                {sec.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Section: Summary ─────────────────────────────────────────────── */}
      {activeSection === "summary" && (
        <div className="space-y-3">
          <PackageSummary
            drawings={drawings}
            classifiedDrawings={analysis.classifiedDrawings}
            analysed={analysis.status === "done"}
            evidence={analysis.evidence}
            ocrResults={projectOcrResults}
            ocrRunningId={ocrRunningId}
            onRunOcr={handleRunOcr}
            duplicateIdentities={duplicateIdentities}
          />
          {analysis.status === "idle" && (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-6 text-center">
              <FileSearch className="mx-auto h-7 w-7 text-slate-400 mb-2" />
              <p className="text-sm font-medium text-slate-600">Ready to analyse</p>
              <p className="text-xs text-slate-500 mt-1">
                Click <strong>Run Package Analysis</strong> to extract evidence from all drawings.
              </p>
              <p className="text-[10px] text-slate-400 mt-2">
                Scanned / image PDFs will be flagged with an OCR badge.
                DXF files are listed but need the DXF Layer Mapping tab.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Section: Evidence ────────────────────────────────────────────── */}
      {activeSection === "evidence" && (
        <EvidenceSection evidence={analysis.evidence} />
      )}

      {/* ── Section: Qty Candidates ─────────────────────────────────────── */}
      {activeSection === "quantities" && (
        <div className="space-y-3">
          {analysis.quantityCandidates.length === 0 ? (
            <p className="text-sm text-slate-500 italic px-1">
              No quantity candidates yet. Run Package Analysis to extract items.
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-600">
                Review extracted evidence below. Only complete high-confidence rows can be saved as verified.
                Incomplete or low-confidence rows should be sent to Missing Info or saved as needs verification.
                {acceptBusy && <Loader2 className="inline h-3.5 w-3.5 animate-spin ml-2" />}
              </p>
              <DrawingTakeoffReviewTable
                candidates={analysis.quantityCandidates}
                onSaveVerified={handleSaveVerifiedCandidates}
                onSaveNeedsVerification={handleSaveNeedsVerificationCandidates}
                onSendToIssues={handleSendCandidatesToIssues}
                onDiscard={() =>
                  setAnalysis((prev) => ({ ...prev, quantityCandidates: [] }))
                }
              />
            </>
          )}
        </div>
      )}

      {/* ── Section: Cross-Drawing Quantities ───────────────────────────── */}
      {activeSection === "crossDrawing" && (
        <div className="space-y-3">
          {crossDrawingActionFeedback && (
            <div
              className={cn(
                "rounded-md border px-4 py-2.5 text-xs",
                crossDrawingActionFeedback.kind === "success" &&
                  "border-green-200 bg-green-50 text-green-800",
                crossDrawingActionFeedback.kind === "warning" &&
                  "border-amber-200 bg-amber-50 text-amber-800",
                crossDrawingActionFeedback.kind === "error" &&
                  "border-red-200 bg-red-50 text-red-800"
              )}
            >
              <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
              {crossDrawingActionFeedback.message}
            </div>
          )}

          {crossDrawingError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
              <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
              {crossDrawingError}
            </div>
          )}

          {crossDrawingResult &&
            crossDrawingResult.candidates.length === 0 &&
            failedPdfDrawings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 space-y-1">
                <p className="font-medium">
                  <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                  No grouped candidates produced because usable evidence is missing from failed drawings.
                </p>
                <p className="text-[11px]">
                  Failed PDFs: {failedPdfDrawings.map((d) => d.fileName).join(", ")}.
                </p>
                <p className="text-[11px]">
                  Re-import or replace these drawings, then rerun Package Analysis and rebuild Cross-Drawing Quantities.
                </p>
              </div>
            )}

          {!crossDrawingResult && isBuildingCrossDrawing && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-6 py-8 text-center space-y-2">
              <Loader2 className="mx-auto h-6 w-6 text-blue-600 animate-spin" />
              <p className="text-sm font-medium text-blue-800">Building Cross-Drawing Quantities...</p>
              <p className="text-xs text-blue-700">Combining evidence across drawings. This may take a moment.</p>
            </div>
          )}

          {!crossDrawingResult && !crossDrawingError && !isBuildingCrossDrawing && (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center space-y-2">
              <GitMerge className="mx-auto h-7 w-7 text-slate-400" />
              <p className="text-sm font-medium text-slate-600">No cross-drawing build yet</p>
              <p className="text-xs text-slate-500">
                Run Package Analysis first, then click{" "}
                <strong>Build Cross-Drawing Quantities</strong>.
              </p>
            </div>
          )}

          {crossDrawingResult && (
            <CrossDrawingQuantityTable
              result={crossDrawingResult}
              busy={isBuildingCrossDrawing}
              onSaveNeedsVerification={handleCrossDrawingSaveNeedsVerification}
              onMarkVerified={handleCrossDrawingMarkVerified}
              onSendToIssues={handleCrossDrawingSendToIssues}
              onReject={handleCrossDrawingReject}
            />
          )}
        </div>
      )}

      {/* ── Section: AI Review ────────────────────────────────────────────── */}
      {activeSection === "aiReview" && (
        <AiReviewSection
          analysisStatus={analysis.status}
          hasCrossDrawingResult={Boolean(crossDrawingResult)}
          result={projectAiReviewResult}
          runBusy={isRunningAiReview}
          runError={aiReviewError}
          runSuccess={aiReviewFeedback?.kind === "success" ? aiReviewFeedback.message : null}
          onRunReview={handleRunAiReview}
          onViewCandidate={handleAiViewCandidate}
          onSendToMissingInfo={handleAiSendToMissingInfo}
          onMarkNeedsVerification={handleAiMarkNeedsVerification}
          onRejectCandidate={handleAiRejectCandidate}
          onLoadQaScenario={handleLoadAiReviewQaScenario}
          showQaScenarioButton={process.env.NODE_ENV !== "production"}
        />
      )}

      {/* ── Section: Missing Info ────────────────────────────────────────── */}
      {activeSection === "issues" && (
        <MissingInfoSection
          projectId={projectId}
          savedIssues={projectIssues}
          freshCandidates={analysis.issueCandidates}
          onSaveIssues={handleSaveIssues}
          onConvert={handleConvertIssue}
          onIgnore={handleIgnoreIssue}
        />
      )}

      {/* Project item status footer */}
      {projectTakeoffItems.length > 0 && (
        <div className="flex flex-wrap gap-4 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-4 py-2">
          <span><strong>{projectTakeoffItems.length}</strong> items in Drawing Takeoff</span>
          <span>
            Verified/Final:{" "}
            <strong>{projectTakeoffItems.filter((i) => i.status === "verified" || i.status === "final").length}</strong>
          </span>
          <span>
            Needs review:{" "}
            <strong>{projectTakeoffItems.filter((i) => !i.status || i.status === "draft" || i.status === "needs_verification").length}</strong>
          </span>
          <span>
            Open issues: <strong>{projectIssues.filter((i) => i.status === "open").length}</strong>
          </span>
        </div>
      )}
    </div>
  );
}
