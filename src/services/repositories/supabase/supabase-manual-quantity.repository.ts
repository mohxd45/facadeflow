import { getSupabaseClient } from "@/services/supabase/client";
import type { ManualQuantityItem, CreateManualQuantityInput } from "@/types/validation";
import {
  manualQuantityFromDB,
  manualQuantityToDB,
  manualQuantityUpdateToDB,
} from "./supabase-mappers";

const TABLE = "manual_quantities";

export class SupabaseManualQuantityRepository {
  async getAll(): Promise<ManualQuantityItem[]> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(`[manual_quantities] getAll: ${error.message}`);
    return (data ?? []).map(manualQuantityFromDB);
  }

  async getByProjectId(projectId: string): Promise<ManualQuantityItem[]> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error)
      throw new Error(`[manual_quantities] getByProjectId: ${error.message}`);
    return (data ?? []).map(manualQuantityFromDB);
  }

  async create(input: CreateManualQuantityInput): Promise<ManualQuantityItem> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .insert(manualQuantityToDB(input))
      .select()
      .single();
    if (error) throw new Error(`[manual_quantities] create: ${error.message}`);
    return manualQuantityFromDB(data);
  }

  async update(
    id: string,
    payload: Partial<ManualQuantityItem>
  ): Promise<ManualQuantityItem> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .update(manualQuantityUpdateToDB(payload))
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`[manual_quantities] update: ${error.message}`);
    return manualQuantityFromDB(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from(TABLE)
      .delete()
      .eq("id", id);
    if (error) throw new Error(`[manual_quantities] delete: ${error.message}`);
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from(TABLE)
      .delete()
      .eq("project_id", projectId);
    if (error)
      throw new Error(
        `[manual_quantities] deleteByProjectId: ${error.message}`
      );
  }
}
