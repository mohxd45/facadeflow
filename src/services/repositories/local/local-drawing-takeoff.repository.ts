/**
 * Local (localStorage) repository for DrawingTakeoffItem — Phase 4
 */

import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import type {
  DrawingTakeoffItem,
  CreateDrawingTakeoffItemInput,
} from "@/types/drawing-takeoff";

export class LocalDrawingTakeoffRepository {
  private load(): DrawingTakeoffItem[] {
    return readJson<DrawingTakeoffItem[]>(STORAGE_KEYS.drawingTakeoffItems, []);
  }

  private save(items: DrawingTakeoffItem[]): void {
    writeJson(STORAGE_KEYS.drawingTakeoffItems, items);
  }

  async getAll(): Promise<DrawingTakeoffItem[]> {
    return this.load();
  }

  async getByProjectId(projectId: string): Promise<DrawingTakeoffItem[]> {
    return this.load().filter((i) => i.projectId === projectId);
  }

  async getById(id: string): Promise<DrawingTakeoffItem | null> {
    return this.load().find((i) => i.id === id) ?? null;
  }

  async create(
    input: CreateDrawingTakeoffItemInput
  ): Promise<DrawingTakeoffItem> {
    const now = new Date().toISOString();
    const item: DrawingTakeoffItem = {
      ...input,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    const items = this.load();
    items.push(item);
    this.save(items);
    return item;
  }

  async createMany(
    inputs: CreateDrawingTakeoffItemInput[]
  ): Promise<DrawingTakeoffItem[]> {
    const now = new Date().toISOString();
    const created = inputs.map(
      (input) =>
        ({
          ...input,
          id: generateId(),
          createdAt: now,
          updatedAt: now,
        }) as DrawingTakeoffItem
    );
    const items = this.load();
    this.save([...items, ...created]);
    return created;
  }

  async update(
    id: string,
    data: Partial<DrawingTakeoffItem>
  ): Promise<DrawingTakeoffItem> {
    const items = this.load();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error(`DrawingTakeoffItem ${id} not found`);
    items[idx] = {
      ...items[idx],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    this.save(items);
    return items[idx];
  }

  async delete(id: string): Promise<void> {
    this.save(this.load().filter((i) => i.id !== id));
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    this.save(this.load().filter((i) => i.projectId !== projectId));
  }
}

export const drawingTakeoffRepository = new LocalDrawingTakeoffRepository();
