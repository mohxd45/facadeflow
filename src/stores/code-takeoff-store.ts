import { create } from "zustand";
import type { CodeTakeoffItem, CreateCodeTakeoffItemInput } from "@/types/code-takeoff";
import { codeTakeoffRepository } from "@/services/repositories/local/local-code-takeoff.repository";

interface CodeTakeoffState {
  items: CodeTakeoffItem[];
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  addItem: (input: CreateCodeTakeoffItemInput) => Promise<CodeTakeoffItem>;
  addItems: (inputs: CreateCodeTakeoffItemInput[]) => Promise<CodeTakeoffItem[]>;
  updateItem: (id: string, data: Partial<CodeTakeoffItem>) => Promise<CodeTakeoffItem>;
  deleteItem: (id: string) => Promise<void>;
}

export const useCodeTakeoffStore = create<CodeTakeoffState>((set, get) => ({
  items: [],
  isHydrated: false,

  hydrate: async () => {
    const items = await codeTakeoffRepository.getAll();
    set({ items, isHydrated: true });
  },

  addItem: async (input) => {
    const item = await codeTakeoffRepository.create(input);
    set({ items: [...get().items, item] });
    return item;
  },

  addItems: async (inputs) => {
    const created = await codeTakeoffRepository.createMany(inputs);
    set({ items: [...get().items, ...created] });
    return created;
  },

  updateItem: async (id, data) => {
    const item = await codeTakeoffRepository.update(id, data);
    set({ items: get().items.map((i) => (i.id === id ? item : i)) });
    return item;
  },

  deleteItem: async (id) => {
    await codeTakeoffRepository.delete(id);
    set({ items: get().items.filter((i) => i.id !== id) });
  },
}));
