/**
 * AI Visual Detection Gateway — Phase 6E
 *
 * Client-safe gateway for calling /api/ai-visual-detection.
 * Never reads API keys; falls back to local mock on route/network failures.
 */

import type {
  AiVisualDetectionResult,
  AiVisualReviewInput,
} from "@/types/drawing-intelligence";
import { runMockAiVisualDetection } from "@/services/drawing-intelligence/ai-visual-detection.service";

export type AiVisualDetectionGatewayResult =
  | { source: "openai" | "mock" | "mock_fallback"; result: AiVisualDetectionResult; error: null }
  | { source: "mock_fallback"; result: AiVisualDetectionResult; error: string };

const VALID_SOURCE = new Set(["openai", "mock", "mock_fallback"]);

function isValidVisualDetectionResult(x: unknown): x is AiVisualDetectionResult {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.projectId !== "string" ||
    typeof r.summary !== "string" ||
    !Array.isArray(r.detections) ||
    !Array.isArray(r.warnings)
  ) {
    return false;
  }
  if (!r.runtimeMeta || typeof r.runtimeMeta !== "object") return false;
  const m = r.runtimeMeta as Record<string, unknown>;
  if (
    typeof m.source !== "string" ||
    !VALID_SOURCE.has(m.source) ||
    typeof m.modelUsed !== "string" ||
    typeof m.fallbackUsed !== "boolean"
  ) {
    return false;
  }
  return (r.detections as unknown[]).every((d) => {
    if (!d || typeof d !== "object") return false;
    const row = d as Record<string, unknown>;
    return (
      typeof row.id === "string" &&
      typeof row.aiConfidence === "number" &&
      typeof row.detectionType === "string" &&
      typeof row.status === "string" &&
      row.status !== "verified" &&
      row.status !== "final"
    );
  });
}

export async function runAiVisualDetectionViaGateway(
  input: AiVisualReviewInput
): Promise<AiVisualDetectionGatewayResult> {
  try {
    const resp = await fetch("/api/ai-visual-detection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Visual detection route returned ${resp.status}: ${text.slice(0, 200)}`);
    }
    const result = (await resp.json()) as AiVisualDetectionResult;
    if (!isValidVisualDetectionResult(result)) {
      throw new Error("Visual detection route returned unexpected response shape");
    }
    return {
      source: result.runtimeMeta.source,
      result,
      error: null,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown visual gateway error";
    const fallback = runMockAiVisualDetection(input);
    fallback.warnings.unshift(
      `AI visual gateway unavailable (${errorMessage}). Showing mock visual detections.`
    );
    fallback.runtimeMeta = {
      source: "mock_fallback",
      modelUsed: "gateway-local-visual-mock",
      fallbackUsed: true,
    };
    return {
      source: "mock_fallback",
      result: fallback,
      error: errorMessage,
    };
  }
}

