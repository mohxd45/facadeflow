"use client";

import { useState, useCallback, useMemo } from "react";
import type { DrawingFile } from "@/types/drawing";
import type { TakeoffSuggestion } from "@/services/analysis/rule-based-takeoff";
import { resolveDrawingBlob } from "@/services/file/drawing-blob-resolver";
import { useTakeoffStore } from "@/stores/takeoff-store";

export type AnalysisState =
  | { status: "idle" }
  | { status: "extracting" }
  | { status: "analysing" }
  | { status: "done"; suggestions: TakeoffSuggestion[] }
  | { status: "error"; message: string };

export function usePdfAnalysis(projectId: string) {
  const [state, setState] = useState<AnalysisState>({ status: "idle" });
  const [activeDrawing, setActiveDrawing] = useState<DrawingFile | null>(null);

  // Select the raw items array — never use getItemsByProjectId() as a selector
  // because it returns a new filtered array every call, triggering the React
  // "getSnapshot should be cached" infinite-loop warning.
  const allItems = useTakeoffStore((s) => s.items);

  const existingItemCodes = useMemo(
    () =>
      allItems
        .filter((i) => i.projectId === projectId)
        .map((i) => i.itemCode),
    [allItems, projectId]
  );

  const analyse = useCallback(
    async (drawing: DrawingFile) => {
      if (drawing.fileType !== "pdf") {
        setState({
          status: "error",
          message: "PDF analysis is only available for PDF files.",
        });
        setActiveDrawing(drawing);
        return;
      }

      if (drawing.fileSize > 250 * 1024 * 1024) {
        setState({
          status: "error",
          message:
            "This file is too large to analyse in the browser (> 250 MB). Upload a smaller PDF or process it on the backend.",
        });
        setActiveDrawing(drawing);
        return;
      }

      setActiveDrawing(drawing);
      setState({ status: "extracting" });

      try {
        // 1. Resolve blob — handles IndexedDB, Supabase Storage, previewUrl
        const file = await resolveDrawingBlob(drawing);

        // 2. Extract text — dynamic import keeps pdfjs out of the SSR bundle
        const { extractPdfText } = await import(
          "@/services/pdf/pdf-text-extractor"
        );
        const extraction = await extractPdfText(file);

        if (extraction.error) {
          setState({ status: "error", message: extraction.error });
          return;
        }

        if (extraction.isLikelyScanned) {
          setState({ status: "done", suggestions: [] });
          return;
        }

        // 4. Run rule-based analyser
        setState({ status: "analysing" });
        const { analyzeTextForTakeoff } = await import(
          "@/services/analysis/rule-based-takeoff"
        );
        const suggestions = analyzeTextForTakeoff(extraction.text, {
          drawingId: drawing.id,
          projectId,
          existingItemCodes,
        });

        setState({ status: "done", suggestions });
      } catch (err) {
        setState({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "Analysis failed unexpectedly.",
        });
      }
    },
    [projectId, existingItemCodes]
  );

  const reset = useCallback(() => {
    setState({ status: "idle" });
    setActiveDrawing(null);
  }, []);

  return { state, activeDrawing, analyse, reset };
}
