import { create } from "zustand";
import type {
  DrawingTakeoffItem,
  CreateDrawingTakeoffItemInput,
} from "@/types/drawing-takeoff";
import { drawingTakeoffRepository } from "@/services/repositories/local/local-drawing-takeoff.repository";

interface DrawingTakeoffState {
  items: DrawingTakeoffItem[];
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  addItem: (
    input: CreateDrawingTakeoffItemInput
  ) => Promise<DrawingTakeoffItem>;
  addItems: (
    inputs: CreateDrawingTakeoffItemInput[]
  ) => Promise<DrawingTakeoffItem[]>;
  updateItem: (
    id: string,
    data: Partial<DrawingTakeoffItem>
  ) => Promise<DrawingTakeoffItem>;
  deleteItem: (id: string) => Promise<void>;
  clearProject: (projectId: string) => Promise<void>;
}

export const useDrawingTakeoffStore = create<DrawingTakeoffState>(
  (set, get) => ({
    items: [],
    isHydrated: false,

    hydrate: async () => {
      const items = await drawingTakeoffRepository.getAll();
      set({ items, isHydrated: true });
    },

    addItem: async (input) => {
      const item = await drawingTakeoffRepository.create(input);
      set({ items: [...get().items, item] });
      return item;
    },

    addItems: async (inputs) => {
      const created = await drawingTakeoffRepository.createMany(inputs);
      set({ items: [...get().items, ...created] });
      return created;
    },

    updateItem: async (id, data) => {
      const item = await drawingTakeoffRepository.update(id, data);
      set({ items: get().items.map((i) => (i.id === id ? item : i)) });
      return item;
    },

    deleteItem: async (id) => {
      await drawingTakeoffRepository.delete(id);
      set({ items: get().items.filter((i) => i.id !== id) });
    },

    clearProject: async (projectId) => {
      await drawingTakeoffRepository.deleteByProjectId(projectId);
      set({ items: get().items.filter((i) => i.projectId !== projectId) });
    },
  })
);
