import { create } from "zustand";
import type { ItemCodeRule } from "@/types/code-takeoff";
import { codeRuleRepository } from "@/services/repositories/local/local-code-rule.repository";

interface CodeRuleState {
  rules: ItemCodeRule[];
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  addRule: (input: Omit<ItemCodeRule, "id" | "createdAt" | "updatedAt">) => Promise<ItemCodeRule>;
  updateRule: (id: string, data: Partial<ItemCodeRule>) => Promise<ItemCodeRule>;
  deleteRule: (id: string) => Promise<void>;
  toggleActive: (id: string) => Promise<void>;
  resetToDefaults: () => Promise<void>;
  findMatchingRule: (itemCode: string) => ItemCodeRule | null;
}

export const useCodeRuleStore = create<CodeRuleState>((set, get) => ({
  rules: [],
  isHydrated: false,

  hydrate: async () => {
    const rules = await codeRuleRepository.getAll();
    set({ rules, isHydrated: true });
  },

  addRule: async (input) => {
    const rule = await codeRuleRepository.create(input);
    set({ rules: [...get().rules, rule] });
    return rule;
  },

  updateRule: async (id, data) => {
    const rule = await codeRuleRepository.update(id, data);
    set({ rules: get().rules.map((r) => (r.id === id ? rule : r)) });
    return rule;
  },

  deleteRule: async (id) => {
    await codeRuleRepository.delete(id);
    set({ rules: get().rules.filter((r) => r.id !== id) });
  },

  toggleActive: async (id) => {
    const rule = get().rules.find((r) => r.id === id);
    if (!rule) return;
    await get().updateRule(id, { isActive: !rule.isActive });
  },

  resetToDefaults: async () => {
    const rules = await codeRuleRepository.resetToDefaults();
    set({ rules });
  },

  findMatchingRule: (itemCode: string): ItemCodeRule | null => {
    const active = get().rules.filter((r) => r.isActive);
    const upper = itemCode.toUpperCase();
    let best: ItemCodeRule | null = null;
    for (const rule of active) {
      const prefix = rule.codePrefix.toUpperCase();
      if (
        upper === prefix ||
        upper.startsWith(prefix + "-") ||
        upper.startsWith(prefix + "/")
      ) {
        if (!best || rule.codePrefix.length > best.codePrefix.length) {
          best = rule;
        }
      }
    }
    return best;
  },
}));
