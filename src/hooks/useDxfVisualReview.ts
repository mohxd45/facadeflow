/**
 * useDxfVisualReview — Phase 7
 *
 * Manages the DXF parse lifecycle for visual review.
 * Mirrors useDxfAnalysis but is independent (separate state).
 */

"use client";

import { useState, useCallback } from "react";
import type { DrawingFile } from "@/types/drawing";
import type { ParsedDxfDrawing } from "@/types/cad";
import { resolveDrawingBlob } from "@/services/file/drawing-blob-resolver";

export type DxfVisualReviewStatus = "idle" | "loading" | "done" | "error";

export interface DxfVisualReviewState {
  status: DxfVisualReviewStatus;
  result: ParsedDxfDrawing | null;
  message: string;
}

const IDLE: DxfVisualReviewState = { status: "idle", result: null, message: "" };
const CLIENT_LIMIT_BYTES = 100 * 1024 * 1024;

export function useDxfVisualReview() {
  const [state, setState] = useState<DxfVisualReviewState>(IDLE);
  const [activeDrawing, setActiveDrawing] = useState<DrawingFile | null>(null);
  const [initialHighlightLayers, setInitialHighlightLayers] = useState<string[]>([]);

  const review = useCallback(
    async (drawing: DrawingFile, highlightLayers: string[] = []) => {
      if (drawing.fileType !== "dxf") {
        setState({ status: "error", result: null, message: "Only DXF files can be visually reviewed." });
        return;
      }
      if (drawing.fileSize > CLIENT_LIMIT_BYTES) {
        setState({ status: "error", result: null, message: `DXF file is ${(drawing.fileSize / 1024 / 1024).toFixed(0)} MB — files over 100 MB require backend processing.` });
        return;
      }

      setActiveDrawing(drawing);
      setInitialHighlightLayers(highlightLayers);
      setState({ status: "loading", result: null, message: "Parsing DXF for visual review…" });

      try {
        // Resolve blob (IndexedDB → Supabase Storage → previewUrl)
        const file = await resolveDrawingBlob(drawing);

        const { parseDxfFile } = await import("@/services/dxf/dxf-parser.service");
        const result = await parseDxfFile(file, drawing.id);
        setState({ status: "done", result, message: "" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error during DXF visual review.";
        setState({ status: "error", result: null, message: msg });
      }
    },
    []
  );

  const reset = useCallback(() => {
    setActiveDrawing(null);
    setInitialHighlightLayers([]);
    setState(IDLE);
  }, []);

  return { state, activeDrawing, initialHighlightLayers, review, reset };
}
