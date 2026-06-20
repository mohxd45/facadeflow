import { create } from "zustand";
import type { CadLayerMapping, CreateLayerMappingInput } from "@/types/cad";
import { layerMappingRepository } from "@/services/repositories/local/local-layer-mapping.repository";

interface LayerMappingState {
  mappings: CadLayerMapping[];
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  createMapping: (input: CreateLayerMappingInput) => Promise<CadLayerMapping>;
  updateMapping: (id: string, data: Partial<CadLayerMapping>) => Promise<CadLayerMapping>;
  deleteMapping: (id: string) => Promise<void>;
  toggleEnabled: (id: string) => Promise<void>;
  /** Disable all mappings for projectId whose layer name matches noise patterns */
  bulkDisableNoiseLayers: (projectId: string) => Promise<number>;
}

export const useLayerMappingStore = create<LayerMappingState>((set, get) => ({
  mappings: [],
  isHydrated: false,

  hydrate: async () => {
    const mappings = await layerMappingRepository.getAll();
    set({ mappings, isHydrated: true });
  },

  createMapping: async (input) => {
    const mapping = await layerMappingRepository.create(input);
    set({ mappings: [...get().mappings, mapping] });
    return mapping;
  },

  updateMapping: async (id, data) => {
    const mapping = await layerMappingRepository.update(id, data);
    set({ mappings: get().mappings.map((m) => (m.id === id ? mapping : m)) });
    return mapping;
  },

  deleteMapping: async (id) => {
    await layerMappingRepository.delete(id);
    set({ mappings: get().mappings.filter((m) => m.id !== id) });
  },

  toggleEnabled: async (id) => {
    const m = get().mappings.find((m) => m.id === id);
    if (!m) return;
    await get().updateMapping(id, { enabled: !m.enabled });
  },

  bulkDisableNoiseLayers: async (projectId) => {
    // Lazy import to avoid circular dependency in store
    const { isNoiseLayer } = await import(
      "@/services/dxf/dxf-noise-filter"
    );
    const targets = get().mappings.filter(
      (m) => m.projectId === projectId && m.enabled && isNoiseLayer(m.layerName)
    );
    for (const m of targets) {
      await get().updateMapping(m.id, { enabled: false });
    }
    return targets.length;
  },
}));
