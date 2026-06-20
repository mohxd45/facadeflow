/**
 * Local (localStorage) repository for DrawingIssueItem — Phase 1
 */

import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import type {
  DrawingIssueItem,
  CreateDrawingIssueItemInput,
} from "@/types/drawing-takeoff";

export class LocalDrawingIssueRepository {
  private load(): DrawingIssueItem[] {
    return readJson<DrawingIssueItem[]>(STORAGE_KEYS.drawingIssueItems, []);
  }

  private save(items: DrawingIssueItem[]): void {
    writeJson(STORAGE_KEYS.drawingIssueItems, items);
  }

  async getAll(): Promise<DrawingIssueItem[]> {
    return this.load();
  }

  async getByProjectId(projectId: string): Promise<DrawingIssueItem[]> {
    return this.load().filter((i) => i.projectId === projectId);
  }

  async getById(id: string): Promise<DrawingIssueItem | null> {
    return this.load().find((i) => i.id === id) ?? null;
  }

  async create(input: CreateDrawingIssueItemInput): Promise<DrawingIssueItem> {
    const now = new Date().toISOString();
    const item: DrawingIssueItem = {
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
    inputs: CreateDrawingIssueItemInput[]
  ): Promise<DrawingIssueItem[]> {
    const now = new Date().toISOString();
    const created = inputs.map(
      (input) =>
        ({
          ...input,
          id: generateId(),
          createdAt: now,
          updatedAt: now,
        }) as DrawingIssueItem
    );
    const existing = this.load();
    this.save([...existing, ...created]);
    return created;
  }

  async update(
    id: string,
    data: Partial<DrawingIssueItem>
  ): Promise<DrawingIssueItem> {
    const items = this.load();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error(`DrawingIssueItem ${id} not found`);
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

export const drawingIssueRepository = new LocalDrawingIssueRepository();
