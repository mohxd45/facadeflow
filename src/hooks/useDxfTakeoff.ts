/**
 * useDxfTakeoff — Phase 5
 *
 * Orchestrates the full DXF → quantity suggestion pipeline:
 *   idle → parsing → generating → done | error
 *
 * Reuses the same TakeoffSuggestion[] output type as usePdfAnalysis so the
 * existing SuggestionReviewModal works without changes.
 */

"use client";

import { useState, useCallback, useMemo } from "react";
import type { DrawingFile } from "@/types/drawing";
import type { TakeoffSuggestion } from "@/services/analysis/rule-based-takeoff";
import { useTakeoffStore } from "@/stores/takeoff-store";
import { useLayerMappingStore } from "@/stores/layer-mapping-store";
import { useScaleCalibrationStore } from "@/stores/scale-calibration-store";
import { resolveDrawingBlob } from "@/services/file/drawing-blob-resolver";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export type DxfTakeoffStatus = "idle" | "parsing" | "generating" | "done" | "error";

export interface DxfTakeoffState {
  status: DxfTakeoffStatus;
  suggestions: TakeoffSuggestion[];
  message: string;
}

const IDLE: DxfTakeoffState = { status: "idle", suggestions: [], message: "" };

const CLIENT_LIMIT_MB = 100;
const CLIENT_LIMIT_BYTES = CLIENT_LIMIT_MB * 1024 * 1024;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDxfTakeoff(projectId: string) {
  const allItems = useTakeoffStore((s) => s.items);
  const existingItemCodes = useMemo(
    () =>
      allItems
        .filter((i) => i.projectId === projectId)
        .map((i) => i.itemCode),
    [allItems, projectId]
  );

  const allMappings = useLayerMappingStore((s) => s.mappings);
  const layerMappings = useMemo(
    () => allMappings.filter((m) => m.projectId === projectId),
    [allMappings, projectId]
  );

  const getCalibration = useScaleCalibrationStore((s) => s.getForDrawing);

  const [state, setState] = useState<DxfTakeoffState>(IDLE);
  const [activeDrawing, setActiveDrawing] = useState<DrawingFile | null>(null);

  const generate = useCallback(
    async (drawing: DrawingFile) => {
      if (drawing.fileType !== "dxf") {
        setState({
          status: "error",
          suggestions: [],
          message: "Only DXF files can be used for CAD quantity suggestions.",
        });
        return;
      }

      if (drawing.fileSize > CLIENT_LIMIT_BYTES) {
        setState({
          status: "error",
          suggestions: [],
          message: `DXF file is ${(drawing.fileSize / 1024 / 1024).toFixed(0)} MB. Files over ${CLIENT_LIMIT_MB} MB require backend processing (not yet available in v1).`,
        });
        return;
      }

      setActiveDrawing(drawing);
      setState({ status: "parsing", suggestions: [], message: "Parsing DXF geometry…" });

      try {
        // ── Resolve blob (IndexedDB → Supabase Storage → previewUrl) ──
        const file = await resolveDrawingBlob(drawing);

        // ── Parse DXF ─────────────────────────────────────────────────
        const { parseDxfFile } = await import(
          "@/services/dxf/dxf-parser.service"
        );
        const parsed = await parseDxfFile(file, drawing.id);

        // ── Generate suggestions ─────────────────────────────────────
        setState({ status: "generating", suggestions: [], message: "Generating quantity suggestions…" });

        const { generateDxfTakeoffSuggestions } = await import(
          "@/services/dxf/dxf-takeoff-suggestion.service"
        );
        const calibration = getCalibration(drawing.id);
        const suggestions = generateDxfTakeoffSuggestions(parsed, {
          drawingId: drawing.id,
          projectId,
          existingItemCodes,
          layerMappings,
          calibration,
        });

        setState({ status: "done", suggestions, message: "" });
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Unknown error during DXF analysis.";
        setState({ status: "error", suggestions: [], message: msg });
      }
    },
    [projectId, existingItemCodes, layerMappings, getCalibration]
  );

  const reset = useCallback(() => {
    setActiveDrawing(null);
    setState(IDLE);
  }, []);

  return { state, activeDrawing, generate, reset };
}
