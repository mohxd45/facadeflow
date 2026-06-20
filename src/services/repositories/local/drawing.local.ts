import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import type { DrawingFile, CreateDrawingInput } from "@/types/drawing";
import type { IDrawingRepository } from "../drawing.repository";

export class LocalDrawingRepository implements IDrawingRepository {
  private load(): DrawingFile[] {
    return readJson<DrawingFile[]>(STORAGE_KEYS.drawings, []);
  }

  private save(drawings: DrawingFile[]): void {
    writeJson(STORAGE_KEYS.drawings, drawings);
  }

  async getAll(): Promise<DrawingFile[]> {
    return this.load();
  }

  async getByProjectId(projectId: string): Promise<DrawingFile[]> {
    return this.load()
      .filter((d) => d.projectId === projectId)
      .sort(
        (a, b) =>
          new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
  }

  async getById(id: string): Promise<DrawingFile | null> {
    return this.load().find((d) => d.id === id) ?? null;
  }

  async create(
    input: CreateDrawingInput & Partial<DrawingFile>
  ): Promise<DrawingFile> {
    const drawing: DrawingFile = {
      id: input.id ?? generateId(),
      projectId: input.projectId,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
      drawingViewType: input.drawingViewType ?? "plan",
      category: input.category,
      floorOrLocation: input.floorOrLocation,
      uploadedAt: input.uploadedAt ?? new Date().toISOString(),
      previewUrl: input.previewUrl,
      storagePath: input.storagePath,
      status: input.status ?? "uploaded",
      notes: input.notes,
      hasLocalBlob: input.hasLocalBlob,
      errorMessage: input.errorMessage,
    };
    const drawings = this.load();
    drawings.push(drawing);
    this.save(drawings);
    return drawing;
  }

  async update(id: string, data: Partial<DrawingFile>): Promise<DrawingFile> {
    const drawings = this.load();
    const index = drawings.findIndex((d) => d.id === id);
    if (index === -1) throw new Error(`Drawing ${id} not found`);
    drawings[index] = { ...drawings[index], ...data };
    this.save(drawings);
    return drawings[index];
  }

  async delete(id: string): Promise<void> {
    this.save(this.load().filter((d) => d.id !== id));
  }
}

export const drawingRepository = new LocalDrawingRepository();
