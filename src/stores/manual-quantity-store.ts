import { create } from "zustand";
import type {
  ManualQuantityItem,
  CreateManualQuantityInput,
} from "@/types/validation";
import { manualQuantityRepository } from "@/services/repositories/local/manual-quantity.local";

interface ManualQuantityState {
  items: ManualQuantityItem[];
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  createItem: (input: CreateManualQuantityInput) => Promise<ManualQuantityItem>;
  updateItem: (
    id: string,
    data: Partial<ManualQuantityItem>
  ) => Promise<ManualQuantityItem>;
  deleteItem: (id: string) => Promise<void>;
}

export const useManualQuantityStore = create<ManualQuantityState>(
  (set, get) => ({
    items: [],
    isHydrated: false,

    hydrate: async () => {
      const items = await manualQuantityRepository.getAll();
      set({ items, isHydrated: true });
    },

    createItem: async (input) => {
      const item = await manualQuantityRepository.create(input);
      set({ items: [...get().items, item] });
      return item;
    },

    updateItem: async (id, data) => {
      const item = await manualQuantityRepository.update(id, data);
      set({
        items: get().items.map((i) => (i.id === id ? item : i)),
      });
      return item;
    },

    deleteItem: async (id) => {
      await manualQuantityRepository.delete(id);
      set({ items: get().items.filter((i) => i.id !== id) });
    },
  })
);
