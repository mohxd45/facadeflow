/**
 * Drawing blob resolver — Phase 13
 *
 * Single source-of-truth for resolving a DrawingFile → File (Blob).
 *
 * Resolution order
 * ─────────────────
 * 1. IndexedDB local blob  (hasLocalBlob = true, any mode)
 * 2. Supabase Storage      (supabase mode + storagePath set, no local blob)
 * 3. previewUrl fallback   (any URL — blob:, http:, signed URL)
 * 4. throw                 (no source found)
 */

import type { DrawingFile } from "@/types/drawing";
import { getFileBlob } from "./file-blob.store";
import { isSupabaseMode } from "@/lib/env";

export interface DrawingBlobResolveDetails {
  drawingId: string;
  fileName: string;
  fileSize?: number;
  hasLocalBlob: boolean;
  storagePath?: string;
  previewUrl?: string;
  sourceHint?: string;
  causes: string[];
  suggestion: string;
}

export class DrawingBlobResolveError extends Error {
  readonly details: DrawingBlobResolveDetails;

  constructor(details: DrawingBlobResolveDetails) {
    const sizeText =
      typeof details.fileSize === "number" ? `${(details.fileSize / 1024 / 1024).toFixed(1)} MB` : "unknown size";
    const sourceText = details.sourceHint ? ` Source: ${details.sourceHint}.` : "";
    const causesText = details.causes.length > 0 ? ` Causes: ${details.causes.join(" | ")}.` : "";
    super(
      `File data unavailable for "${details.fileName}" (${sizeText}).` +
      `${sourceText}${causesText} ${details.suggestion}`
    );
    this.name = "DrawingBlobResolveError";
    this.details = details;
  }
}

/** Sanitise a filename for use in storage paths */
export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Build the Supabase Storage path for a drawing */
export function buildStoragePath(
  projectId: string,
  drawingId: string,
  fileName: string
): string {
  return `projects/${projectId}/drawings/${drawingId}/${safeFileName(fileName)}`;
}

/**
 * Resolve a DrawingFile to a File blob for client-side processing.
 * Throws a user-friendly error if no blob source is available.
 */
export async function resolveDrawingBlob(drawing: DrawingFile): Promise<File> {
  const causes: string[] = [];
  const sourceHint = drawing.notes?.match(/\[ZIP:\s*(.+?)\]/)?.[1];

  // 1. IndexedDB local blob
  if (drawing.hasLocalBlob) {
    try {
      const blob = await getFileBlob(drawing.id);
      if (blob) {
        return new File([blob], drawing.fileName, { type: blob.type });
      }
      causes.push("Drawing metadata says local blob exists, but IndexedDB entry is missing.");
    } catch (err) {
      causes.push(
        `IndexedDB lookup failed (${err instanceof Error ? err.message : "unknown error"}).`
      );
    }
  } else {
    causes.push("Drawing metadata indicates no local blob (hasLocalBlob=false).");
  }

  // 2. Supabase Storage — download from storagePath
  if (isSupabaseMode() && drawing.storagePath && !drawing.storagePath.startsWith("local/") && !drawing.storagePath.startsWith("queued/")) {
    try {
      const { refreshSignedUrl } = await import("./supabase-upload.service");
      const signedUrl = await refreshSignedUrl(drawing.storagePath);
      if (!signedUrl) {
        causes.push(`Supabase signed URL could not be generated for ${drawing.storagePath}.`);
      } else {
        const resp = await fetch(signedUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          return new File([blob], drawing.fileName, { type: blob.type });
        }
        causes.push(`Supabase fetch failed (${resp.status} ${resp.statusText}).`);
      }
    } catch (err) {
      causes.push(`Supabase storage retrieval failed (${err instanceof Error ? err.message : "unknown error"}).`);
    }
  } else if (isSupabaseMode()) {
    causes.push("No valid Supabase storagePath available for this drawing.");
  }

  // 3. Any previewUrl (blob:, http:, signed URLs stored in metadata)
  if (drawing.previewUrl) {
    try {
      const resp = await fetch(drawing.previewUrl);
      if (resp.ok) {
        const blob = await resp.blob();
        return new File([blob], drawing.fileName, { type: blob.type });
      }
      causes.push(`previewUrl fetch failed (${resp.status} ${resp.statusText}).`);
    } catch (err) {
      causes.push(`previewUrl fetch threw (${err instanceof Error ? err.message : "unknown error"}).`);
    }
  } else {
    causes.push("No previewUrl available in drawing metadata.");
  }

  // Nothing worked
  const isSupabase = isSupabaseMode();
  const hint = isSupabase
    ? "Re-import or replace this drawing, then verify Supabase upload/storage access."
    : "Re-import or replace this drawing to restore file/blob data for analysis.";

  throw new DrawingBlobResolveError({
    drawingId: drawing.id,
    fileName: drawing.fileName,
    fileSize: drawing.fileSize,
    hasLocalBlob: !!drawing.hasLocalBlob,
    storagePath: drawing.storagePath,
    previewUrl: drawing.previewUrl,
    sourceHint,
    causes,
    suggestion: hint,
  });
}
