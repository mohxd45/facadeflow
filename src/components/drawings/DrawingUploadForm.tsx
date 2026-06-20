"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { DrawingCategory, DrawingViewType } from "@/types/drawing";
import { DRAWING_CATEGORY_LABELS, DRAWING_VIEW_TYPE_LABELS } from "@/lib/constants";
import {
  analyzeFileSize,
  formatFileSize,
} from "@/lib/file-size";
import {
  PREVIEW_OPTIONAL_MAX_BYTES,
  PREVIEW_FULL_MAX_BYTES,
} from "@/lib/constants";
import { drawingUploadService } from "@/services/file/upload.service";
import { isAcceptedDrawingFile } from "@/services/file/preview";
import { isSupabaseMode } from "@/lib/env";
import { useDrawingStore } from "@/stores/drawing-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import FileSizeWarning from "./FileSizeWarning";
import DrawingStatusBadge from "./DrawingStatusBadge";
import { Upload, X, FileUp, HardDrive, Database, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

interface PendingFile {
  file: File;
  category: DrawingCategory;
  drawingViewType: DrawingViewType;
  floorOrLocation: string;
  notes: string;
  enablePreview: boolean;
}

interface UploadFileState {
  fileName: string;
  status: "pending" | "uploading" | "done" | "warning" | "error";
  progress: number;     // 0–100
  message?: string;
}

interface DrawingUploadFormProps {
  projectId: string;
}

export default function DrawingUploadForm({ projectId }: DrawingUploadFormProps) {
  const router = useRouter();
  const addDrawing = useDrawingStore((s) => s.addDrawing);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileStates, setFileStates] = useState<UploadFileState[]>([]);

  const supabase = isSupabaseMode();

  const setFileProgress = (index: number, update: Partial<UploadFileState>) => {
    setFileStates((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...update } : s))
    );
  };

  const addFiles = useCallback((files: FileList | File[]) => {
    const valid: PendingFile[] = [];
    const errors: string[] = [];

    Array.from(files).forEach((file) => {
      if (!isAcceptedDrawingFile(file)) {
        errors.push(`${file.name}: unsupported file type`);
        return;
      }
      const analysis = analyzeFileSize(file.size);
      if (analysis.rejected) {
        errors.push(`${file.name}: ${analysis.rejectReason}`);
        return;
      }
      valid.push({
        file,
        category: "general",
        drawingViewType: "plan",
        floorOrLocation: "",
        notes: "",
        enablePreview: file.size <= PREVIEW_FULL_MAX_BYTES,
      });
    });

    if (errors.length > 0) setError(errors.join(". "));
    else setError(null);

    setPendingFiles((prev) => [...prev, ...valid]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const updatePending = (index: number, data: Partial<PendingFile>) => {
    setPendingFiles((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...data } : p))
    );
  };

  const removePending = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (pendingFiles.length === 0) return;
    setUploading(true);
    setError(null);

    // Initialise per-file state
    setFileStates(
      pendingFiles.map((p) => ({
        fileName: p.file.name,
        status: "pending",
        progress: 0,
      }))
    );

    let anyFailed = false;

    for (let i = 0; i < pendingFiles.length; i++) {
      const pending = pendingFiles[i];
      setFileProgress(i, { status: "uploading", progress: 5 });

      try {
        const result = await drawingUploadService.upload({
          projectId,
          file: pending.file,
          category: pending.category,
          drawingViewType: pending.drawingViewType,
          floorOrLocation: pending.floorOrLocation || undefined,
          notes: pending.notes || undefined,
          enablePreview: pending.enablePreview,
          onProgress: (pct) => setFileProgress(i, { progress: pct }),
        });

        addDrawing(result.drawing);

        if (result.warning) {
          setFileProgress(i, { status: "warning", progress: 100, message: result.warning });
        } else {
          setFileProgress(i, { status: "done", progress: 100 });
        }
      } catch (err) {
        anyFailed = true;
        const msg = err instanceof Error ? err.message : "Upload failed";
        setFileProgress(i, { status: "error", progress: 0, message: msg });
      }
    }

    setUploading(false);

    if (!anyFailed) {
      // Small delay so user sees 100% before navigating
      await new Promise((r) => setTimeout(r, 600));
      router.push(`/projects/${projectId}?tab=drawings`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Storage mode badge */}
      <div className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${
        supabase
          ? "border-blue-200 bg-blue-50 text-blue-800"
          : "border-slate-200 bg-slate-50 text-slate-700"
      }`}>
        {supabase ? (
          <Database className="h-4 w-4 shrink-0" />
        ) : (
          <HardDrive className="h-4 w-4 shrink-0" />
        )}
        <span>
          {supabase
            ? "Supabase mode — files will upload to cloud storage (≤ 250 MB). Larger files are queued."
            : "Local mode — files are stored in your browser (≤ 250 MB). Larger files registered as metadata only."}
        </span>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
          dragOver
            ? "border-blue-400 bg-blue-50"
            : "border-[var(--border)] bg-white"
        }`}
      >
        <Upload className="h-10 w-10 text-slate-400" />
        <p className="mt-3 text-sm font-medium">
          Drag and drop construction drawings here
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          PDF, DXF, DWG — up to 1 GB per file
        </p>
        <label className="mt-4">
          <input
            type="file"
            accept=".pdf,.dxf,.dwg"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <Button type="button" variant="outline" asChild>
            <span className="cursor-pointer">
              <FileUp className="h-4 w-4" />
              Browse files
            </span>
          </Button>
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">
            Files to upload ({pendingFiles.length})
          </h3>
          {pendingFiles.map((pending, index) => {
            const analysis = analyzeFileSize(pending.file.size);
            const showPreviewOption =
              pending.file.size > PREVIEW_FULL_MAX_BYTES &&
              pending.file.size <= PREVIEW_OPTIONAL_MAX_BYTES;

            return (
              <div
                key={`${pending.file.name}-${index}`}
                className="rounded-lg border border-[var(--border)] bg-white p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {pending.file.name}
                      </p>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-700">
                        {pending.file.name.split(".").pop()}
                      </span>
                      <span className="text-xs font-semibold text-[var(--foreground)]">
                        {formatFileSize(pending.file.size)}
                      </span>
                      {analysis.metadataOnly && (
                        <DrawingStatusBadge status="queued" />
                      )}
                    </div>
                    <FileSizeWarning fileSize={pending.file.size} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removePending(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Drawing view type</Label>
                    <Select
                      value={pending.drawingViewType}
                      onValueChange={(v) =>
                        updatePending(index, {
                          drawingViewType: v as DrawingViewType,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(DRAWING_VIEW_TYPE_LABELS).map(
                          ([key, label]) => (
                            <SelectItem key={key} value={key}>
                              {label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={pending.category}
                      onValueChange={(v) =>
                        updatePending(index, {
                          category: v as DrawingCategory,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(DRAWING_CATEGORY_LABELS).map(
                          ([key, label]) => (
                            <SelectItem key={key} value={key}>
                              {label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Location / Floor</Label>
                    <Input
                      value={pending.floorOrLocation}
                      onChange={(e) =>
                        updatePending(index, {
                          floorOrLocation: e.target.value,
                        })
                      }
                      placeholder="e.g. Level 12, North elevation"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={pending.notes}
                      onChange={(e) =>
                        updatePending(index, { notes: e.target.value })
                      }
                      placeholder="Optional notes"
                      rows={2}
                    />
                  </div>
                  {showPreviewOption && (
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <input
                        type="checkbox"
                        id={`preview-${index}`}
                        checked={pending.enablePreview}
                        onChange={(e) =>
                          updatePending(index, {
                            enablePreview: e.target.checked,
                          })
                        }
                        className="rounded border-[var(--border)]"
                      />
                      <Label htmlFor={`preview-${index}`} className="font-normal">
                        Generate preview (optional for files 100–250 MB)
                      </Label>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Per-file progress (visible while uploading) */}
          {fileStates.length > 0 && (
            <div className="space-y-2">
              {fileStates.map((fs, i) => (
                <div key={i} className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="truncate font-medium">{fs.fileName}</span>
                    <span className="shrink-0">
                      {fs.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                      {fs.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
                      {fs.status === "warning" && <AlertTriangle className="h-4 w-4 text-amber-600" />}
                      {fs.status === "error" && <AlertTriangle className="h-4 w-4 text-red-500" />}
                    </span>
                  </div>
                  {(fs.status === "uploading" || fs.status === "done") && (
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          fs.status === "done" ? "bg-emerald-500" : "bg-blue-500"
                        }`}
                        style={{ width: `${fs.progress}%` }}
                      />
                    </div>
                  )}
                  {fs.message && (
                    <p className={`mt-1 text-xs ${fs.status === "error" ? "text-red-600" : "text-amber-700"}`}>
                      {fs.message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => router.push(`/projects/${projectId}`)}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {supabase ? "Uploading to cloud…" : "Saving locally…"}
                </>
              ) : (
                `Upload ${pendingFiles.length} file(s)`
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
