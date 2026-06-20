import { create } from "zustand";
import type {
  QuantityTakeoffItem,
  CreateTakeoffItemInput,
} from "@/types/takeoff";
import { takeoffRepository } from "@/services/repositories/local/takeoff.local";

interface TakeoffState {
  items: QuantityTakeoffItem[];
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  createItem: (input: CreateTakeoffItemInput) => Promise<QuantityTakeoffItem>;
  updateItem: (
    id: string,
    data: Partial<QuantityTakeoffItem>
  ) => Promise<QuantityTakeoffItem>;
  deleteItem: (id: string) => Promise<void>;
}

export const useTakeoffStore = create<TakeoffState>((set, get) => ({
  items: [],
  isHydrated: false,

  hydrate: async () => {
    const items = (await takeoffRepository.getAll()).map((i) => ({
      ...i,
      drawingViewType: i.drawingViewType ?? "plan",
      unit: normaliseUnit(i.unit),
    }));
    set({ items, isHydrated: true });
  },

  createItem: async (input) => {
    const item = await takeoffRepository.create(input);
    set({ items: [...get().items, item] });
    return item;
  },

  updateItem: async (id, data) => {
    const item = await takeoffRepository.update(id, data);
    set({
      items: get().items.map((i) => (i.id === id ? item : i)),
    });
    return item;
  },

  deleteItem: async (id) => {
    await takeoffRepository.delete(id);
    set({ items: get().items.filter((i) => i.id !== id) });
  },
}));

/** Normalise legacy unit values from older localStorage data to current presets. */
function normaliseUnit(unit: string): string {
  switch (unit) {
    case "m²":
    case "M2":
    case "SQM":
      return "sqm";
    case "m":
    case "lm":
    case "LM":
      return "lm";
    case "nr":
    case "NOS":
    case "nos":
      return "nos";
    default:
      return unit;
  }
}
