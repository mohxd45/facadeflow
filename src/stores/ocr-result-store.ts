import { create } from "zustand";
import type { DrawingOcrResult, CreateDrawingOcrResultInput } from "@/types/ocr";
import { ocrResultRepository } from "@/services/repositories/local/local-ocr-result.repository";

interface OcrResultState {
  results: DrawingOcrResult[];
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  getByDrawingId: (drawingId: string) => DrawingOcrResult[];
  getByProjectId: (projectId: string) => DrawingOcrResult[];
  saveForDrawing: (
    drawingId: string,
    inputs: CreateDrawingOcrResultInput[]
  ) => Promise<DrawingOcrResult[]>;
  deleteByDrawingId: (drawingId: string) => Promise<void>;
}

export const useOcrResultStore = create<OcrResultState>((set, get) => ({
  results: [],
  isHydrated: false,

  hydrate: async () => {
    const results = await ocrResultRepository.getAll();
    set({ results, isHydrated: true });
  },

  getByDrawingId: (drawingId) =>
    get()
      .results.filter((r) => r.drawingId === drawingId)
      .sort((a, b) => a.pageNumber - b.pageNumber),

  /** Imperative lookup only — do not use inside Zustand selectors (returns new array). */
  getByProjectId: (projectId) =>
    get().results.filter((r) => r.projectId === projectId),

  saveForDrawing: async (drawingId, inputs) => {
    const created = await ocrResultRepository.replaceForDrawing(drawingId, inputs);
    set({
      results: [
        ...get().results.filter((r) => r.drawingId !== drawingId),
        ...created,
      ],
    });
    return created;
  },

  deleteByDrawingId: async (drawingId) => {
    await ocrResultRepository.deleteByDrawingId(drawingId);
    set({ results: get().results.filter((r) => r.drawingId !== drawingId) });
  },
}));
