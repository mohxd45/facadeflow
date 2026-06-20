/**
 * Processing job service — Phase 10 placeholder
 *
 * In local mode, processing jobs are tracked in-memory (no persistence).
 * They represent large-file or backend-required operations that cannot run
 * in the browser.
 *
 * Future backend worker:
 *   - A Supabase Edge Function or separate Node/Python worker polls the
 *     `processing_jobs` table (or a Postgres `LISTEN` channel) for queued jobs.
 *   - It downloads the file from the `drawing-files` bucket.
 *   - For DXF/DWG > 100 MB: parses server-side, writes results to
 *     `quantity_takeoff_items`.
 *   - For PDF > 250 MB: extracts text via a server-side PDF library and
 *     writes suggestions back.
 *   - Updates job status to "completed" or "failed".
 *   - The client polls or subscribes via Supabase Realtime to receive updates.
 */

import { generateId } from "@/lib/utils";
import type { ProcessingJob, ProcessingJobStatus } from "@/types/processing";

// ---------------------------------------------------------------------------
// In-memory store (local mode)
// ---------------------------------------------------------------------------

const _jobs = new Map<string, ProcessingJob>();

export function createLocalProcessingJob(
  params: Omit<ProcessingJob, "id" | "createdAt" | "updatedAt">
): ProcessingJob {
  const now = new Date().toISOString();
  const job: ProcessingJob = {
    ...params,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  _jobs.set(job.id, job);
  return job;
}

export function updateLocalProcessingJobStatus(
  id: string,
  status: ProcessingJobStatus,
  update: { progress?: number; message?: string } = {}
): ProcessingJob | null {
  const job = _jobs.get(id);
  if (!job) return null;
  const updated: ProcessingJob = {
    ...job,
    status,
    progress: update.progress ?? job.progress,
    message: update.message ?? job.message,
    updatedAt: new Date().toISOString(),
  };
  _jobs.set(id, updated);
  return updated;
}

export function getLocalProcessingJob(id: string): ProcessingJob | null {
  return _jobs.get(id) ?? null;
}

export function getAllLocalProcessingJobs(): ProcessingJob[] {
  return Array.from(_jobs.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getLocalProcessingJobsByDrawing(
  drawingId: string
): ProcessingJob[] {
  return getAllLocalProcessingJobs().filter((j) => j.drawingId === drawingId);
}

// ---------------------------------------------------------------------------
// Future Supabase implementation sketch
// ---------------------------------------------------------------------------

/*
TODO: SupabaseProcessingJobService

  async createJob(input: CreateProcessingJobInput): Promise<ProcessingJob> {
    const { data, error } = await supabase
      .from("processing_jobs")
      .insert({ ...snakeCaseInput(input) })
      .select()
      .single();
    if (error) throw error;
    return camelCaseResult(data);
  }

  async updateStatus(id: string, status: ProcessingJobStatus, ...): Promise<void> {
    await supabase
      .from("processing_jobs")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
  }

  // Subscribe to realtime updates for a specific job
  subscribeToJob(id: string, callback: (job: ProcessingJob) => void): () => void {
    const channel = supabase
      .channel(`processing_jobs:${id}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "processing_jobs",
        filter: `id=eq.${id}`,
      }, (payload) => callback(camelCaseResult(payload.new)))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }
*/
