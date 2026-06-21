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
  | { source: "openai" | "mock" | "mock_fallback"; result: AiReviewResult; error: null }
  | { source: "mock_fallback"; result: AiReviewResult; error: string };

const VALID_STATUS = new Set(["not_started", "running", "completed", "failed"]);
const VALID_FINDING_TYPES = new Set([
  "false_positive",
  "missing_information",
  "suspicious_dimension",
  "source_conflict",
  "generic_code",
  "ocr_uncertain",
  "needs_schedule",
  "needs_elevation",
  "needs_section",
  "quantity_safe",
  "manual_verification_required",
  "failed_drawing",
  "boq_mismatch",
]);
const VALID_RISK = new Set(["low", "medium", "high", "critical"]);
const VALID_ACTIONS = new Set([
  "keep_candidate",
  "reject_candidate",
  "send_to_missing_info",
  "mark_needs_verification",
  "request_manual_check",
  "no_action",
]);
const VALID_CONFIDENCE = new Set(["low", "medium", "high"]);
const VALID_SOURCE = new Set(["openai", "mock", "mock_fallback"]);

function isValidAiReviewResult(result: unknown): result is AiReviewResult {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.projectId !== "string") return false;
  if (typeof r.summary !== "string") return false;
  if (typeof r.status !== "string" || !VALID_STATUS.has(r.status)) return false;
  if (!Array.isArray(r.findings) || !Array.isArray(r.warnings)) return false;

  const meta = r.runtimeMeta;
  if (!meta || typeof meta !== "object") return false;
  const runtimeMeta = meta as Record<string, unknown>;
  if (
    typeof runtimeMeta.source !== "string" ||
    !VALID_SOURCE.has(runtimeMeta.source) ||
    typeof runtimeMeta.modelUsed !== "string" ||
    typeof runtimeMeta.fallbackUsed !== "boolean"
  ) {
    return false;
  }

  return (r.findings as unknown[]).every((f) => {
    if (!f || typeof f !== "object") return false;
    const x = f as Record<string, unknown>;
    return (
      typeof x.id === "string" &&
      typeof x.projectId === "string" &&
      typeof x.title === "string" &&
      typeof x.message === "string" &&
      typeof x.recommendation === "string" &&
      typeof x.findingType === "string" &&
      VALID_FINDING_TYPES.has(x.findingType) &&
      typeof x.riskLevel === "string" &&
      VALID_RISK.has(x.riskLevel) &&
      typeof x.suggestedAction === "string" &&
      VALID_ACTIONS.has(x.suggestedAction) &&
      typeof x.confidence === "string" &&
      VALID_CONFIDENCE.has(x.confidence) &&
      Array.isArray(x.linkedEvidenceIds) &&
      Array.isArray(x.sourceDrawingNames) &&
      Array.isArray(x.sourcePages)
    );
  });
}

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

    // Strict sanity check before trusting the response
    if (!isValidAiReviewResult(result)) {
      throw new Error("API route returned unexpected response shape");
    }

    return {
      source: result.runtimeMeta!.source,
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
    fallback.runtimeMeta = {
      source: "mock_fallback",
      modelUsed: "gateway-local-mock",
      fallbackUsed: true,
    };
    return {
      source: "mock_fallback",
      result: fallback,
      error: errorMessage,
    };
  }
}
