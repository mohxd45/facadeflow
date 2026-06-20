/**
 * Zustand store for AI Review results — Phase 5A
 *
 * Design rules (matching existing store patterns):
 *  - Hydrates once; subsequent calls are no-ops.
 *  - Selectors return primitive values or stable object references.
 *  - No inline filtered arrays returned directly from selectors.
 *  - Store never mutates candidate quantities.
 */

import { create } from "zustand";
import type { AiReviewResult } from "@/types/ai-review";
import { aiReviewRepository } from "@/services/repositories/local/local-ai-review.repository";

interface AiReviewState {
  /** All loaded review results keyed by projectId */
  resultsByProject: Record<string, AiReviewResult>;
  isHydrated: boolean;

  /** Load all persisted results into the store (run once on app boot). */
  hydrate: () => void;

  /** Persist and cache a completed review result. */
  saveResult: (result: AiReviewResult) => void;

  /** Return the latest review result for a project (or null). */
  getResultForProject: (projectId: string) => AiReviewResult | null;

  /** Remove the review result for a project from the store and storage. */
  deleteResult: (projectId: string) => void;
}

export const useAiReviewStore = create<AiReviewState>((set, get) => ({
  resultsByProject: {},
  isHydrated: false,

  hydrate: () => {
    if (get().isHydrated) return;
    // localStorage is keyed per-project; load the raw store object directly.
    // We read the raw localStorage key so we don't need a getAll() method.
    if (typeof window === "undefined") {
      set({ isHydrated: true });
      return;
    }
    try {
      const raw = localStorage.getItem("facade-takeoff:ai-review-results");
      const parsed: Record<string, AiReviewResult> = raw
        ? (JSON.parse(raw) as Record<string, AiReviewResult>)
        : {};
      set({ resultsByProject: parsed, isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },

  saveResult: (result) => {
    aiReviewRepository.saveResult(result);
    set((state) => ({
      resultsByProject: {
        ...state.resultsByProject,
        [result.projectId]: {
          ...result,
          updatedAt: new Date().toISOString(),
        },
      },
    }));
  },

  getResultForProject: (projectId) => {
    return get().resultsByProject[projectId] ?? null;
  },

  deleteResult: (projectId) => {
    aiReviewRepository.deleteByProjectId(projectId);
    set((state) => {
      const next = { ...state.resultsByProject };
      delete next[projectId];
      return { resultsByProject: next };
    });
  },
}));
