/**
 * Local (localStorage) repository for AiReviewResult — Phase 5A
 *
 * Stores one review result per projectId. Re-running a review replaces the
 * previous result for that project.
 */

import { STORAGE_KEYS } from "@/lib/constants";
import { readJson, writeJson } from "@/lib/storage";
import type { AiReviewResult } from "@/types/ai-review";

type ReviewStore = Record<string, AiReviewResult>;

export class LocalAiReviewRepository {
  private load(): ReviewStore {
    return readJson<ReviewStore>(STORAGE_KEYS.aiReviewResults, {});
  }

  private save(store: ReviewStore): void {
    writeJson(STORAGE_KEYS.aiReviewResults, store);
  }

  /** Return the latest review result for a project, or null if none exists. */
  getByProjectId(projectId: string): AiReviewResult | null {
    return this.load()[projectId] ?? null;
  }

  /** Persist a review result, replacing any previous result for that project. */
  saveResult(result: AiReviewResult): void {
    const store = this.load();
    store[result.projectId] = {
      ...result,
      updatedAt: new Date().toISOString(),
    };
    this.save(store);
  }

  /** Remove the review result for a project. */
  deleteByProjectId(projectId: string): void {
    const store = this.load();
    delete store[projectId];
    this.save(store);
  }
}

export const aiReviewRepository = new LocalAiReviewRepository();
