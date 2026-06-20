import { create } from "zustand";
import type { Project, CreateProjectInput } from "@/types/project";
import { projectRepository } from "@/services/repositories/local/project.local";

interface ProjectState {
  projects: Project[];
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, data: Partial<Project>) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  isHydrated: false,

  hydrate: async () => {
    const projects = await projectRepository.getAll();
    set({ projects, isHydrated: true });
  },

  createProject: async (input) => {
    const project = await projectRepository.create(input);
    set({ projects: [project, ...get().projects] });
    return project;
  },

  updateProject: async (id, data) => {
    const project = await projectRepository.update(id, data);
    set({
      projects: get().projects.map((p) => (p.id === id ? project : p)),
    });
    return project;
  },

  deleteProject: async (id) => {
    await projectRepository.delete(id);
    set({ projects: get().projects.filter((p) => p.id !== id) });
  },
}));
