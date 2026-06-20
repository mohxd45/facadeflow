/**
 * Local (localStorage) repository for CodeTakeoffItem — Phase 2
 */

import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import type { CodeTakeoffItem, CreateCodeTakeoffItemInput } from "@/types/code-takeoff";

export class LocalCodeTakeoffRepository {
  private load(): CodeTakeoffItem[] {
    return readJson<CodeTakeoffItem[]>(STORAGE_KEYS.codeTakeoffItems, []);
  }

  private save(items: CodeTakeoffItem[]): void {
    writeJson(STORAGE_KEYS.codeTakeoffItems, items);
  }

  async getAll(): Promise<CodeTakeoffItem[]> {
    return this.load();
  }

  async getByProjectId(projectId: string): Promise<CodeTakeoffItem[]> {
    return this.load().filter((i) => i.projectId === projectId);
  }

  async getById(id: string): Promise<CodeTakeoffItem | null> {
    return this.load().find((i) => i.id === id) ?? null;
  }

  async create(input: CreateCodeTakeoffItemInput): Promise<CodeTakeoffItem> {
    const now = new Date().toISOString();
    const item: CodeTakeoffItem = { ...input, id: generateId(), createdAt: now, updatedAt: now };
    const items = this.load();
    items.push(item);
    this.save(items);
    return item;
  }

  async createMany(inputs: CreateCodeTakeoffItemInput[]): Promise<CodeTakeoffItem[]> {
    const now = new Date().toISOString();
    const created = inputs.map((input) => ({
      ...input,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    } as CodeTakeoffItem));
    const items = this.load();
    this.save([...items, ...created]);
    return created;
  }

  async update(id: string, data: Partial<CodeTakeoffItem>): Promise<CodeTakeoffItem> {
    const items = this.load();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error(`CodeTakeoffItem ${id} not found`);
    items[idx] = { ...items[idx], ...data, updatedAt: new Date().toISOString() };
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

export const codeTakeoffRepository = new LocalCodeTakeoffRepository();
