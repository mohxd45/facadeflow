/**
 * AI Review Gateway — Phase 5C (client-side)
 *
 * Calls the server-side /api/ai-review route handler and returns the result.
 * Falls back to the local mock service if the network call fails, the route
 * is unreachable, or the response cannot be parsed.
 *
 * The API key is NEVER touched here — it lives only on the server.
 * This file is safe to import in "use client" components.
 */

import type { AiReviewResult, AiReviewRunInput } from "@/types/ai-review";
import { runMockAiDrawingReview } from "@/services/ai-review/ai-drawing-review.service";

export type AiReviewGatewayResult =
  | { source: "openai" | "mock"; result: AiReviewResult; error: null }
  | { source: "mock_fallback"; result: AiReviewResult; error: string };

/**
 * Run AI Drawing Review via the server-side API route.
 * Falls back to mock on any network or parse failure.
 */
export async function runAiReviewViaGateway(
  input: AiReviewRunInput
): Promise<AiReviewGatewayResult> {
  try {
    const resp = await fetch("/api/ai-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`API route returned ${resp.status}: ${text.slice(0, 200)}`);
    }

    const result = (await resp.json()) as AiReviewResult;

    // Minimal sanity check before trusting the response
    if (
      typeof result?.id !== "string" ||
      typeof result?.projectId !== "string" ||
      !Array.isArray(result?.findings)
    ) {
      throw new Error("API route returned unexpected response shape");
    }

    // Determine actual source from presence of warning prefix added on fallback
    const usedFallback = result.warnings?.some(w =>
      w.startsWith("Real AI call failed")
    );

    return {
      source: usedFallback ? "mock" : "openai",
      result,
      error: null,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown gateway error";

    // Client-side mock fallback — no network needed
    const fallback = runMockAiDrawingReview(input);
    fallback.warnings.unshift(
      `AI gateway unavailable (${errorMessage}). Showing mock results.`
    );
    return {
      source: "mock_fallback",
      result: fallback,
      error: errorMessage,
    };
  }
}
