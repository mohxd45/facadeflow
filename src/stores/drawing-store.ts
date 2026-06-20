import { create } from "zustand";
import type { DrawingFile } from "@/types/drawing";
import { getDrawingRepository } from "@/services/repositories/repository-factory";
import { deleteFileBlob } from "@/services/file/file-blob.store";
import { isSupabaseMode } from "@/lib/env";

interface DrawingState {
  drawings: DrawingFile[];
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  addDrawing: (drawing: DrawingFile) => void;
  updateDrawing: (id: string, data: Partial<DrawingFile>) => Promise<DrawingFile>;
  deleteDrawing: (id: string) => Promise<void>;
}

export const useDrawingStore = create<DrawingState>((set, get) => ({
  drawings: [],
  isHydrated: false,

  hydrate: async () => {
    const repo = getDrawingRepository();
    const drawings = (await repo.getAll()).map((d) => ({
      ...d,
      drawingViewType: d.drawingViewType ?? "plan",
    }));
    set({ drawings, isHydrated: true });
  },

  addDrawing: (drawing) => {
    set({ drawings: [drawing, ...get().drawings] });
  },

  updateDrawing: async (id, data) => {
    const repo = getDrawingRepository();
    const drawing = await repo.update(id, data);
    set({
      drawings: get().drawings.map((d) => (d.id === id ? drawing : d)),
    });
    return drawing;
  },

  deleteDrawing: async (id) => {
    const drawing = get().drawings.find((d) => d.id === id);

    // 1. Clean up local blob (IndexedDB)
    if (drawing?.hasLocalBlob) {
      try {
        await deleteFileBlob(id);
      } catch {
        // IndexedDB blob may not exist — ignore
      }
    }

    // 2. Revoke blob: object URL to free browser memory
    if (drawing?.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(drawing.previewUrl);
    }

    // 3. Delete from Supabase Storage when in supabase mode
    if (
      isSupabaseMode() &&
      drawing?.storagePath &&
      !drawing.storagePath.startsWith("local/") &&
      !drawing.storagePath.startsWith("queued/")
    ) {
      try {
        const { deleteDrawingFileFromSupabase } = await import(
          "@/services/file/supabase-upload.service"
        );
        await deleteDrawingFileFromSupabase(drawing.storagePath);
      } catch {
        // Log but do not block metadata deletion
        console.warn("Could not delete drawing file from Supabase Storage.");
      }
    }

    // 4. Delete metadata record
    const repo = getDrawingRepository();
    await repo.delete(id);
    set({ drawings: get().drawings.filter((d) => d.id !== id) });
  },
}));
