export type ProcessingJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export interface ProcessingJob {
  id: string;
  projectId: string;
  drawingId: string;
  fileName: string;
  fileType: string;
  status: ProcessingJobStatus;
  /** 0–100 */
  progress?: number;
  message?: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateProcessingJobInput = Omit<
  ProcessingJob,
  "id" | "createdAt" | "updatedAt"
>;
