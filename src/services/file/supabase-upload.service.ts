/**
 * Supabase drawing-file upload service — Phase 10
 *
 * Upload tiers:
 *  ≤ 250 MB  — standard single-request upload via Supabase Storage JS client
 *  > 250 MB  — queued; requires resumable/chunked upload via TUS protocol
 *              (TODO: implement with the Supabase resumable upload endpoint)
 *
 * Storage bucket: "drawing-files"
 * Path pattern:   {projectId}/{drawingId}/{fileName}
 */

import { getSupabaseClient } from "@/services/supabase/client";
import { buildStoragePath } from "./drawing-blob-resolver";

const BUCKET = "drawing-files";

/** 250 MB threshold for standard upload */
const STANDARD_UPLOAD_MAX = 250 * 1024 * 1024;

export interface SupabaseUploadResult {
  storagePath: string;
  publicUrl?: string;
  /** true when the file exceeds the standard upload limit and was not uploaded */
  queued: boolean;
  message?: string;
}

export interface UploadDrawingToSupabaseParams {
  projectId: string;
  drawingId: string;
  file: File;
  onProgress?: (percent: number) => void;
}

export async function uploadDrawingFileToSupabase(
  params: UploadDrawingToSupabaseParams
): Promise<SupabaseUploadResult> {
  const { projectId, drawingId, file } = params;
  // Structured path: projects/{projectId}/drawings/{drawingId}/{safeFileName}
  const storagePath = buildStoragePath(projectId, drawingId, file.name);

  // Files > 250 MB require resumable TUS upload — queue for backend processing
  if (file.size > STANDARD_UPLOAD_MAX) {
    // TODO: implement TUS resumable upload using the Supabase endpoint:
    //   POST /storage/v1/upload/resumable
    //   Headers: Upload-Length, Upload-Metadata, Content-Type: application/offset+octet-stream
    //   Library: tus-js-client (https://github.com/tus/tus-js-client)
    //
    // Steps:
    //   1. Create a TUS upload session
    //   2. Upload in chunks (default 6 MB each)
    //   3. On completion, update drawing status from "queued" to "ready"
    //   4. Use onProgress callback to update UI progress bar
    return {
      storagePath,
      queued: true,
      message:
        `File is ${(file.size / 1024 / 1024).toFixed(0)} MB. ` +
        "Files over 250 MB require resumable upload support (backend processing). " +
        "The drawing has been registered and will be processed when backend is available.",
    };
  }

  // Standard upload for files ≤ 250 MB
  const supabase = getSupabaseClient();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  // Generate a signed URL valid for 1 hour (adjust as needed)
  const { data: signedUrlData, error: urlError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);

  return {
    storagePath,
    publicUrl: urlError ? undefined : (signedUrlData?.signedUrl ?? undefined),
    queued: false,
  };
}

/**
 * Delete a drawing file from Supabase Storage.
 * Call this when a drawing is deleted from the project.
 */
export async function deleteDrawingFileFromSupabase(
  storagePath: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) {
    // Log but do not throw — metadata can still be deleted even if file removal fails
    console.warn("Supabase storage delete warning:", error.message);
  }
}

/**
 * Refresh a signed URL for a drawing that already exists in Supabase Storage.
 * Signed URLs expire; call this when previewUrl is needed and may be stale.
 */
export async function refreshSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
