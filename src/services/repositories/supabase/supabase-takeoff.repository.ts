import { getSupabaseClient } from "@/services/supabase/client";
import type { QuantityTakeoffItem, CreateTakeoffItemInput } from "@/types/takeoff";
import type { ITakeoffRepository } from "../takeoff.repository";
import {
  takeoffFromDB,
  takeoffToDB,
  takeoffUpdateToDB,
} from "./supabase-mappers";

const TABLE = "quantity_takeoff_items";

export class SupabaseTakeoffRepository implements ITakeoffRepository {
  async getAll(): Promise<QuantityTakeoffItem[]> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(`[takeoff] getAll: ${error.message}`);
    return (data ?? []).map(takeoffFromDB);
  }

  async getByProjectId(projectId: string): Promise<QuantityTakeoffItem[]> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`[takeoff] getByProjectId: ${error.message}`);
    return (data ?? []).map(takeoffFromDB);
  }

  async getById(id: string): Promise<QuantityTakeoffItem | null> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`[takeoff] getById: ${error.message}`);
    return data ? takeoffFromDB(data) : null;
  }

  async create(input: CreateTakeoffItemInput): Promise<QuantityTakeoffItem> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .insert(takeoffToDB(input))
      .select()
      .single();
    if (error) throw new Error(`[takeoff] create: ${error.message}`);
    return takeoffFromDB(data);
  }

  async update(
    id: string,
    payload: Partial<QuantityTakeoffItem>
  ): Promise<QuantityTakeoffItem> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .update(takeoffUpdateToDB(payload))
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`[takeoff] update: ${error.message}`);
    return takeoffFromDB(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from(TABLE)
      .delete()
      .eq("id", id);
    if (error) throw new Error(`[takeoff] delete: ${error.message}`);
  }

  async deleteByProjectId(projectId: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from(TABLE)
      .delete()
      .eq("project_id", projectId);
    if (error) throw new Error(`[takeoff] deleteByProjectId: ${error.message}`);
  }
}
