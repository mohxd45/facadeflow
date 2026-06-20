import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import type { Project, CreateProjectInput } from "@/types/project";
import type { IProjectRepository } from "../project.repository";

export class LocalProjectRepository implements IProjectRepository {
  private load(): Project[] {
    return readJson<Project[]>(STORAGE_KEYS.projects, []);
  }

  private save(projects: Project[]): void {
    writeJson(STORAGE_KEYS.projects, projects);
  }

  async getAll(): Promise<Project[]> {
    return this.load().sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async getById(id: string): Promise<Project | null> {
    return this.load().find((p) => p.id === id) ?? null;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = {
      id: generateId(),
      name: input.name,
      clientName: input.clientName,
      location: input.location,
      description: input.description,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const projects = this.load();
    projects.push(project);
    this.save(projects);
    return project;
  }

  async update(id: string, data: Partial<Project>): Promise<Project> {
    const projects = this.load();
    const index = projects.findIndex((p) => p.id === id);
    if (index === -1) throw new Error(`Project ${id} not found`);
    projects[index] = {
      ...projects[index],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    this.save(projects);
    return projects[index];
  }

  async delete(id: string): Promise<void> {
    this.save(this.load().filter((p) => p.id !== id));
  }
}

export const projectRepository = new LocalProjectRepository();
