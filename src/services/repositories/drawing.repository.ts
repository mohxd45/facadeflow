import type { DrawingFile, CreateDrawingInput } from "@/types/drawing";

/**
 * Repository boundary for drawing metadata.
 * v1: LocalStorage for metadata; IndexedDB for blobs (see file-blob.store).
 * Future: Supabase Storage + `drawings` table.
 */
export interface IDrawingRepository {
  getAll(): Promise<DrawingFile[]>;
  getByProjectId(projectId: string): Promise<DrawingFile[]>;
  getById(id: string): Promise<DrawingFile | null>;
  create(input: CreateDrawingInput & Partial<DrawingFile>): Promise<DrawingFile>;
  update(id: string, data: Partial<DrawingFile>): Promise<DrawingFile>;
  delete(id: string): Promise<void>;
}
