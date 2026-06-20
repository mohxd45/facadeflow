import { getSupabaseClient } from "@/services/supabase/client";
import type { CadLayerMapping, CreateLayerMappingInput } from "@/types/cad";
import type { ILayerMappingRepository } from "../layer-mapping.repository";
import {
  layerMappingFromDB,
  layerMappingToDB,
  layerMappingUpdateToDB,
} from "./supabase-mappers";

const TABLE = "layer_mappings";

export class SupabaseLayerMappingRepository implements ILayerMappingRepository {
  async getAll(): Promise<CadLayerMapping[]> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .order("layer_name");
    if (error) throw new Error(`[layer_mappings] getAll: ${error.message}`);
    return (data ?? []).map(layerMappingFromDB);
  }

  async getByProjectId(projectId: string): Promise<CadLayerMapping[]> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("layer_name");
    if (error)
      throw new Error(`[layer_mappings] getByProjectId: ${error.message}`);
    return (data ?? []).map(layerMappingFromDB);
  }

  async getById(id: string): Promise<CadLayerMapping | null> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`[layer_mappings] getById: ${error.message}`);
    return data ? layerMappingFromDB(data) : null;
  }

  async create(input: CreateLayerMappingInput): Promise<CadLayerMapping> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .insert(layerMappingToDB(input))
      .select()
      .single();
    if (error) throw new Error(`[layer_mappings] create: ${error.message}`);
    return layerMappingFromDB(data);
  }

  async update(
    id: string,
    payload: Partial<CadLayerMapping>
  ): Promise<CadLayerMapping> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .update(layerMappingUpdateToDB(payload))
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`[layer_mappings] update: ${error.message}`);
    return layerMappingFromDB(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from(TABLE)
      .delete()
      .eq("id", id);
    if (error) throw new Error(`[layer_mappings] delete: ${error.message}`);
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from(TABLE)
      .delete()
      .eq("project_id", projectId);
    if (error)
      throw new Error(`[layer_mappings] deleteByProjectId: ${error.message}`);
  }
}
