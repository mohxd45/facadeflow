import type { CadLayerMapping, CreateLayerMappingInput } from "@/types/cad";

export interface ILayerMappingRepository {
  getAll(): Promise<CadLayerMapping[]>;
  getByProjectId(projectId: string): Promise<CadLayerMapping[]>;
  getById(id: string): Promise<CadLayerMapping | null>;
  create(input: CreateLayerMappingInput): Promise<CadLayerMapping>;
  update(id: string, data: Partial<CadLayerMapping>): Promise<CadLayerMapping>;
  delete(id: string): Promise<void>;
  deleteByProjectId(projectId: string): Promise<void>;
}
