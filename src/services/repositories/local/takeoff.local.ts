import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import type {
  QuantityTakeoffItem,
  CreateTakeoffItemInput,
} from "@/types/takeoff";
import type { ITakeoffRepository } from "../takeoff.repository";

export class LocalTakeoffRepository implements ITakeoffRepository {
  private load(): QuantityTakeoffItem[] {
    return readJson<QuantityTakeoffItem[]>(STORAGE_KEYS.takeoffItems, []);
  }

  private save(items: QuantityTakeoffItem[]): void {
    writeJson(STORAGE_KEYS.takeoffItems, items);
  }

  async getAll(): Promise<QuantityTakeoffItem[]> {
    return this.load();
  }

  async getByProjectId(projectId: string): Promise<QuantityTakeoffItem[]> {
    return this.load().filter((i) => i.projectId === projectId);
  }

  async getById(id: string): Promise<QuantityTakeoffItem | null> {
    return this.load().find((i) => i.id === id) ?? null;
  }

  async create(input: CreateTakeoffItemInput): Promise<QuantityTakeoffItem> {
    const now = new Date().toISOString();
    const item: QuantityTakeoffItem = {
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
    data: Partial<QuantityTakeoffItem>
  ): Promise<QuantityTakeoffItem> {
    const items = this.load();
    const index = items.findIndex((i) => i.id === id);
    if (index === -1) throw new Error(`Takeoff item ${id} not found`);
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

export const takeoffRepository = new LocalTakeoffRepository();
