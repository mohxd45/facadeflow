/**
 * useDxfAnalysis — Phase 4
 *
 * Manages the lifecycle of a DXF structure inspection:
 *   idle → loading → done | error
 *
 * File blob retrieval mirrors usePdfAnalysis: check IndexedDB first,
 * then fall back to drawing.previewUrl.
 * Files above 100 MB are rejected client-side.
 */

"use client";

import { useState, useCallback } from "react";
import type { DrawingFile } from "@/types/drawing";
import type { ParsedDxfDrawing } from "@/types/cad";
import { resolveDrawingBlob } from "@/services/file/drawing-blob-resolver";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export type DxfAnalysisStatus = "idle" | "loading" | "done" | "error";

export interface DxfAnalysisState {
  status: DxfAnalysisStatus;
  result: ParsedDxfDrawing | null;
  message: string;
}

const IDLE: DxfAnalysisState = { status: "idle", result: null, message: "" };

const CLIENT_LIMIT_MB = 100;
const CLIENT_LIMIT_BYTES = CLIENT_LIMIT_MB * 1024 * 1024;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDxfAnalysis() {
  const [state, setState] = useState<DxfAnalysisState>(IDLE);
  const [activeDrawing, setActiveDrawing] = useState<DrawingFile | null>(null);

  const analyse = useCallback(async (drawing: DrawingFile) => {
    if (drawing.fileType !== "dxf") {
      setState({ status: "error", result: null, message: "Only DXF files can be analysed with this tool." });
      return;
    }

    if (drawing.fileSize > CLIENT_LIMIT_BYTES) {
      setState({
        status: "error",
        result: null,
        message: `This DXF file is ${(drawing.fileSize / 1024 / 1024).toFixed(0)} MB. Files over ${CLIENT_LIMIT_MB} MB require backend processing (not yet available in v1).`,
      });
      return;
    }

    setActiveDrawing(drawing);
    setState({ status: "loading", result: null, message: "Reading DXF file…" });

    try {
      // ---- Resolve blob (IndexedDB → Supabase Storage → previewUrl) --------
      const file = await resolveDrawingBlob(drawing);

      // ---- Parse ----------------------------------------------------------
      const { parseDxfFile } = await import("@/services/dxf/dxf-parser.service");
      const result = await parseDxfFile(file, drawing.id);

      setState({ status: "done", result, message: "" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error during DXF parsing.";
      setState({ status: "error", result: null, message: msg });
    }
  }, []);

  const reset = useCallback(() => {
    setActiveDrawing(null);
    setState(IDLE);
  }, []);

  return { state, activeDrawing, analyse, reset };
}
