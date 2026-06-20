/**
 * Local (localStorage) repository for ItemCodeRule — Phase 2
 */

import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import { generateId } from "@/lib/utils";
import type { ItemCodeRule } from "@/types/code-takeoff";
import { DEFAULT_CODE_RULES } from "@/types/code-takeoff";

export class LocalCodeRuleRepository {
  private load(): ItemCodeRule[] {
    return readJson<ItemCodeRule[]>(STORAGE_KEYS.itemCodeRules, []);
  }

  private save(rules: ItemCodeRule[]): void {
    writeJson(STORAGE_KEYS.itemCodeRules, rules);
  }

  /**
   * Return all rules. If no rules are stored yet, seeds defaults first.
   * Also applies schema migrations for known incorrect default values.
   */
  async getAll(): Promise<ItemCodeRule[]> {
    let rules = this.load();
    if (rules.length === 0) {
      rules = [...DEFAULT_CODE_RULES];
      this.save(rules);
      return rules;
    }

    // Migration: fix SCR default rule — was wrongly set to "acp_cladding"
    let dirty = false;
    rules = rules.map((r) => {
      if (r.id === "default-SCR" && r.category === "acp_cladding") {
        dirty = true;
        return {
          ...r,
          category: "screen" as const,
          calculationMethod: "entered_area" as const,
          description: "Architectural screen panel. Enter area directly.",
          updatedAt: new Date().toISOString(),
        };
      }
      return r;
    });
    if (dirty) this.save(rules);

    return rules;
  }

  async getById(id: string): Promise<ItemCodeRule | null> {
    return this.load().find((r) => r.id === id) ?? null;
  }

  async create(input: Omit<ItemCodeRule, "id" | "createdAt" | "updatedAt">): Promise<ItemCodeRule> {
    const now = new Date().toISOString();
    const rule: ItemCodeRule = { ...input, id: generateId(), createdAt: now, updatedAt: now };
    const rules = this.load();
    rules.push(rule);
    this.save(rules);
    return rule;
  }

  async update(id: string, data: Partial<ItemCodeRule>): Promise<ItemCodeRule> {
    const rules = this.load();
    const idx = rules.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`ItemCodeRule ${id} not found`);
    rules[idx] = { ...rules[idx], ...data, updatedAt: new Date().toISOString() };
    this.save(rules);
    return rules[idx];
  }

  async delete(id: string): Promise<void> {
    const rules = this.load();
    const rule = rules.find((r) => r.id === id);
    if (rule?.isDefault) throw new Error("Cannot delete a default rule. Disable it instead.");
    this.save(rules.filter((r) => r.id !== id));
  }

  /**
   * Replace all user-added rules and restore defaults.
   * Preserves isActive state of default rules if already stored.
   */
  async resetToDefaults(): Promise<ItemCodeRule[]> {
    const existing = this.load();
    const existingStateById = new Map(existing.map((r) => [r.id, r]));

    // Merge: restore defaults with their current active/inactive state
    const merged: ItemCodeRule[] = DEFAULT_CODE_RULES.map((def) => {
      const stored = existingStateById.get(def.id);
      return stored ? { ...def, isActive: stored.isActive } : def;
    });
    this.save(merged);
    return merged;
  }

  /**
   * Find the best matching rule for an item code.
   * Longest prefix wins; case-insensitive.
   * e.g. "A/FIN-01" matches "A/FIN" before "A".
   */
  async findMatchingRule(itemCode: string): Promise<ItemCodeRule | null> {
    const rules = await this.getAll();
    const active = rules.filter((r) => r.isActive);
    const upper = itemCode.toUpperCase();

    let best: ItemCodeRule | null = null;
    for (const rule of active) {
      const prefix = rule.codePrefix.toUpperCase();
      // Match if code starts with prefix and next char is end, '-', '/', or digit
      if (upper === prefix || upper.startsWith(prefix + "-") || upper.startsWith(prefix + "/")) {
        if (!best || rule.codePrefix.length > best.codePrefix.length) {
          best = rule;
        }
      }
    }
    return best;
  }
}

export const codeRuleRepository = new LocalCodeRuleRepository();
