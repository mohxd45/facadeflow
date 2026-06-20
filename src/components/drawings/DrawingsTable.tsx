"use client";

import { useState } from "react";
import type { DrawingFile } from "@/types/drawing";
import {
  DRAWING_CATEGORY_LABELS,
  DRAWING_VIEW_TYPE_LABELS,
} from "@/lib/constants";
import { formatFileSize } from "@/lib/file-size";
import { formatDateTime } from "@/lib/utils";
import { useDrawingStore } from "@/stores/drawing-store";
import { usePdfAnalysis } from "@/hooks/usePdfAnalysis";
import { useDxfAnalysis } from "@/hooks/useDxfAnalysis";
import { useDxfTakeoff } from "@/hooks/useDxfTakeoff";
import { useDxfVisualReview } from "@/hooks/useDxfVisualReview";
import DrawingStatusBadge from "./DrawingStatusBadge";
import DrawingPreviewDialog from "./DrawingPreviewDialog";
import SuggestionReviewModal from "@/components/analysis/SuggestionReviewModal";
import DxfInspectModal from "@/components/analysis/DxfInspectModal";
import DxfVisualReviewModal from "@/components/analysis/DxfVisualReviewModal";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Eye, ClipboardList, Trash2, ScanText, Loader2, Microscope, Calculator, Map, Download } from "lucide-react";
import { openDrawingExternally } from "@/services/dxf/viewer-adapter";

interface DrawingsTableProps {
  drawings: DrawingFile[];
  projectId: string;
  onSendToTakeoff: (drawing: DrawingFile) => void;
  /** Called when "Create mappings from layers" is used in DxfInspectModal */
  onMappingsCreated?: (count: number) => void;
}

function resolveViewType(drawing: DrawingFile) {
  return drawing.drawingViewType ?? "plan";
}

export default function DrawingsTable({
  drawings,
  projectId,
  onSendToTakeoff,
  onMappingsCreated,
}: DrawingsTableProps) {
  const deleteDrawing = useDrawingStore((s) => s.deleteDrawing);
  const [previewDrawing, setPreviewDrawing] = useState<DrawingFile | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [acceptedToast, setAcceptedToast] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { state: analysisState, activeDrawing, analyse, reset } = usePdfAnalysis(projectId);
  const {
    state: dxfState,
    activeDrawing: dxfActiveDrawing,
    analyse: analyseDxf,
    reset: resetDxf,
  } = useDxfAnalysis();

  const {
    state: dxfTakeoffState,
    activeDrawing: dxfTakeoffDrawing,
    generate: generateDxfTakeoff,
    reset: resetDxfTakeoff,
  } = useDxfTakeoff(projectId);

  const {
    state: dxfVisualState,
    activeDrawing: dxfVisualDrawing,
    initialHighlightLayers: dxfVisualHighlightLayers,
    review: reviewDxfVisual,
    reset: resetDxfVisual,
  } = useDxfVisualReview();

  const isAnalysing = (id: string) =>
    (analysisState.status === "extracting" || analysisState.status === "analysing") &&
    activeDrawing?.id === id;

  const isDxfAnalysing = (id: string) =>
    dxfState.status === "loading" && dxfActiveDrawing?.id === id;

  const isDxfTakeoffRunning = (id: string) =>
    (dxfTakeoffState.status === "parsing" || dxfTakeoffState.status === "generating") &&
    dxfTakeoffDrawing?.id === id;

  const isDxfVisualLoading = (id: string) =>
    dxfVisualState.status === "loading" && dxfVisualDrawing?.id === id;

  const handleViewSourceLayer = (layerName: string) => {
    if (dxfTakeoffDrawing) {
      reviewDxfVisual(dxfTakeoffDrawing, [layerName]);
    }
  };

  const handleDxfTakeoffAccepted = (count: number) => {
    const msg = `${count} DXF item${count !== 1 ? "s" : ""} added to takeoff.`;
    setAcceptedToast(msg);
    setTimeout(() => setAcceptedToast(null), 4000);
    resetDxfTakeoff();
  };

  const handleDelete = async (drawing: DrawingFile) => {
    if (!window.confirm(`Delete "${drawing.fileName}"? This cannot be undone.`)) return;
    setDeletingId(drawing.id);
    try {
      await deleteDrawing(drawing.id);
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenOriginalFile = async (drawing: DrawingFile) => {
    setDownloadingId(drawing.id);
    setDownloadError(null);
    try {
      await openDrawingExternally(drawing);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not retrieve file.";
      setDownloadError(msg);
      setTimeout(() => setDownloadError(null), 6000);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleAccepted = (count: number) => {
    const msg = `${count} item${count !== 1 ? "s" : ""} added to takeoff.`;
    setAcceptedToast(msg);
    setTimeout(() => setAcceptedToast(null), 4000);
    reset();
  };

  if (drawings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] py-16 text-center">
        <p className="text-sm font-medium">No drawings uploaded</p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Upload PDF, DXF, or DWG files to begin quantity takeoff.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Success toast */}
      {acceptedToast && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-800">
          <span>✓</span>
          {acceptedToast}
        </div>
      )}

      {/* Analysis error banner */}
      {analysisState.status === "error" && activeDrawing && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>
            <strong>Analysis failed</strong> for {activeDrawing.fileName}:{" "}
            {analysisState.message}
          </p>
          <button
            type="button"
            className="shrink-0 font-medium underline"
            onClick={reset}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File name</TableHead>
              <TableHead>View type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>File size</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drawings.map((drawing) => {
              const busy = isAnalysing(drawing.id);
              const isPdf = drawing.fileType === "pdf";
              const isDxf = drawing.fileType === "dxf";
              const canAnalyse = isPdf && drawing.fileSize <= 250 * 1024 * 1024;
              const canDxfAnalyse = isDxf && drawing.fileSize <= 100 * 1024 * 1024;
              const dxfBusy = isDxfAnalysing(drawing.id);
              const dxfTakeoffBusy = isDxfTakeoffRunning(drawing.id);
              const dxfVisualBusy = isDxfVisualLoading(drawing.id);

              return (
                <TableRow key={drawing.id}>
                  <TableCell className="font-medium">{drawing.fileName}</TableCell>
                  <TableCell>
                    {DRAWING_VIEW_TYPE_LABELS[resolveViewType(drawing)]}
                  </TableCell>
                  <TableCell>
                    {DRAWING_CATEGORY_LABELS[drawing.category]}
                  </TableCell>
                  <TableCell>{formatFileSize(drawing.fileSize)}</TableCell>
                  <TableCell>
                    <DrawingStatusBadge status={drawing.status} />
                  </TableCell>
                  <TableCell className="text-[var(--muted)]">
                    {formatDateTime(drawing.uploadedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Preview"
                        onClick={() => setPreviewDrawing(drawing)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>

                      {/* Analyze PDF — PDF files ≤ 250 MB */}
                      {isPdf && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={
                            canAnalyse
                              ? "Analyze PDF for takeoff suggestions"
                              : "File too large to analyse in browser (> 250 MB)"
                          }
                          disabled={busy || !canAnalyse}
                          onClick={() => analyse(drawing)}
                        >
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                          ) : (
                            <ScanText
                              className={`h-4 w-4 ${
                                canAnalyse ? "text-blue-600" : "text-slate-300"
                              }`}
                            />
                          )}
                        </Button>
                      )}

                      {/* Inspect DXF — DXF files ≤ 100 MB */}
                      {isDxf && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={
                            canDxfAnalyse
                              ? "Inspect DXF structure (layers, entities, blocks)"
                              : "DXF over 100 MB requires backend processing"
                          }
                          disabled={dxfBusy || !canDxfAnalyse}
                          onClick={() => analyseDxf(drawing)}
                        >
                          {dxfBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                          ) : (
                            <Microscope
                              className={`h-4 w-4 ${
                                canDxfAnalyse ? "text-emerald-600" : "text-slate-300"
                              }`}
                            />
                          )}
                        </Button>
                      )}

                      {/* Generate Takeoff from DXF — DXF files ≤ 100 MB */}
                      {isDxf && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={
                            canDxfAnalyse
                              ? "Generate quantity takeoff suggestions from DXF geometry"
                              : "DXF over 100 MB requires backend processing"
                          }
                          disabled={dxfTakeoffBusy || !canDxfAnalyse}
                          onClick={() => generateDxfTakeoff(drawing)}
                        >
                          {dxfTakeoffBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                          ) : (
                            <Calculator
                              className={`h-4 w-4 ${
                                canDxfAnalyse ? "text-violet-600" : "text-slate-300"
                              }`}
                            />
                          )}
                        </Button>
                      )}

                      {/* Visual Review — DXF files ≤ 100 MB */}
                      {isDxf && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={
                            canDxfAnalyse
                              ? "Visual review — explore layers and geometry"
                              : "DXF over 100 MB requires backend processing"
                          }
                          disabled={dxfVisualBusy || !canDxfAnalyse}
                          onClick={() => reviewDxfVisual(drawing)}
                        >
                          {dxfVisualBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                          ) : (
                            <Map
                              className={`h-4 w-4 ${
                                canDxfAnalyse ? "text-amber-600" : "text-slate-300"
                              }`}
                            />
                          )}
                        </Button>
                      )}

                      {/* Open original file — DXF only */}
                      {isDxf && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Download original DXF to open in AutoCAD, DWG TrueView, LibreCAD, etc."
                          disabled={downloadingId === drawing.id}
                          onClick={() => handleOpenOriginalFile(drawing)}
                        >
                          {downloadingId === drawing.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                          ) : (
                            <Download className="h-4 w-4 text-slate-500" />
                          )}
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="icon"
                        title="Send to takeoff"
                        onClick={() => onSendToTakeoff(drawing)}
                      >
                        <ClipboardList className="h-4 w-4" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        disabled={deletingId === drawing.id}
                        onClick={() => handleDelete(drawing)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Download error toast */}
      {downloadError && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <span><strong>Download failed:</strong> {downloadError}</span>
          <button type="button" className="shrink-0 font-medium underline" onClick={() => setDownloadError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Drawing preview */}
      <DrawingPreviewDialog
        drawing={previewDrawing}
        open={previewDrawing !== null}
        onOpenChange={(open) => !open && setPreviewDrawing(null)}
      />

      {/* PDF analysis status banner */}
      {(analysisState.status === "extracting" ||
        analysisState.status === "analysing") && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          {analysisState.status === "extracting"
            ? `Extracting text from ${activeDrawing?.fileName}…`
            : "Running rule-based analysis…"}
        </div>
      )}

      {/* DXF analysis status banner */}
      {dxfState.status === "loading" && dxfActiveDrawing && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          Parsing DXF structure from {dxfActiveDrawing.fileName}…
        </div>
      )}

      {/* Suggestion review modal (PDF) */}
      {analysisState.status === "done" && activeDrawing && (
        <SuggestionReviewModal
          open
          onOpenChange={(open) => { if (!open) reset(); }}
          suggestions={analysisState.suggestions}
          drawing={activeDrawing}
          projectId={projectId}
          onAccepted={handleAccepted}
        />
      )}

      {/* DXF error banner */}
      {dxfState.status === "error" && dxfActiveDrawing && (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>
            <strong>DXF inspection failed</strong> for{" "}
            {dxfActiveDrawing.fileName}: {dxfState.message}
          </p>
          <button
            type="button"
            className="shrink-0 font-medium underline"
            onClick={resetDxf}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* DXF inspect modal */}
      {dxfState.status === "done" && dxfState.result && dxfActiveDrawing && (
        <DxfInspectModal
          open
          onOpenChange={(open) => { if (!open) resetDxf(); }}
          result={dxfState.result}
          drawing={dxfActiveDrawing}
          projectId={projectId}
          onGenerateTakeoff={() => {
            resetDxf();
            generateDxfTakeoff(dxfActiveDrawing);
          }}
          onMappingsCreated={onMappingsCreated}
        />
      )}

      {/* DXF takeoff status banners */}
      {(dxfTakeoffState.status === "parsing" || dxfTakeoffState.status === "generating") &&
        dxfTakeoffDrawing && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800">
            <Loader2 className="h-4 w-4 animate-spin" />
            {dxfTakeoffState.status === "parsing"
              ? `Parsing DXF geometry from ${dxfTakeoffDrawing.fileName}…`
              : "Generating quantity suggestions from CAD layers…"}
          </div>
        )}

      {dxfTakeoffState.status === "error" && dxfTakeoffDrawing && (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>
            <strong>DXF takeoff failed</strong> for {dxfTakeoffDrawing.fileName}:{" "}
            {dxfTakeoffState.message}
          </p>
          <button
            type="button"
            className="shrink-0 font-medium underline"
            onClick={resetDxfTakeoff}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* DXF takeoff suggestion review modal */}
      {dxfTakeoffState.status === "done" && dxfTakeoffDrawing && (
        <SuggestionReviewModal
          open
          onOpenChange={(open) => { if (!open) resetDxfTakeoff(); }}
          suggestions={dxfTakeoffState.suggestions}
          drawing={dxfTakeoffDrawing}
          projectId={projectId}
          onAccepted={handleDxfTakeoffAccepted}
          onViewSourceLayer={handleViewSourceLayer}
        />
      )}

      {/* DXF visual review — loading banner */}
      {dxfVisualState.status === "loading" && dxfVisualDrawing && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading DXF geometry for visual review of {dxfVisualDrawing.fileName}…
        </div>
      )}

      {/* DXF visual review — error banner */}
      {dxfVisualState.status === "error" && dxfVisualDrawing && (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>
            <strong>Visual review failed</strong> for {dxfVisualDrawing.fileName}:{" "}
            {dxfVisualState.message}
          </p>
          <button
            type="button"
            className="shrink-0 font-medium underline"
            onClick={resetDxfVisual}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* DXF visual review modal */}
      {dxfVisualState.status === "done" && dxfVisualState.result && dxfVisualDrawing && (
        <DxfVisualReviewModal
          open
          onOpenChange={(open) => { if (!open) resetDxfVisual(); }}
          parsed={dxfVisualState.result}
          drawing={dxfVisualDrawing}
          projectId={projectId}
          initialHighlightedLayers={dxfVisualHighlightLayers}
        />
      )}
    </>
  );
}
