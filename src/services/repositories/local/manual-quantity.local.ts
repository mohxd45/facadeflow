import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import type {
  ManualQuantityItem,
  CreateManualQuantityInput,
} from "@/types/validation";

export class LocalManualQuantityRepository {
  private load(): ManualQuantityItem[] {
    return readJson<ManualQuantityItem[]>(STORAGE_KEYS.manualQuantities, []);
  }

  private save(items: ManualQuantityItem[]): void {
    writeJson(STORAGE_KEYS.manualQuantities, items);
  }

  async getAll(): Promise<ManualQuantityItem[]> {
    return this.load();
  }

  async getByProjectId(projectId: string): Promise<ManualQuantityItem[]> {
    return this.load().filter((i) => i.projectId === projectId);
  }

  async create(input: CreateManualQuantityInput): Promise<ManualQuantityItem> {
    const now = new Date().toISOString();
    const item: ManualQuantityItem = {
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

  async update(
    id: string,
    data: Partial<ManualQuantityItem>
  ): Promise<ManualQuantityItem> {
    const items = this.load();
    const index = items.findIndex((i) => i.id === id);
    if (index === -1) throw new Error(`Manual quantity item ${id} not found`);
    items[index] = {
      ...items[index],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    this.save(items);
    return items[index];
  }

  async delete(id: string): Promise<void> {
    this.save(this.load().filter((i) => i.id !== id));
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    this.save(this.load().filter((i) => i.projectId !== projectId));
  }
}

export const manualQuantityRepository = new LocalManualQuantityRepository();
