/**
 * AI Visual Detection Prompt Builder — Phase 6C
 *
 * Converts Phase 6B rendered visual evidence into a compact prompt payload
 * for vision-capable LLM calls. Raw CAD/PDF binaries are never included.
 */

import type {
  AiVisualReviewInput,
  DrawingVisualEvidence,
} from "@/types/drawing-intelligence";

export const DEFAULT_MAX_VISUAL_EVIDENCE_FOR_PROMPT = 6;

export interface AiVisualPromptEvidenceItem {
  evidenceId: string;
  drawingId: string;
  drawingName: string;
  page: number;
  sourceFileType: "pdf" | "dxf" | "dwg";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  imageDataUrl: string;
}

export interface BuildAiVisualPromptResult {
  systemPrompt: string;
  instructionText: string;
  evidenceItems: AiVisualPromptEvidenceItem[];
}

function toPromptEvidenceItem(e: DrawingVisualEvidence): AiVisualPromptEvidenceItem {
  return {
    evidenceId: e.id,
    drawingId: e.sourceDrawingId,
    drawingName: e.sourceDrawingName,
    page: e.sheet.page,
    sourceFileType: e.sourceFileType,
    mimeType: e.image.mimeType,
    width: e.image.width,
    height: e.image.height,
    imageDataUrl: e.imageDataUrl,
  };
}

/**
 * Build prompt payload for visual detection.
 * Only `renderStatus=ready` rendered images are included.
 */
export function buildAiVisualDetectionPrompt(
  input: AiVisualReviewInput,
  maxEvidence = DEFAULT_MAX_VISUAL_EVIDENCE_FOR_PROMPT
): BuildAiVisualPromptResult {
  const evidenceItems = input.evidence
    .filter((e) => e.renderStatus === "ready" && e.imageDataUrl.startsWith("data:image/"))
    .slice(0, Math.max(1, maxEvidence))
    .map(toPromptEvidenceItem);

  const systemPrompt = `You are a facade drawing visual detection assistant.
Your task: detect POSSIBLE facade elements from drawing images.

Hard rules:
- This is advisory only. Never treat detections as final quantities.
- Return JSON ONLY (no markdown, no explanations).
- Valid detectionType values:
  possible_window, possible_door, possible_sliding_door, possible_curtain_wall,
  possible_acp, possible_railing, possible_louver, possible_uncoded_opening,
  unknown_facade_element.
- Use status="possible" for all detections.
- Confidence must be a number between 0 and 1.
- If unsure, use unknown_facade_element with low confidence.
- Never include secrets or raw binary content in the response.

Required JSON schema:
{
  "summary": "string",
  "detections": [
    {
      "evidenceId": "string",
      "detectionType": "string",
      "confidence": 0.0,
      "note": "string",
      "region": { "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2 }
    }
  ],
  "warnings": ["string"]
}`;

  const instructionText = [
    `Project: ${input.projectId}`,
    `Evidence count: ${evidenceItems.length}`,
    "Evidence references (use evidenceId exactly):",
    ...evidenceItems.map(
      (e) =>
        `- evidenceId=${e.evidenceId}, drawingId=${e.drawingId}, drawingName=${e.drawingName}, page=${e.page}, format=${e.sourceFileType}, size=${e.width}x${e.height}`
    ),
    "Detect possible facade elements from each image. Keep detections conservative.",
  ].join("\n");

  return {
    systemPrompt,
    instructionText,
    evidenceItems,
  };
}

