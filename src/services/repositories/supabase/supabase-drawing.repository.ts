import { getSupabaseClient } from "@/services/supabase/client";
import type { DrawingFile, CreateDrawingInput } from "@/types/drawing";
import type { IDrawingRepository } from "../drawing.repository";
import {
  drawingFromDB,
  drawingToDB,
  drawingUpdateToDB,
} from "./supabase-mappers";

const TABLE = "drawings";

export class SupabaseDrawingRepository implements IDrawingRepository {
  async getAll(): Promise<DrawingFile[]> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .order("uploaded_at", { ascending: false });
    if (error) throw new Error(`[drawings] getAll: ${error.message}`);
    return (data ?? []).map(drawingFromDB);
  }

  async getByProjectId(projectId: string): Promise<DrawingFile[]> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("uploaded_at", { ascending: false });
    if (error) throw new Error(`[drawings] getByProjectId: ${error.message}`);
    return (data ?? []).map(drawingFromDB);
  }

  async getById(id: string): Promise<DrawingFile | null> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`[drawings] getById: ${error.message}`);
    return data ? drawingFromDB(data) : null;
  }

  async create(
    input: CreateDrawingInput & Partial<DrawingFile>
  ): Promise<DrawingFile> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .insert(drawingToDB(input))
      .select()
      .single();
    if (error) throw new Error(`[drawings] create: ${error.message}`);
    return drawingFromDB(data);
  }

  async update(id: string, payload: Partial<DrawingFile>): Promise<DrawingFile> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .update(drawingUpdateToDB(payload))
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`[drawings] update: ${error.message}`);
    return drawingFromDB(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from(TABLE)
      .delete()
      .eq("id", id);
    if (error) throw new Error(`[drawings] delete: ${error.message}`);
  }
}
