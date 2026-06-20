import { create } from "zustand";
import type {
  DrawingIssueItem,
  CreateDrawingIssueItemInput,
} from "@/types/drawing-takeoff";
import { drawingIssueRepository } from "@/services/repositories/local/local-drawing-issue.repository";

interface DrawingIssueState {
  items: DrawingIssueItem[];
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  addItem: (input: CreateDrawingIssueItemInput) => Promise<DrawingIssueItem>;
  addItems: (
    inputs: CreateDrawingIssueItemInput[]
  ) => Promise<DrawingIssueItem[]>;
  updateItem: (
    id: string,
    data: Partial<DrawingIssueItem>
  ) => Promise<DrawingIssueItem>;
  deleteItem: (id: string) => Promise<void>;
  clearProject: (projectId: string) => Promise<void>;
}

export const useDrawingIssueStore = create<DrawingIssueState>((set, get) => ({
  items: [],
  isHydrated: false,

  hydrate: async () => {
    const items = await drawingIssueRepository.getAll();
    set({ items, isHydrated: true });
  },

  addItem: async (input) => {
    const item = await drawingIssueRepository.create(input);
    set({ items: [...get().items, item] });
    return item;
  },

  addItems: async (inputs) => {
    const created = await drawingIssueRepository.createMany(inputs);
    set({ items: [...get().items, ...created] });
    return created;
  },

  updateItem: async (id, data) => {
    const item = await drawingIssueRepository.update(id, data);
    set({ items: get().items.map((i) => (i.id === id ? item : i)) });
    return item;
  },

  deleteItem: async (id) => {
    await drawingIssueRepository.delete(id);
    set({ items: get().items.filter((i) => i.id !== id) });
  },

  clearProject: async (projectId) => {
    await drawingIssueRepository.deleteByProjectId(projectId);
    set({ items: get().items.filter((i) => i.projectId !== projectId) });
  },
}));
