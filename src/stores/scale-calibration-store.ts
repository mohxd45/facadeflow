import { create } from "zustand";
import type { DrawingScaleCalibration } from "@/types/calibration";
import { readJson, writeJson } from "@/lib/storage";

const STORAGE_KEY = "facade-takeoff:scale-calibrations";

interface ScaleCalibrationState {
  calibrations: DrawingScaleCalibration[];
  hydrate: () => void;
  getForDrawing: (drawingId: string) => DrawingScaleCalibration | undefined;
  save: (cal: DrawingScaleCalibration) => void;
  remove: (drawingId: string) => void;
}

export const useScaleCalibrationStore = create<ScaleCalibrationState>(
  (set, get) => ({
    calibrations: [],

    hydrate: () => {
      const stored = readJson<DrawingScaleCalibration[]>(STORAGE_KEY, []);
      set({ calibrations: stored });
    },

    getForDrawing: (drawingId) =>
      get().calibrations.find((c) => c.drawingId === drawingId),

    save: (cal) => {
      const next = [
        ...get().calibrations.filter((c) => c.drawingId !== cal.drawingId),
        cal,
      ];
      set({ calibrations: next });
      writeJson(STORAGE_KEY, next);
    },

    remove: (drawingId) => {
      const next = get().calibrations.filter((c) => c.drawingId !== drawingId);
      set({ calibrations: next });
      writeJson(STORAGE_KEY, next);
    },
  })
);
