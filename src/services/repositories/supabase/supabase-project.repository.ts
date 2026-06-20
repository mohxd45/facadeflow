import { getSupabaseClient } from "@/services/supabase/client";
import type { Project, CreateProjectInput } from "@/types/project";
import type { IProjectRepository } from "../project.repository";
import {
  projectFromDB,
  projectToDB,
  projectUpdateToDB,
} from "./supabase-mappers";

const TABLE = "projects";

export class SupabaseProjectRepository implements IProjectRepository {
  async getAll(): Promise<Project[]> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(`[projects] getAll: ${error.message}`);
    return (data ?? []).map(projectFromDB);
  }

  async getById(id: string): Promise<Project | null> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`[projects] getById: ${error.message}`);
    return data ? projectFromDB(data) : null;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .insert(projectToDB(input))
      .select()
      .single();
    if (error) throw new Error(`[projects] create: ${error.message}`);
    return projectFromDB(data);
  }

  async update(id: string, payload: Partial<Project>): Promise<Project> {
    const { data, error } = await getSupabaseClient()
      .from(TABLE)
      .update(projectUpdateToDB(payload))
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`[projects] update: ${error.message}`);
    return projectFromDB(data);
  }

  async delete(id: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from(TABLE)
      .delete()
      .eq("id", id);
    if (error) throw new Error(`[projects] delete: ${error.message}`);
  }
}
