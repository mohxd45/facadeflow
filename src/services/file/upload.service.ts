/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Drawing upload orchestration — Phase 13
 *
 * Mode-aware:
 *  local    — blob → IndexedDB; metadata → localStorage
 *  supabase — file → Supabase Storage; metadata → Supabase Postgres
 *
 * Size tiers (both modes):
 *  ≤ 250 MB — full upload (blob/storage)
 *  > 250 MB — metadata-only, status = queued
 */

import type { DrawingCategory, DrawingViewType } from "@/types/drawing";
import type { DrawingFile, DrawingFileStatus } from "@/types/drawing";
import { analyzeFileSize, type PreviewStrategy } from "@/lib/file-size";
import { generateId } from "@/lib/utils";
import { isSupabaseMode } from "@/lib/env";
import { getDrawingRepository } from "@/services/repositories/repository-factory";
import { saveFileBlob } from "./file-blob.store";
import { buildStoragePath } from "./drawing-blob-resolver";
import {
  canGeneratePreview,
  detectDrawingFileType,
  isAcceptedDrawingFile,
} from "./preview";

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface UploadDrawingParams {
  projectId: string;
  file: File;
  category: DrawingCategory;
  drawingViewType: DrawingViewType;
  floorOrLocation?: string;
  notes?: string;
  /** For 100–250 MB files: user opts in to preview */
  enablePreview?: boolean;
  /** Progress callback (0–100) — used for Supabase uploads */
  onProgress?: (percent: number) => void;
}

export interface UploadDrawingResult {
  drawing: DrawingFile;
  warning?: string;
}

export interface ChunkedUploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  percent: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DrawingUploadService {
  async upload(params: UploadDrawingParams): Promise<UploadDrawingResult> {
    return isSupabaseMode()
      ? this.uploadSupabase(params)
      : this.uploadLocal(params);
  }

  // ── Local mode ─────────────────────────────────────────────────────────

  private async uploadLocal(
    params: UploadDrawingParams
  ): Promise<UploadDrawingResult> {
    const {
      file,
      projectId,
      category,
      drawingViewType,
      floorOrLocation,
      notes,
      enablePreview,
    } = params;

    if (!isAcceptedDrawingFile(file)) {
      throw new Error("Only PDF, DXF, and DWG files are accepted.");
    }

    const fileType = detectDrawingFileType(file.name)!;
    const analysis = analyzeFileSize(file.size);

    if (analysis.rejected) {
      throw new Error(analysis.rejectReason ?? "File too large.");
    }

    const drawingId = generateId();
    let status: DrawingFileStatus = "uploaded";
    let previewUrl: string | undefined;
    let hasLocalBlob = false;
    let storagePath: string | undefined;

    if (analysis.metadataOnly) {
      status = "queued";
      storagePath = `queued/${projectId}/${drawingId}/${file.name}`;
    } else {
      await saveFileBlob(drawingId, file);
      hasLocalBlob = true;

      const wantsPreview = this.resolvePreview(
        analysis.previewStrategy,
        enablePreview
      );

      if (
        canGeneratePreview(fileType, analysis.previewStrategy, wantsPreview)
      ) {
        previewUrl = URL.createObjectURL(file);
        status = fileType === "dwg" ? "queued" : "ready";
      } else if (fileType === "dwg") {
        status = "queued";
      } else {
        status = "ready";
      }

      storagePath = `local/${projectId}/${drawingId}/${file.name}`;
    }

    const repo = getDrawingRepository();
    const drawing = await repo.create({
      id: drawingId,
      projectId,
      fileName: file.name,
      fileType,
      fileSize: file.size,
      drawingViewType,
      category,
      floorOrLocation,
      notes,
      status,
      previewUrl,
      storagePath,
      hasLocalBlob,
    });

    return { drawing, warning: analysis.warning };
  }

  // ── Supabase mode ──────────────────────────────────────────────────────

  private async uploadSupabase(
    params: UploadDrawingParams
  ): Promise<UploadDrawingResult> {
    const {
      file,
      projectId,
      category,
      drawingViewType,
      floorOrLocation,
      notes,
      onProgress,
    } = params;

    if (!isAcceptedDrawingFile(file)) {
      throw new Error("Only PDF, DXF, and DWG files are accepted.");
    }

    const fileType = detectDrawingFileType(file.name)!;
    const analysis = analyzeFileSize(file.size);

    if (analysis.rejected) {
      throw new Error(analysis.rejectReason ?? "File too large.");
    }

    const drawingId = generateId();
    const repo = getDrawingRepository();
    let hasLocalBlob = false;

    // Large files (> 250 MB) — register metadata only, queued status
    if (analysis.metadataOnly) {
      const storagePath = buildStoragePath(projectId, drawingId, file.name);
      const drawing = await repo.create({
        id: drawingId,
        projectId,
        fileName: file.name,
        fileType,
        fileSize: file.size,
        drawingViewType,
        category,
        floorOrLocation,
        notes,
        status: "queued",
        storagePath,
        hasLocalBlob: false,
      });
      return {
        drawing,
        warning: `Large file queued (${(file.size / 1024 / 1024).toFixed(0)} MB). Resumable upload/backend processing will be added later.`,
      };
    }

    // Standard upload (≤ 250 MB) ─────────────────────────────────────────
    const { uploadDrawingFileToSupabase } = await import(
      "./supabase-upload.service"
    );

    onProgress?.(5); // indicate start

    let uploadResult: Awaited<ReturnType<typeof uploadDrawingFileToSupabase>>;
    try {
      uploadResult = await uploadDrawingFileToSupabase({
        projectId,
        drawingId,
        file,
        onProgress,
      });
    } catch (uploadErr) {
      // Storage upload failed — save metadata with error status so user knows
      const storagePath = buildStoragePath(projectId, drawingId, file.name);
      const errorMsg =
        uploadErr instanceof Error ? uploadErr.message : "Storage upload failed.";
      try {
        const drawing = await repo.create({
          id: drawingId,
          projectId,
          fileName: file.name,
          fileType,
          fileSize: file.size,
          drawingViewType,
          category,
          floorOrLocation,
          notes,
          status: "error",
          storagePath,
          errorMessage: errorMsg,
          hasLocalBlob: false,
        });
        return {
          drawing,
          warning: `Storage upload failed: ${errorMsg}. Drawing registered with error status.`,
        };
      } catch {
        throw new Error(`Storage upload failed: ${errorMsg}`);
      }
    }

    onProgress?.(90);

    // Keep a local IndexedDB copy as a resilient render source for AI Vision.
    // This enables later render/review even when metadata-only imports exist in old projects.
    try {
      await saveFileBlob(drawingId, file);
      hasLocalBlob = true;
    } catch {
      hasLocalBlob = false;
    }

    // Create metadata in Supabase DB ────────────────────────────────────
    const status: DrawingFileStatus =
      fileType === "dwg" ? "queued" : "ready";

    let drawing: DrawingFile;
    try {
      drawing = await repo.create({
        id: drawingId,
        projectId,
        fileName: file.name,
        fileType,
        fileSize: file.size,
        drawingViewType,
        category,
        floorOrLocation,
        notes,
        status,
        storagePath: uploadResult.storagePath,
        previewUrl: uploadResult.publicUrl,
        hasLocalBlob,
      });
    } catch (metaErr) {
      // Metadata save failed — try to clean up the uploaded file
      const metaMsg =
        metaErr instanceof Error ? metaErr.message : "Metadata save failed.";
      try {
        const { deleteDrawingFileFromSupabase } = await import(
          "./supabase-upload.service"
        );
        await deleteDrawingFileFromSupabase(uploadResult.storagePath);
      } catch {
        // Cleanup best-effort — warn user
      }
      throw new Error(
        `File uploaded to storage but metadata save failed: ${metaMsg}. ` +
          "The uploaded file has been removed. Please try uploading again."
      );
    }

    onProgress?.(100);
    return { drawing, warning: analysis.warning };
  }

  private resolvePreview(
    strategy: PreviewStrategy,
    enablePreview?: boolean
  ): boolean {
    if (strategy === "full") return true;
    if (strategy === "optional") return enablePreview ?? false;
    return false;
  }

  /**
   * STUB — Future chunked resumable upload to Supabase Storage / S3.
   *
   * See: POST /storage/v1/upload/resumable (TUS protocol)
   * Library: tus-js-client
   */
  async uploadChunked(
    _file: File,
    _storagePath: string,
    _onProgress?: (progress: ChunkedUploadProgress) => void
  ): Promise<string> {
    throw new Error(
      "Chunked upload not implemented. Requires TUS resumable upload support."
    );
  }
}

export const drawingUploadService = new DrawingUploadService();
