"use client";

/**
 * ZIP Package Upload Panel — Phase 2
 *
 * Workflow:
 *   1. User drops or picks a .zip file
 *   2. System scans contents and classifies each file (no blobs yet)
 *   3. Summary cards show what was found
 *   4. File table shows every file with role, status, confidence
 *   5. User selects files (PDF/DXF default checked; DWG/ignored unchecked)
 *   6. "Import Selected" extracts blobs + saves to project drawing store
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { ExtractedPackageFile, PackageUploadSummary } from "@/types/package-upload";
import {
  PACKAGE_FILE_KIND_LABELS,
  PACKAGE_FILE_ROLE_LABELS,
  PACKAGE_FILE_STATUS_LABELS,
} from "@/types/package-upload";
import {
  scanZipContents,
  loadSelectedFiles,
  roleToDrawingMeta,
  buildPackageUploadSummary,
} from "@/services/package-upload/zip-package.service";
import { applyDuplicateDetectionToPackageFiles } from "@/services/drawing-package/drawing-identity.service";
import { drawingUploadService } from "@/services/file/upload.service";
import { useDrawingStore } from "@/stores/drawing-store";
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
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  FolderOpen,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ZipPackageUploadPanelProps {
  projectId: string;
  onImported?: (count: number) => void;
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  ready_to_import:  "bg-green-100 text-green-800",
  ignored:          "bg-slate-100 text-slate-500",
  unsupported:      "bg-slate-100 text-slate-500",
  duplicate:        "bg-amber-100 text-amber-700",
  needs_conversion: "bg-orange-100 text-orange-800",
  too_large:        "bg-red-100 text-red-800",
  error:            "bg-red-100 text-red-800",
};

const KIND_COLORS: Record<string, string> = {
  pdf:         "bg-blue-100 text-blue-800",
  dxf:         "bg-indigo-100 text-indigo-800",
  dwg:         "bg-orange-100 text-orange-800",
  dwf:         "bg-orange-100 text-orange-700",
  excel:       "bg-green-100 text-green-700",
  image:       "bg-slate-100 text-slate-600",
  backup:      "bg-slate-100 text-slate-500",
  document:    "bg-slate-100 text-slate-600",
  unsupported: "bg-slate-100 text-slate-400",
};

const CONF_COLORS: Record<"high" | "medium" | "low", string> = {
  high:   "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  low:    "bg-slate-100 text-slate-600",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Summary cards component
// ---------------------------------------------------------------------------

function SummaryCards({ summary }: { summary: PackageUploadSummary }) {
  const cards = [
    { label: "Total files",       value: summary.totalFiles,        color: "bg-slate-100 text-slate-800" },
    { label: "PDFs",              value: summary.pdfCount,          color: summary.pdfCount > 0 ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-500" },
    { label: "DWG / CAD",         value: summary.dwgCount,          color: summary.dwgCount > 0 ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-500" },
    { label: "DXF",               value: summary.dxfCount,          color: summary.dxfCount > 0 ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-500" },
    { label: "Excel / Schedule",  value: summary.excelCount,        color: summary.excelCount > 0 ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500" },
    { label: "Ready to import",   value: summary.readyToImportCount, color: summary.readyToImportCount > 0 ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500" },
    { label: "Duplicates",        value: summary.duplicateCount,     color: summary.duplicateCount > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500" },
    { label: "Needs conversion",  value: summary.needsConversionCount, color: summary.needsConversionCount > 0 ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-500" },
    { label: "Ignored / Other",   value: summary.ignoredCount,      color: "bg-slate-100 text-slate-500" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {cards.map((c) => (
        <div key={c.label} className={cn("flex flex-col items-center rounded-lg px-3 py-2 min-w-[72px]", c.color)}>
          <span className="text-xl font-bold leading-none">{c.value}</span>
          <span className="mt-0.5 text-[10px] font-medium text-center leading-tight">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type PanelState = "idle" | "scanning" | "ready" | "importing" | "done" | "error";
type DuplicateImportMode = "skip" | "replace" | "import_anyway";

export default function ZipPackageUploadPanel({
  projectId,
  onImported,
}: ZipPackageUploadPanelProps) {
  const addDrawing = useDrawingStore((s) => s.addDrawing);
  const deleteDrawing = useDrawingStore((s) => s.deleteDrawing);
  const allDrawings = useDrawingStore((s) => s.drawings);
  const projectDrawings = useMemo(
    () => allDrawings.filter((d) => d.projectId === projectId),
    [allDrawings, projectId]
  );

  const [state, setState] = useState<PanelState>("idle");
  const [progress, setProgress] = useState("");
  const [files, setFiles] = useState<ExtractedPackageFile[]>([]);
  const [summary, setSummary] = useState<PackageUploadSummary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [duplicateMode, setDuplicateMode] = useState<DuplicateImportMode>("skip");

  const zipFileRef = useRef<File | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // ── Scan ZIP ──────────────────────────────────────────────────────────────
  const handleZipFile = useCallback(async (zipFile: File) => {
    if (!zipFile.name.toLowerCase().endsWith(".zip")) {
      setState("error");
      setProgress("Please select a .zip file.");
      return;
    }

    zipFileRef.current = zipFile;
    setState("scanning");
    setProgress(`Reading ${zipFile.name} (${(zipFile.size / 1024 / 1024).toFixed(1)} MB)…`);
    setImportErrors([]);
    setImportedCount(0);

    try {
      const { files: extracted } = await scanZipContents(zipFile);
      const withDuplicates = applyDuplicateDetectionToPackageFiles(
        extracted,
        projectDrawings
      );
      const sum = buildPackageUploadSummary(withDuplicates);

      // Auto-select importable files; duplicates unchecked by default
      const autoSelected = new Set(
        withDuplicates
          .filter(
            (f) =>
              f.status === "ready_to_import" &&
              (f.kind === "pdf" || f.kind === "dxf")
          )
          .map((f) => f.id)
      );

      setFiles(withDuplicates);
      setSummary(sum);
      setSelected(autoSelected);
      setDuplicateMode("skip");
      setState("ready");
      setProgress("");
    } catch (err) {
      setState("error");
      setProgress(err instanceof Error ? err.message : "Failed to read ZIP file.");
    }
  }, [projectDrawings]);

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) handleZipFile(f);
    },
    [handleZipFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleZipFile(f);
      e.target.value = "";
    },
    [handleZipFile]
  );

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllPdfs = () => {
    const ids = files
      .filter(
        (f) =>
          f.kind === "pdf" &&
          (f.status === "ready_to_import" ||
            (f.status === "duplicate" && duplicateMode !== "skip"))
      )
      .map((f) => f.id);
    setSelected((prev) => { const s = new Set(prev); ids.forEach((id) => s.add(id)); return s; });
  };

  const selectPlansElevationsSections = () => {
    const roles = new Set(["floor_plan", "roof_plan", "elevation", "section", "wall_section"]);
    const ids = files
      .filter(
        (f) =>
          roles.has(f.role) &&
          (f.status === "ready_to_import" ||
            (f.status === "duplicate" && duplicateMode !== "skip"))
      )
      .map((f) => f.id);
    setSelected((prev) => { const s = new Set(prev); ids.forEach((id) => s.add(id)); return s; });
  };

  const clearSelection = () => setSelected(new Set());

  // ── Import selected files ─────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    const toImport = files.filter((f) => {
      if (!selected.has(f.id)) return false;
      if (f.status === "duplicate") {
        return duplicateMode === "replace" || duplicateMode === "import_anyway";
      }
      return f.status === "ready_to_import" || f.status === "needs_conversion";
    });
    if (toImport.length === 0) return;

    setState("importing");
    setImportErrors([]);
    setProgress(`Loading ${toImport.length} file${toImport.length > 1 ? "s" : ""} from ZIP…`);

    try {
      const loaded = await loadSelectedFiles(zipFileRef.current!, toImport);
      const errors: string[] = [];
      let successCount = 0;
      const replacedIds = new Set<string>();

      for (const pf of loaded) {
        if (!pf.file) {
          errors.push(`${pf.fileName}: could not extract from ZIP.`);
          continue;
        }

        setProgress(`Importing: ${pf.fileName} (${successCount + 1}/${loaded.length})`);

        try {
          if (
            duplicateMode === "replace" &&
            pf.duplicateOfDrawingId &&
            !replacedIds.has(pf.duplicateOfDrawingId)
          ) {
            await deleteDrawing(pf.duplicateOfDrawingId);
            replacedIds.add(pf.duplicateOfDrawingId);
          }

          const { drawingViewType, category } = roleToDrawingMeta(pf.role);
          const zipName = zipFileRef.current?.name ?? "package.zip";
          const result = await drawingUploadService.upload({
            projectId,
            file: pf.file,
            category,
            drawingViewType,
            notes: `[ZIP: ${zipName} > ${pf.zipPath}]`,
          });

          addDrawing(result.drawing);
          successCount++;

          if (result.warning) {
            errors.push(`${pf.fileName}: ${result.warning}`);
          }
        } catch (uploadErr) {
          errors.push(`${pf.fileName}: ${uploadErr instanceof Error ? uploadErr.message : "Upload failed."}`);
        }
      }

      setImportedCount(successCount);
      setImportErrors(errors);
      setState("done");
      setProgress("");
      onImported?.(successCount);
    } catch (err) {
      setState("error");
      setProgress(err instanceof Error ? err.message : "Import failed.");
    }
  }, [files, selected, duplicateMode, projectId, addDrawing, deleteDrawing, onImported]);

  // ── Reset ──────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setState("idle");
    setFiles([]);
    setSummary(null);
    setSelected(new Set());
    setImportErrors([]);
    setProgress("");
    zipFileRef.current = null;
  };

  // ── Displayed files (toggle show all / only ready) ────────────────────────
  const displayedFiles = showAll ? files : files.filter((f) => f.status !== "ignored" && f.kind !== "backup");

  // ── Render: idle / error drop zone ────────────────────────────────────────
  if (state === "idle" || state === "error") {
    return (
      <div className="space-y-3">
        <div
          ref={dropRef}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className={cn(
            "rounded-xl border-2 border-dashed px-8 py-10 text-center transition-colors",
            "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/30 cursor-pointer"
          )}
          onClick={() => document.getElementById("zip-file-input")?.click()}
        >
          <Archive className="mx-auto h-10 w-10 text-slate-400 mb-3" />
          <p className="text-sm font-semibold text-slate-700">Upload Full Client Package</p>
          <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
            Upload the ZIP exactly as received from the client or staff.
            FacadeFlow will detect plans, elevations, sections, schedules, details, and CAD files automatically.
          </p>
          <p className="mt-3 text-xs text-blue-600 font-medium">
            Drop a .zip file here or click to browse
          </p>
          {state === "error" && (
            <p className="mt-2 text-xs text-red-600">
              <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
              {progress}
            </p>
          )}
        </div>
        <input
          id="zip-file-input"
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleFileInput}
        />
      </div>
    );
  }

  // ── Render: scanning ──────────────────────────────────────────────────────
  if (state === "scanning") {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-6 py-8 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600 mb-3" />
        <p className="text-sm font-medium text-blue-900">Scanning ZIP contents…</p>
        <p className="mt-1 text-xs text-blue-700">{progress}</p>
      </div>
    );
  }

  // ── Render: done ──────────────────────────────────────────────────────────
  if (state === "done") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-6 py-6 text-center space-y-3">
        <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
        <p className="text-sm font-semibold text-green-900">
          Imported {importedCount} drawing{importedCount !== 1 ? "s" : ""} from package
        </p>
        {importErrors.length > 0 && (
          <div className="text-left text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-0.5">
            {importErrors.map((e, i) => <p key={i}><AlertTriangle className="inline h-3 w-3 mr-1" />{e}</p>)}
          </div>
        )}
        <p className="text-xs text-green-700">
          Drawings are now available in the project. Run Package Analysis to classify and review them.
        </p>
        <Button size="sm" variant="outline" onClick={handleReset}>
          Upload Another Package
        </Button>
      </div>
    );
  }

  // ── Render: ready / importing ─────────────────────────────────────────────
  const selectedImportable = files.filter((f) => {
    if (!selected.has(f.id)) return false;
    if (f.status === "duplicate") {
      return duplicateMode === "replace" || duplicateMode === "import_anyway";
    }
    return f.status === "ready_to_import" || f.status === "needs_conversion";
  });

  const duplicateCount = summary?.duplicateCount ?? 0;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">
            {zipFileRef.current?.name ?? "package.zip"}
          </span>
          <Badge variant="secondary" className="text-[10px]">{files.length} files found</Badge>
        </div>
        <button type="button" onClick={handleReset} className="text-slate-400 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Summary cards */}
      {summary && <SummaryCards summary={summary} />}

      {duplicateCount > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 space-y-2">
          <p>
            <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
            <strong>{duplicateCount} duplicate drawing{duplicateCount !== 1 ? "s" : ""} detected</strong> — same drawing number already exists in this project or appears twice in the ZIP.
            Duplicates are unchecked by default.
          </p>
          <div className="flex flex-wrap gap-3 items-center">
            <span className="text-[11px] font-medium text-amber-900">Duplicate handling:</span>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input
                type="radio"
                name="duplicate-mode"
                checked={duplicateMode === "skip"}
                onChange={() => setDuplicateMode("skip")}
              />
              Skip duplicates
            </label>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input
                type="radio"
                name="duplicate-mode"
                checked={duplicateMode === "replace"}
                onChange={() => setDuplicateMode("replace")}
              />
              Replace existing drawing
            </label>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input
                type="radio"
                name="duplicate-mode"
                checked={duplicateMode === "import_anyway"}
                onChange={() => setDuplicateMode("import_anyway")}
              />
              Import anyway
            </label>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <Button
          size="sm"
          onClick={handleImport}
          disabled={selectedImportable.length === 0 || state === "importing"}
          className="h-8"
        >
          {state === "importing" ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Importing…</>
          ) : (
            <><FileCheck2 className="h-4 w-4" />Import Selected ({selectedImportable.length})</>
          )}
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={selectAllPdfs}>
          Select All PDFs
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={selectPlansElevationsSections}>
          Plans / Elevations / Sections
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={clearSelection}>
          Clear
        </Button>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="ml-auto flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
        >
          {showAll ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {showAll ? "Hide ignored files" : "Show all files"}
        </button>
      </div>

      {/* Progress bar */}
      {state === "importing" && progress && (
        <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
          <Loader2 className="inline h-3 w-3 animate-spin mr-1" />
          {progress}
        </div>
      )}

      {/* DWG conversion notice */}
      {summary && summary.dwgCount > 0 && (
        <div className="rounded-md bg-orange-50 border border-orange-200 px-3 py-2 text-xs text-orange-800">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
          <strong>{summary.dwgCount} DWG file{summary.dwgCount > 1 ? "s" : ""} detected.</strong>{" "}
          DWG/DWF conversion support will be added in a future release. Convert to PDF or DXF for full analysis now.
        </div>
      )}

      {/* File table */}
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <Table className="text-xs min-w-[800px]">
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  checked={selectedImportable.length === files.filter((f) => f.status === "ready_to_import").length && files.filter((f) => f.status === "ready_to_import").length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelected(new Set(files.filter((f) => f.status === "ready_to_import").map((f) => f.id)));
                    } else {
                      clearSelection();
                    }
                  }}
                  className="h-3.5 w-3.5"
                />
              </TableHead>
              <TableHead>File Name</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Detected Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedFiles.map((f) => {
              const isDuplicate = f.status === "duplicate";
              const canSelect =
                f.status === "ready_to_import" ||
                f.status === "needs_conversion" ||
                (isDuplicate && duplicateMode !== "skip");
              const isSelected = selected.has(f.id);

              return (
                <TableRow
                  key={f.id}
                  className={cn(
                    f.status === "ignored" && "opacity-50",
                    f.status === "needs_conversion" && "bg-orange-50/30",
                    isDuplicate && "bg-amber-50/40",
                    isSelected && !isDuplicate && "bg-blue-50/40"
                  )}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!canSelect}
                      onChange={() => toggleSelect(f.id)}
                      className="h-3.5 w-3.5"
                    />
                  </TableCell>
                  <TableCell className="font-medium max-w-[180px]">
                    <span className="line-clamp-1">{f.fileName}</span>
                    {f.drawingIdentity && (
                      <span className="block text-[9px] text-slate-500 font-mono">{f.drawingIdentity}</span>
                    )}
                    {f.matchedCadName && (
                      <span className="block text-[9px] text-indigo-600">⇄ {f.matchedCadName}</span>
                    )}
                    {f.matchedPdfName && (
                      <span className="block text-[9px] text-blue-600">⇄ {f.matchedPdfName}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[10px] text-slate-500 max-w-[120px]">
                    <span className="line-clamp-1">
                      {f.zipPath.includes("/")
                        ? f.zipPath.slice(0, f.zipPath.lastIndexOf("/"))
                        : "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-[10px] px-1.5 py-0", KIND_COLORS[f.kind] ?? "bg-slate-100 text-slate-600")}>
                      {PACKAGE_FILE_KIND_LABELS[f.kind]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {f.role !== "ignored" && f.role !== "unknown" ? (
                      <span className="text-[11px] text-slate-700">{PACKAGE_FILE_ROLE_LABELS[f.role]}</span>
                    ) : (
                      <span className="text-[10px] text-slate-400 italic">{PACKAGE_FILE_ROLE_LABELS[f.role]}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-[10px] px-1.5 py-0", STATUS_COLORS[f.status] ?? "bg-slate-100")}>
                      {PACKAGE_FILE_STATUS_LABELS[f.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-[10px] px-1.5 py-0", CONF_COLORS[f.confidence])}>
                      {f.confidence}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[10px] text-slate-500">{formatBytes(f.sizeBytes)}</TableCell>
                  <TableCell className="text-[10px] text-slate-500 max-w-[140px]">
                    {f.notes.length > 0 ? (
                      <span className="line-clamp-2">{f.notes.join(" ")}</span>
                    ) : (
                      <span className="text-slate-400">{f.reason}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-[10px] text-slate-400">
        {displayedFiles.length} of {files.length} files shown.
        {!showAll && files.length > displayedFiles.length && (
          <> {files.length - displayedFiles.length} ignored/backup files hidden.</>
        )}
      </p>
    </div>
  );
}
