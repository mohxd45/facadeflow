/**
 * Local (localStorage) repository for DrawingOcrResult — Phase 3
 */

import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import type {
  DrawingOcrResult,
  CreateDrawingOcrResultInput,
} from "@/types/ocr";

export class LocalOcrResultRepository {
  private load(): DrawingOcrResult[] {
    return readJson<DrawingOcrResult[]>(STORAGE_KEYS.ocrResults, []);
  }

  private save(items: DrawingOcrResult[]): void {
    writeJson(STORAGE_KEYS.ocrResults, items);
  }

  async getAll(): Promise<DrawingOcrResult[]> {
    return this.load();
  }

  async getByProjectId(projectId: string): Promise<DrawingOcrResult[]> {
    return this.load().filter((r) => r.projectId === projectId);
  }

  async getByDrawingId(drawingId: string): Promise<DrawingOcrResult[]> {
    return this.load()
      .filter((r) => r.drawingId === drawingId)
      .sort((a, b) => a.pageNumber - b.pageNumber);
  }

  async replaceForDrawing(
    drawingId: string,
    inputs: CreateDrawingOcrResultInput[]
  ): Promise<DrawingOcrResult[]> {
    const now = new Date().toISOString();
    const created: DrawingOcrResult[] = inputs.map((input) => ({
      ...input,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    }));

    const items = this.load().filter((r) => r.drawingId !== drawingId);
    items.push(...created);
    this.save(items);
    return created;
  }

  async deleteByDrawingId(drawingId: string): Promise<void> {
    this.save(this.load().filter((r) => r.drawingId !== drawingId));
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    this.save(this.load().filter((r) => r.projectId !== projectId));
  }
}

export const ocrResultRepository = new LocalOcrResultRepository();
