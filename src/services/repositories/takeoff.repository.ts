import type {
  QuantityTakeoffItem,
  CreateTakeoffItemInput,
} from "@/types/takeoff";

/**
 * Repository boundary for quantity takeoff items.
 * Future: Supabase `takeoff_items` table.
 */
export interface ITakeoffRepository {
  getAll(): Promise<QuantityTakeoffItem[]>;
  getByProjectId(projectId: string): Promise<QuantityTakeoffItem[]>;
  getById(id: string): Promise<QuantityTakeoffItem | null>;
  create(input: CreateTakeoffItemInput): Promise<QuantityTakeoffItem>;
  update(
    id: string,
    data: Partial<QuantityTakeoffItem>
  ): Promise<QuantityTakeoffItem>;
  delete(id: string): Promise<void>;
  deleteByProjectId(projectId: string): Promise<void>;
}
