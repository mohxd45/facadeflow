import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import type { CadLayerMapping, CreateLayerMappingInput } from "@/types/cad";
import type { ILayerMappingRepository } from "../layer-mapping.repository";

export class LocalLayerMappingRepository implements ILayerMappingRepository {
  private load(): CadLayerMapping[] {
    return readJson<CadLayerMapping[]>(STORAGE_KEYS.layerMappings, []);
  }

  private save(items: CadLayerMapping[]): void {
    writeJson(STORAGE_KEYS.layerMappings, items);
  }

  async getAll(): Promise<CadLayerMapping[]> {
    return this.load();
  }

  async getByProjectId(projectId: string): Promise<CadLayerMapping[]> {
    return this.load().filter((m) => m.projectId === projectId);
  }

  async getById(id: string): Promise<CadLayerMapping | null> {
    return this.load().find((m) => m.id === id) ?? null;
  }

  async create(input: CreateLayerMappingInput): Promise<CadLayerMapping> {
    const now = new Date().toISOString();
    const mapping: CadLayerMapping = { ...input, id: generateId(), createdAt: now, updatedAt: now };
    const items = this.load();
    items.push(mapping);
    this.save(items);
    return mapping;
  }

  async update(id: string, data: Partial<CadLayerMapping>): Promise<CadLayerMapping> {
    const items = this.load();
    const index = items.findIndex((m) => m.id === id);
    if (index === -1) throw new Error(`Layer mapping ${id} not found`);
    items[index] = { ...items[index], ...data, updatedAt: new Date().toISOString() };
    this.save(items);
    return items[index];
  }

  async delete(id: string): Promise<void> {
    this.save(this.load().filter((m) => m.id !== id));
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    this.save(this.load().filter((m) => m.projectId !== projectId));
  }
}

export const layerMappingRepository = new LocalLayerMappingRepository();
