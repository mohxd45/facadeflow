import type { Project, CreateProjectInput } from "@/types/project";

/**
 * Repository boundary for projects.
 * v1: LocalStorage implementation.
 * Future: Supabase `projects` table via SupabaseProjectRepository.
 */
export interface IProjectRepository {
  getAll(): Promise<Project[]>;
  getById(id: string): Promise<Project | null>;
  create(input: CreateProjectInput): Promise<Project>;
  update(id: string, data: Partial<Project>): Promise<Project>;
  delete(id: string): Promise<void>;
}
