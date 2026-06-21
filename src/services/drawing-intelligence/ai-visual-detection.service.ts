/**
 * AI Visual Facade Detection Service — Phase 6C
 *
 * Consumes Phase 6B rendered visual evidence and returns advisory detections.
 * Includes strict JSON parsing, sanitization, and mock fallback behavior.
 */

import { v4 as uuidv4 } from "uuid";
import type {
  AiVisualDetection,
  AiVisualDetectionResult,
  AiVisualReviewInput,
  DrawingRegion,
  DrawingSheetRef,
  DrawingVisualEvidence,
} from "@/types/drawing-intelligence";
import {
  buildAiVisualDetectionPrompt,
  DEFAULT_MAX_VISUAL_EVIDENCE_FOR_PROMPT,
  type AiVisualPromptEvidenceItem,
} from "@/services/drawing-intelligence/ai-visual-detection-prompt-builder.service";

const VALID_DETECTION_TYPES = new Set<AiVisualDetection["detectionType"]>([
  "possible_window",
  "possible_door",
  "possible_sliding_door",
  "possible_curtain_wall",
  "possible_acp",
  "possible_railing",
  "possible_louver",
  "possible_uncoded_opening",
  "unknown_facade_element",
]);

export interface VisualDetectionServerEnv {
  provider: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxEvidencePerCall: number;
}

export interface RunVisualDetectionOptions {
  env?: Partial<VisualDetectionServerEnv>;
  callOpenAiVision?: (
    systemPrompt: string,
    instructionText: string,
    evidenceItems: AiVisualPromptEvidenceItem[],
    model: string,
    apiKey: string,
    timeoutMs: number
  ) => Promise<string>;
}

export function getVisualDetectionServerEnv(): VisualDetectionServerEnv {
  const rawTimeout = parseInt(process.env.AI_REVIEW_TIMEOUT_MS ?? "30000", 10);
  const rawMaxEvidence = parseInt(process.env.AI_VISUAL_MAX_IMAGES ?? "6", 10);
  return {
    provider: process.env.AI_REVIEW_PROVIDER ?? "mock",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.AI_REVIEW_MODEL ?? "gpt-5-mini",
    timeoutMs:
      Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.min(rawTimeout, 120000) : 30000,
    maxEvidencePerCall:
      Number.isFinite(rawMaxEvidence) && rawMaxEvidence > 0
        ? Math.min(rawMaxEvidence, 12)
        : DEFAULT_MAX_VISUAL_EVIDENCE_FOR_PROMPT,
  };
}

function resolvedEnv(overrides?: Partial<VisualDetectionServerEnv>): VisualDetectionServerEnv {
  const base = getVisualDetectionServerEnv();
  return {
    ...base,
    ...overrides,
  };
}

function clamp01(v: unknown, fallback = 0.45): number {
  const n = typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Number(n.toFixed(3));
}

function clampRelative(v: unknown): number {
  const n = typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Number(n.toFixed(4))));
}

function sanitizeDetectionType(v: unknown): AiVisualDetection["detectionType"] {
  if (typeof v === "string" && VALID_DETECTION_TYPES.has(v as AiVisualDetection["detectionType"])) {
    return v as AiVisualDetection["detectionType"];
  }
  return "unknown_facade_element";
}

function buildSheetFromEvidence(e: DrawingVisualEvidence): DrawingSheetRef {
  return {
    drawingId: e.sourceDrawingId,
    drawingName: e.sourceDrawingName,
    sourceFormat: e.sourceFileType === "pdf" ? "pdf_text" : e.sourceFileType,
    page: Number.isFinite(e.sheet.page) && e.sheet.page > 0 ? e.sheet.page : 1,
  };
}

function sanitizeRegion(raw: unknown): DrawingRegion | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const width = clampRelative(r.width);
  const height = clampRelative(r.height);
  if (width <= 0 || height <= 0) return undefined;
  return {
    x: clampRelative(r.x),
    y: clampRelative(r.y),
    width,
    height,
    coordinateSpace: "relative",
  };
}

function buildResult(
  projectId: string,
  detections: AiVisualDetection[],
  warnings: string[],
  runtimeMeta: AiVisualDetectionResult["runtimeMeta"],
  summary: string
): AiVisualDetectionResult {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    projectId,
    summary,
    detections,
    warnings,
    runtimeMeta,
    createdAt: now,
    updatedAt: now,
  };
}

export function runMockAiVisualDetection(input: AiVisualReviewInput): AiVisualDetectionResult {
  const now = new Date().toISOString();
  const detections: AiVisualDetection[] = input.evidence.slice(0, 6).map((e, idx) => {
    const name = e.sourceDrawingName.toLowerCase();
    const detectionType: AiVisualDetection["detectionType"] = name.includes("door")
      ? "possible_door"
      : name.includes("window")
        ? "possible_window"
        : "unknown_facade_element";
    return {
      id: uuidv4(),
      sheet: buildSheetFromEvidence(e),
      detectionType,
      aiConfidence: detectionType === "unknown_facade_element" ? 0.35 : 0.55,
      note:
        detectionType === "unknown_facade_element"
          ? "Mock visual hint: possible facade element needs manual confirmation."
          : "Mock visual hint from rendered drawing image.",
      status: "possible",
      detectedAt: now,
      region: {
        x: 0.1 + (idx % 3) * 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.2,
        coordinateSpace: "relative",
      },
    };
  });

  return buildResult(
    input.projectId,
    detections,
    detections.length === 0 ? ["No rendered visual evidence available for detection."] : [],
    {
      source: "mock",
      modelUsed: "phase6c-mock-visual-detector",
      fallbackUsed: false,
    },
    detections.length > 0
      ? `Mock visual detection completed for ${detections.length} possible facade elements.`
      : "Mock visual detection found no eligible rendered evidence."
  );
}

export async function defaultCallOpenAiVision(
  systemPrompt: string,
  instructionText: string,
  evidenceItems: AiVisualPromptEvidenceItem[],
  model: string,
  apiKey: string,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
          {
            role: "user",
            content: [
              { type: "text", text: instructionText },
              ...evidenceItems.map((item) => ({
                type: "image_url",
                image_url: {
                  url: item.imageDataUrl,
                  detail: "low",
                },
              })),
            ],
          },
        ],
        max_completion_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("OpenAI returned malformed visual detection content");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export function parseAiVisualDetectionResponse(
  raw: string,
  input: AiVisualReviewInput
): AiVisualDetectionResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("LLM returned non-JSON response for visual detection");
  }

  if (!Array.isArray(parsed.detections)) {
    throw new Error("LLM response missing required detections array");
  }

  const evidenceById = new Map(input.evidence.map((e) => [e.id, e]));
  const detections: AiVisualDetection[] = [];
  const now = new Date().toISOString();

  for (const det of parsed.detections) {
    if (!det || typeof det !== "object") continue;
    const r = det as Record<string, unknown>;

    let evidence: DrawingVisualEvidence | undefined;
    if (typeof r.evidenceId === "string") {
      evidence = evidenceById.get(r.evidenceId);
    }
    if (!evidence && typeof r.drawingId === "string") {
      evidence = input.evidence.find(
        (e) =>
          e.sourceDrawingId === r.drawingId &&
          (typeof r.page === "number" ? e.sheet.page === r.page : true)
      );
    }
    if (!evidence) {
      evidence = input.evidence[0];
    }
    if (!evidence) continue;

    detections.push({
      id: uuidv4(),
      sheet: buildSheetFromEvidence(evidence),
      detectionType: sanitizeDetectionType(r.detectionType),
      aiConfidence: clamp01(r.confidence, 0.4),
      note: typeof r.note === "string" ? r.note.slice(0, 240) : undefined,
      region: sanitizeRegion(r.region),
      status: "possible",
      detectedAt: now,
      estimatedWidthM: typeof r.estimatedWidthM === "number" ? Math.max(0, r.estimatedWidthM) : undefined,
      estimatedHeightM:
        typeof r.estimatedHeightM === "number" ? Math.max(0, r.estimatedHeightM) : undefined,
    });
  }

  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((w): w is string => typeof w === "string").slice(0, 20)
    : [];
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim().length > 0
      ? parsed.summary.slice(0, 200)
      : `Detected ${detections.length} possible facade elements from rendered visual evidence.`;

  return buildResult(
    input.projectId,
    detections,
    warnings,
    {
      source: "openai",
      modelUsed: "unknown",
      fallbackUsed: false,
    },
    summary
  );
}

function ensureNoRawCadBinaryInPromptItems(evidenceItems: AiVisualPromptEvidenceItem[]): void {
  const hasUnsafe = evidenceItems.some(
    (e) =>
      (e.sourceFileType === "dxf" || e.sourceFileType === "dwg") &&
      !e.imageDataUrl.startsWith("data:image/")
  );
  if (hasUnsafe) {
    throw new Error("Unsafe visual payload: CAD evidence must be rendered image data URLs.");
  }
}

function assertNoUnsafeCadPayloadInInput(input: AiVisualReviewInput): void {
  const unsafe = input.evidence.find(
    (e) =>
      (e.sourceFileType === "dxf" || e.sourceFileType === "dwg") &&
      !e.imageDataUrl.startsWith("data:image/")
  );
  if (unsafe) {
    throw new Error(
      `Unsafe visual payload for ${unsafe.sourceFileType.toUpperCase()} drawing "${unsafe.sourceDrawingName}". Rendered image data URL is required.`
    );
  }
}

export async function runAiVisualDetection(
  input: AiVisualReviewInput,
  options?: RunVisualDetectionOptions
): Promise<AiVisualDetectionResult> {
  const env = resolvedEnv(options?.env);
  const useOpenAi = env.provider === "openai" && env.apiKey.length > 0;

  if (!useOpenAi) {
    const mockResult = runMockAiVisualDetection(input);
    if (env.provider === "openai" && env.apiKey.length === 0) {
      mockResult.warnings.unshift(
        "AI_REVIEW_PROVIDER=openai but OPENAI_API_KEY is missing. Using mock visual detector."
      );
    } else if (env.provider !== "openai" && env.provider !== "mock") {
      mockResult.warnings.unshift(
        `AI_REVIEW_PROVIDER=${env.provider} is unsupported for visual detection. Using mock visual detector.`
      );
    }
    return mockResult;
  }

  const callOpenAi = options?.callOpenAiVision ?? defaultCallOpenAiVision;
  try {
    assertNoUnsafeCadPayloadInInput(input);

    const { systemPrompt, instructionText, evidenceItems } = buildAiVisualDetectionPrompt(
      input,
      Math.min(env.maxEvidencePerCall, input.limits.maxPagesPerRun)
    );
    ensureNoRawCadBinaryInPromptItems(evidenceItems);

    const raw = await callOpenAi(
      systemPrompt,
      instructionText,
      evidenceItems,
      env.model,
      env.apiKey,
      env.timeoutMs
    );
    const parsed = parseAiVisualDetectionResponse(raw, input);
    parsed.runtimeMeta = {
      source: "openai",
      modelUsed: env.model,
      fallbackUsed: false,
    };
    // Phase 6C rule: visual detections are always suggestions.
    parsed.detections = parsed.detections.map((d) => ({ ...d, status: "possible" }));
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown visual detection error";
    const fallback = runMockAiVisualDetection(input);
    fallback.warnings.unshift(`Real visual AI call failed (${message}). Showing mock visual results.`);
    fallback.runtimeMeta = {
      source: "mock_fallback",
      modelUsed: env.model,
      fallbackUsed: true,
    };
    return fallback;
  }
}

export function aiVisualDetectionsAreAdvisoryOnly(
  detections: AiVisualDetection[]
): boolean {
  return detections.every((d) => d.status === "possible");
}

