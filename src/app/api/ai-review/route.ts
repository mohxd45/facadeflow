/**
 * AI Review API Route — Phase 5C
 *
 * Server-side Route Handler. The OpenAI API key is read from process.env and
 * NEVER returned to the browser or included in any response body.
 *
 * POST /api/ai-review
 *   Body: AiReviewRunInput (JSON)
 *   Returns: AiReviewResult (JSON)
 *
 * Provider selection (server env only):
 *   AI_REVIEW_PROVIDER=openai  → calls OpenAI API
 *   AI_REVIEW_PROVIDER=mock    → deterministic mock (default when key absent)
 *   (unset / anything else)    → mock fallback
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import type { AiReviewRunInput, AiReviewResult, AiReviewFinding } from "@/types/ai-review";
import { runMockAiDrawingReview } from "@/services/ai-review/ai-drawing-review.service";
import {
  buildAiReviewPrompt,
  DEFAULT_MAX_INPUT_CHARS,
} from "@/services/ai-review/ai-review-prompt-builder.service";

// ---------------------------------------------------------------------------
// Server-only env helpers — only accessed inside this route file
// ---------------------------------------------------------------------------

function getServerEnv() {
  return {
    provider: process.env.AI_REVIEW_PROVIDER ?? "mock",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.AI_REVIEW_MODEL ?? "gpt-5-mini",
    timeoutMs: parseInt(process.env.AI_REVIEW_TIMEOUT_MS ?? "30000", 10),
    maxInputChars: parseInt(
      process.env.AI_REVIEW_MAX_INPUT_CHARS ?? String(DEFAULT_MAX_INPUT_CHARS),
      10
    ),
  };
}

// ---------------------------------------------------------------------------
// OpenAI call (pure function — no imports from openai SDK to avoid bundle)
// ---------------------------------------------------------------------------

async function callOpenAi(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  apiKey: string,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        // GPT-5 family expects max_completion_tokens (not max_tokens).
        max_completion_tokens: 4096,
      }),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`OpenAI API error ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  return content;
}

// ---------------------------------------------------------------------------
// Parse and validate the LLM JSON response into AiReviewResult
// ---------------------------------------------------------------------------

const VALID_FINDING_TYPES = new Set([
  "false_positive", "missing_information", "suspicious_dimension", "source_conflict",
  "generic_code", "ocr_uncertain", "needs_schedule", "needs_elevation", "needs_section",
  "quantity_safe", "manual_verification_required", "failed_drawing", "boq_mismatch",
]);
const VALID_RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);
const VALID_ACTIONS = new Set([
  "keep_candidate", "reject_candidate", "send_to_missing_info",
  "mark_needs_verification", "request_manual_check", "no_action",
]);
const VALID_CONFIDENCE = new Set(["low", "medium", "high"]);

function parseLlmResponse(
  raw: string,
  projectId: string,
  candidateIds: Set<string>
): AiReviewResult {
  const now = new Date().toISOString();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("LLM returned non-JSON response");
  }

  if (typeof parsed.summary !== "string" || parsed.summary.trim().length === 0) {
    throw new Error("LLM response missing required 'summary' string");
  }
  if (!Array.isArray(parsed.findings)) {
    throw new Error("LLM response missing required 'findings' array");
  }
  const summary = parsed.summary.trim();
  const rawFindings = parsed.findings;
  const rawWarnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((w): w is string => typeof w === "string")
    : [];

  const findings: AiReviewFinding[] = [];

  for (const f of rawFindings) {
    if (typeof f !== "object" || f === null) continue;
    const r = f as Record<string, unknown>;

    const findingType = typeof r.findingType === "string" && VALID_FINDING_TYPES.has(r.findingType)
      ? r.findingType
      : null;
    if (!findingType) continue;

    const riskLevel =
      typeof r.riskLevel === "string" && VALID_RISK_LEVELS.has(r.riskLevel)
        ? r.riskLevel
        : null;

    const suggestedAction =
      typeof r.suggestedAction === "string" && VALID_ACTIONS.has(r.suggestedAction)
        ? r.suggestedAction
        : null;

    const confidence =
      typeof r.confidence === "string" && VALID_CONFIDENCE.has(r.confidence)
        ? r.confidence
        : null;

    const title = typeof r.title === "string" ? r.title.trim() : "";
    const message = typeof r.message === "string" ? r.message.trim() : "";
    const recommendation =
      typeof r.recommendation === "string" ? r.recommendation.trim() : "";

    if (!riskLevel || !suggestedAction || !confidence) continue;
    if (!title || !message || !recommendation) continue;

    const candidateId = typeof r.candidateId === "string" && candidateIds.has(r.candidateId)
      ? r.candidateId
      : undefined;

    findings.push({
      id: uuidv4(),
      projectId,
      candidateId,
      itemCode: typeof r.itemCode === "string" ? r.itemCode : undefined,
      normalizedItemCode: typeof r.normalizedItemCode === "string" ? r.normalizedItemCode : undefined,
      findingType: findingType as AiReviewFinding["findingType"],
      riskLevel: riskLevel as AiReviewFinding["riskLevel"],
      title: title.slice(0, 120),
      message: message.slice(0, 500),
      recommendation: recommendation.slice(0, 300),
      linkedEvidenceIds: Array.isArray(r.linkedEvidenceIds)
        ? r.linkedEvidenceIds.filter((e): e is string => typeof e === "string")
        : [],
      sourceDrawingNames: Array.isArray(r.sourceDrawingNames)
        ? r.sourceDrawingNames.filter((s): s is string => typeof s === "string")
        : [],
      sourcePages: Array.isArray(r.sourcePages)
        ? r.sourcePages.filter((p): p is number => typeof p === "number")
        : [],
      suggestedAction: suggestedAction as AiReviewFinding["suggestedAction"],
      confidence: confidence as AiReviewFinding["confidence"],
      createdAt: now,
    });
  }

  if (rawFindings.length > 0 && findings.length === 0) {
    throw new Error("LLM response findings failed strict validation");
  }

  const reviewedCandidateIds = findings
    .map(f => f.candidateId)
    .filter((id): id is string => typeof id === "string");

  return {
    id: uuidv4(),
    projectId,
    status: "completed",
    summary,
    findings,
    reviewedCandidateIds: Array.from(new Set(reviewedCandidateIds)),
    warnings: rawWarnings.slice(0, 20),
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  let input: AiReviewRunInput;
  try {
    input = (await req.json()) as AiReviewRunInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!input?.projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const { provider, apiKey, model, timeoutMs, maxInputChars } = getServerEnv();

  // Always fall back to mock when provider is not openai or key is missing
  const useOpenAi = provider === "openai" && apiKey.length > 0;

  if (!useOpenAi) {
    const result = runMockAiDrawingReview(input);
    result.runtimeMeta = {
      source: "mock",
      modelUsed: model,
      fallbackUsed: false,
    };
    return NextResponse.json(result);
  }

  // Build the prompt (server-side, structured text only)
  const { systemPrompt, userPrompt } = buildAiReviewPrompt(input, maxInputChars);

  const candidateIds = new Set(
    (input.crossDrawingResult?.candidates ?? []).map(c => c.id)
  );

  try {
    const rawResponse = await callOpenAi(systemPrompt, userPrompt, model, apiKey, timeoutMs);
    const result = parseLlmResponse(rawResponse, input.projectId, candidateIds);
    result.runtimeMeta = {
      source: "openai",
      modelUsed: model,
      fallbackUsed: false,
    };
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown AI error";
    // On failure, fall back to mock and include a warning
    const fallback = runMockAiDrawingReview(input);
    fallback.warnings.unshift(`Real AI call failed (${message}). Showing mock results.`);
    fallback.runtimeMeta = {
      source: "mock_fallback",
      modelUsed: model,
      fallbackUsed: true,
    };
    return NextResponse.json(fallback);
  }
}
