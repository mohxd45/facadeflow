/**
 * AI Review Prompt Builder — Phase 5C
 *
 * Converts a structured AiReviewRunInput into a plain-text prompt suitable
 * for an LLM (OpenAI GPT-4o or similar).
 *
 * Design rules:
 *  - Never includes raw file bytes, blobs, or base64-encoded content.
 *  - Only structured metadata: item codes, dimensions, warnings, layer names,
 *    block names, text labels.
 *  - Output is truncated to AI_REVIEW_MAX_INPUT_CHARS to stay within context
 *    windows and avoid excessive token cost.
 *  - Deterministic for a given input (no random ordering).
 *  - Completely decoupled from the OpenAI client — returns plain strings only.
 */

import type {
  AiReviewRunInput,
  AiReviewDxfDrawingSummary,
} from "@/types/ai-review";
import type { CrossDrawingQuantityCandidate } from "@/types/cross-drawing-quantity";
import {
  candidateHasValueConflict,
  candidateIsOcrOnly,
  isGenericCode,
  candidateHasSuspiciousDimensionSignals,
  SUSPICIOUS_DIMENSION_WARNING_TEXT,
} from "@/services/drawing-package/cross-drawing-quantity-builder.service";

export const DEFAULT_MAX_INPUT_CHARS = 40_000;
const MAX_CANDIDATES_IN_PROMPT = 250;
const MAX_CANDIDATE_IDS_IN_PROMPT = 250;

// ---------------------------------------------------------------------------
// Item-code pattern for detecting codes in CAD text labels
// Matches: W-01, CW-06, SD-01, GL-01, WIN-01, etc.
// ---------------------------------------------------------------------------

const ITEM_CODE_RE = /\b([A-Z]{1,5}(?:\/[A-Z]+)?[-\s]?\d{1,3})\b/g;

export function detectItemCodesInText(labels: string[]): string[] {
  const codes = new Set<string>();
  for (const label of labels) {
    const upper = label.toUpperCase();
    let m: RegExpExecArray | null;
    ITEM_CODE_RE.lastIndex = 0;
    while ((m = ITEM_CODE_RE.exec(upper)) !== null) {
      codes.add(m[1].replace(/\s+/, "-"));
    }
  }
  return Array.from(codes).sort();
}

// ---------------------------------------------------------------------------
// Candidate summariser
// ---------------------------------------------------------------------------

function summariseCandidate(c: CrossDrawingQuantityCandidate): string {
  const parts: string[] = [`  - ${c.normalizedItemCode || c.itemCode}`];
  if (c.description) parts.push(`(${c.description})`);

  const dims: string[] = [];
  if (c.width !== undefined) dims.push(`W=${c.width}m`);
  if (c.height !== undefined) dims.push(`H=${c.height}m`);
  if (c.count !== undefined) dims.push(`count=${c.count}`);
  if (c.areaEach !== undefined) dims.push(`area/ea=${c.areaEach}sqm`);
  if (c.totalArea !== undefined) dims.push(`total=${c.totalArea}sqm`);
  if (dims.length) parts.push(`[${dims.join(", ")}]`);

  const flags: string[] = [];
  if (isGenericCode(c.itemCode)) flags.push("GENERIC_CODE");
  if (candidateHasValueConflict(c)) flags.push("CONFLICT");
  if (candidateIsOcrOnly(c)) flags.push("OCR_ONLY");
  if (candidateHasSuspiciousDimensionSignals(c, c.confidence)) flags.push("SUSPICIOUS_DIM");
  if (c.missingFields.length > 0) flags.push(`MISSING:${c.missingFields.join(",")}`);
  if (flags.length) parts.push(`{${flags.join("|")}}`);

  parts.push(`conf=${c.confidence} status=${c.status}`);

  if (c.sourceDrawingNames.length > 0) {
    parts.push(`sources=[${c.sourceDrawingNames.slice(0, 3).join(", ")}]`);
  }
  if (c.warnings.length > 0 && !c.warnings.every(w => w === SUSPICIOUS_DIMENSION_WARNING_TEXT)) {
    const shortened = c.warnings
      .filter(w => w !== SUSPICIOUS_DIMENSION_WARNING_TEXT)
      .slice(0, 2)
      .map(w => w.slice(0, 120));
    parts.push(`warnings=[${shortened.join("; ")}]`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// DXF summary section
// ---------------------------------------------------------------------------

function buildDxfSection(dxfEvidence: AiReviewDxfDrawingSummary[]): string {
  if (dxfEvidence.length === 0) return "";
  const lines: string[] = ["## CAD/DXF Evidence (structured metadata only — no raw geometry)"];
  for (const dxf of dxfEvidence) {
    lines.push(`\n### ${dxf.drawingName} (units: ${dxf.units}, ${dxf.totalEntityCount} entities)`);
    if (dxf.layers.length > 0) {
      const top = dxf.layers
        .sort((a, b) => b.entityCount - a.entityCount)
        .slice(0, 20)
        .map(l => `${l.name}(${l.entityCount})`)
        .join(", ");
      lines.push(`  Layers (top 20): ${top}`);
    }
    if (dxf.blockNames.length > 0) {
      lines.push(`  Blocks: ${dxf.blockNames.slice(0, 20).join(", ")}`);
    }
    if (dxf.detectedItemCodes.length > 0) {
      lines.push(`  Detected item codes in labels: ${dxf.detectedItemCodes.join(", ")}`);
    }
    if (dxf.textLabels.length > 0) {
      lines.push(`  Sample text labels: ${dxf.textLabels.slice(0, 20).join(" | ")}`);
    }
    if (dxf.warnings.length > 0) {
      lines.push(`  CAD warnings: ${dxf.warnings.slice(0, 3).join("; ")}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export interface BuildPromptResult {
  systemPrompt: string;
  userPrompt: string;
  /** Actual char count of userPrompt after truncation */
  inputCharCount: number;
  /** Whether the input was truncated */
  truncated: boolean;
}

export function buildAiReviewPrompt(
  input: AiReviewRunInput,
  maxInputChars = DEFAULT_MAX_INPUT_CHARS
): BuildPromptResult {
  const systemPrompt = `You are an expert façade construction quantity takeoff reviewer.
Your role is to review drawing evidence and cross-drawing quantity candidates, then produce structured advisory findings.

Rules:
- You NEVER change or invent quantity values.
- All findings are advisory. The estimator makes the final decision.
- You must identify: generic item codes, conflicting values, suspicious dimensions (>=20m for windows/curtain wall), OCR-only sources, missing required fields, and safe quantities.
- Respond ONLY with a valid JSON object matching the AiReviewResult schema below.
- Do not include any explanatory text outside the JSON.
- Each finding must have: findingType, riskLevel (low/medium/high/critical), title, message, recommendation, suggestedAction, confidence, and optionally candidateId/itemCode.
- Valid findingTypes: missing_information, source_conflict, generic_code, ocr_uncertain, suspicious_dimension, quantity_safe, failed_drawing, needs_elevation, needs_schedule, needs_section, manual_verification_required, boq_mismatch, false_positive.
- Valid suggestedActions: keep_candidate, reject_candidate, send_to_missing_info, mark_needs_verification, request_manual_check, no_action.
- candidateId must match exactly one of the candidateIds listed in the input if provided.
- Do not include raw file content in your response.

Response JSON schema:
{
  "summary": "string — 1-2 sentence summary",
  "findings": [
    {
      "candidateId": "string or omit if package-level",
      "itemCode": "string",
      "findingType": "string",
      "riskLevel": "low|medium|high|critical",
      "title": "string ≤ 80 chars",
      "message": "string ≤ 300 chars",
      "recommendation": "string ≤ 200 chars",
      "suggestedAction": "string",
      "confidence": "low|medium|high",
      "sourceDrawingNames": ["string"],
      "linkedEvidenceIds": []
    }
  ],
  "warnings": ["string"]
}`;

  // Build sections
  const sectionParts: string[] = [];

  // Package context
  const pkg = input.packageAnalysisResult;
  if (pkg) {
    const pkgLines = [
      "## Package Drawing Types",
      `  hasPlan=${pkg.hasPlan}`,
      `  hasElevation=${pkg.hasElevation}`,
      `  hasSchedule=${pkg.hasSchedule}`,
      `  hasSection=${pkg.hasSection}`,
    ];
    sectionParts.push(pkgLines.join("\n"));
  }

  // Cross-drawing candidates
  const candidates = input.crossDrawingResult?.candidates ?? [];
  if (candidates.length > 0) {
    const candLines = [`## Cross-Drawing Quantity Candidates (${candidates.length} total)`];
    candLines.push("Each line: code [dims] {flags} conf=X status=Y sources=[...] warnings=[...]");
    candLines.push("Flags: GENERIC_CODE | CONFLICT | OCR_ONLY | SUSPICIOUS_DIM | MISSING:fields");
    const included = candidates.slice(0, MAX_CANDIDATES_IN_PROMPT);
    for (const c of included) {
      candLines.push(summariseCandidate(c));
    }
    if (candidates.length > included.length) {
      candLines.push(
        `  ... ${candidates.length - included.length} additional candidates omitted to keep prompt within safe runtime limits.`
      );
    }
    sectionParts.push(candLines.join("\n"));
  } else {
    sectionParts.push("## Cross-Drawing Quantity Candidates\n  None built yet.");
  }

  // Failed drawings
  if (input.failedDrawingDiagnostics && input.failedDrawingDiagnostics.length > 0) {
    const lines = [`## Failed Drawings (${input.failedDrawingDiagnostics.length})`];
    for (const d of input.failedDrawingDiagnostics) {
      lines.push(`  - ${d.drawingName}: ${d.errorMessage.slice(0, 120)}`);
    }
    sectionParts.push(lines.join("\n"));
  }

  // Missing info items
  if (input.missingInfoItems && input.missingInfoItems.length > 0) {
    const open = input.missingInfoItems.filter(m => m.status === "open");
    if (open.length > 0) {
      const lines = [`## Open Missing-Info Issues (${open.length})`];
      for (const m of open.slice(0, 20)) {
        lines.push(`  - ${m.manualItemCode ?? "unknown"}: ${m.issueType}`);
      }
      sectionParts.push(lines.join("\n"));
    }
  }

  // DXF evidence
  if (input.dxfEvidence && input.dxfEvidence.length > 0) {
    sectionParts.push(buildDxfSection(input.dxfEvidence));
  }

  // Candidate IDs for reference
  if (candidates.length > 0) {
    const idMap = candidates
      .slice(0, MAX_CANDIDATE_IDS_IN_PROMPT)
      .map(c => `  ${c.id} → ${c.normalizedItemCode || c.itemCode}`)
      .join("\n");
    const omitted = candidates.length - Math.min(candidates.length, MAX_CANDIDATE_IDS_IN_PROMPT);
    sectionParts.push(
      `## Candidate ID Reference\n${idMap}${omitted > 0 ? `\n  ... ${omitted} more candidate IDs omitted.` : ""}`
    );
  }

  let userPrompt = sectionParts.join("\n\n");

  const truncated = userPrompt.length > maxInputChars;
  if (truncated) {
    userPrompt = userPrompt.slice(0, maxInputChars) + "\n\n[...INPUT TRUNCATED — review what is shown above]";
  }

  return {
    systemPrompt,
    userPrompt,
    inputCharCount: userPrompt.length,
    truncated,
  };
}
