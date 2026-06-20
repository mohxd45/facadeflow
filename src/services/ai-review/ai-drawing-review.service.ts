/**
 * AI Drawing Review Service — Phase 5A (Mock / Deterministic Engine)
 *
 * Design principles:
 *  - Completely deterministic: same input always produces same output.
 *  - Zero API calls, zero network requests, zero environment variables.
 *  - Candidates are NEVER mutated; only findings are created.
 *  - Each finding carries a suggestedAction; the estimator always decides.
 *
 * This file is the safe stand-in for a future real AI provider.
 * Replace the body of `runMockAiDrawingReview` when wiring up a real provider.
 */

import { v4 as uuidv4 } from "uuid";
import type {
  AiReviewFinding,
  AiReviewFindingType,
  AiReviewResult,
  AiReviewRiskLevel,
  AiReviewRunInput,
  AiReviewSuggestedAction,
} from "@/types/ai-review";
import type { CrossDrawingQuantityCandidate } from "@/types/cross-drawing-quantity";
import {
  candidateHasSuspiciousDimensionSignals,
  candidateHasValueConflict,
  candidateIsOcrOnly,
  isGenericCode,
  SUSPICIOUS_DIMENSION_WARNING_TEXT,
} from "@/services/drawing-package/cross-drawing-quantity-builder.service";

// ---------------------------------------------------------------------------
// Suspicious-dimension threshold (mirrors Phase 4C scoring rule)
// ---------------------------------------------------------------------------

const SUSPICIOUS_DIMENSION_M = 20; // metres

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeFinding(
  projectId: string,
  overrides: Omit<AiReviewFinding, "id" | "projectId" | "createdAt">
): AiReviewFinding {
  return {
    id: uuidv4(),
    projectId,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function hasSuspiciousDimension(c: CrossDrawingQuantityCandidate): boolean {
  const dimensionalThresholdHit =
    (typeof c.width === "number" && c.width >= SUSPICIOUS_DIMENSION_M) ||
    (typeof c.height === "number" && c.height >= SUSPICIOUS_DIMENSION_M) ||
    (typeof c.length === "number" && c.length >= SUSPICIOUS_DIMENSION_M);
  const warningSignal =
    c.warnings.includes(SUSPICIOUS_DIMENSION_WARNING_TEXT) ||
    c.warnings.some((w) => w.toLowerCase().includes("suspicious dimension"));
  return (
    dimensionalThresholdHit ||
    warningSignal ||
    candidateHasSuspiciousDimensionSignals(c, c.confidence)
  );
}

function classifyCandidate(
  projectId: string,
  c: CrossDrawingQuantityCandidate
): AiReviewFinding {
  // Priority: generic > conflict > suspicious > OCR-only > missing > safe

  if (isGenericCode(c.itemCode)) {
    return makeFinding(projectId, {
      candidateId: c.id,
      itemCode: c.itemCode,
      normalizedItemCode: c.normalizedItemCode,
      findingType: "generic_code" as AiReviewFindingType,
      riskLevel: "medium" as AiReviewRiskLevel,
      title: `Generic item code: ${c.itemCode}`,
      message: `Item code "${c.itemCode}" is a bare prefix without a numbered suffix. It cannot be priced or scheduled until a specific code is assigned.`,
      recommendation:
        "Confirm the exact item code from the window/door schedule or elevation before pricing.",
      linkedEvidenceIds: c.linkedEvidenceIds,
      sourceDrawingNames: c.sourceDrawingNames,
      sourcePages: c.sourcePages,
      suggestedAction: "send_to_missing_info" as AiReviewSuggestedAction,
      confidence: "high",
    });
  }

  if (candidateHasValueConflict(c)) {
    return makeFinding(projectId, {
      candidateId: c.id,
      itemCode: c.itemCode,
      normalizedItemCode: c.normalizedItemCode,
      findingType: "source_conflict" as AiReviewFindingType,
      riskLevel: "high" as AiReviewRiskLevel,
      title: `Value conflict detected: ${c.normalizedItemCode}`,
      message: `Conflicting dimension values were found across ${c.sourceDrawingNames.length} source drawing(s). The resolved value may not be correct.`,
      recommendation:
        "Verify conflicting dimensions manually against the original drawings before using this quantity.",
      linkedEvidenceIds: c.linkedEvidenceIds,
      sourceDrawingNames: c.sourceDrawingNames,
      sourcePages: c.sourcePages,
      suggestedAction: "request_manual_check" as AiReviewSuggestedAction,
      confidence: "high",
    });
  }

  if (hasSuspiciousDimension(c)) {
    const dims: string[] = [];
    if (typeof c.width === "number" && c.width >= SUSPICIOUS_DIMENSION_M)
      dims.push(`width ${c.width}m`);
    if (typeof c.height === "number" && c.height >= SUSPICIOUS_DIMENSION_M)
      dims.push(`height ${c.height}m`);
    if (typeof c.length === "number" && c.length >= SUSPICIOUS_DIMENSION_M)
      dims.push(`length ${c.length}m`);

    return makeFinding(projectId, {
      candidateId: c.id,
      itemCode: c.itemCode,
      normalizedItemCode: c.normalizedItemCode,
      findingType: "suspicious_dimension" as AiReviewFindingType,
      riskLevel: "high" as AiReviewRiskLevel,
      title: `Suspicious dimension on ${c.normalizedItemCode}: ${dims.join(", ")}`,
      message: `One or more dimensions exceed ${SUSPICIOUS_DIMENSION_M}m (${dims.join(", ")}). This may be a grid reference or overall building dimension rather than an item size.`,
      recommendation:
        "Check whether this value is a grid/dimension line, not the item size. Cross-reference with the schedule.",
      linkedEvidenceIds: c.linkedEvidenceIds,
      sourceDrawingNames: c.sourceDrawingNames,
      sourcePages: c.sourcePages,
      suggestedAction: "request_manual_check" as AiReviewSuggestedAction,
      confidence: "medium",
    });
  }

  if (candidateIsOcrOnly(c)) {
    return makeFinding(projectId, {
      candidateId: c.id,
      itemCode: c.itemCode,
      normalizedItemCode: c.normalizedItemCode,
      findingType: "ocr_uncertain" as AiReviewFindingType,
      riskLevel: "medium" as AiReviewRiskLevel,
      title: `OCR-derived values need verification: ${c.normalizedItemCode}`,
      message: `All quantity values for this item were extracted via OCR from scanned drawings. OCR output can contain character recognition errors.`,
      recommendation:
        "Verify OCR-derived values against the original drawing before accepting this candidate.",
      linkedEvidenceIds: c.linkedEvidenceIds,
      sourceDrawingNames: c.sourceDrawingNames,
      sourcePages: c.sourcePages,
      suggestedAction: "mark_needs_verification" as AiReviewSuggestedAction,
      confidence: "high",
    });
  }

  if (c.missingFields.length > 0) {
    return makeFinding(projectId, {
      candidateId: c.id,
      itemCode: c.itemCode,
      normalizedItemCode: c.normalizedItemCode,
      findingType: "missing_information" as AiReviewFindingType,
      riskLevel: "medium" as AiReviewRiskLevel,
      title: `Missing fields on ${c.normalizedItemCode}: ${c.missingFields.join(", ")}`,
      message: `Required fields (${c.missingFields.join(", ")}) could not be found across any source drawing in this package.`,
      recommendation:
        "Check the schedule, elevation, plan, and section drawings and fill the missing fields manually before saving.",
      linkedEvidenceIds: c.linkedEvidenceIds,
      sourceDrawingNames: c.sourceDrawingNames,
      sourcePages: c.sourcePages,
      suggestedAction: "send_to_missing_info" as AiReviewSuggestedAction,
      confidence: "high",
    });
  }

  // Complete, non-OCR, no conflict, no generic, no suspicious dims
  return makeFinding(projectId, {
    candidateId: c.id,
    itemCode: c.itemCode,
    normalizedItemCode: c.normalizedItemCode,
    findingType: "quantity_safe" as AiReviewFindingType,
    riskLevel: "low" as AiReviewRiskLevel,
    title: `Quantity looks complete: ${c.normalizedItemCode}`,
    message: `All required fields are present, confidence is ${c.confidence}, and no conflicts or OCR-only sources were detected.`,
    recommendation:
      "Estimator may verify after a final manual review of the source drawings.",
    linkedEvidenceIds: c.linkedEvidenceIds,
    sourceDrawingNames: c.sourceDrawingNames,
    sourcePages: c.sourcePages,
    suggestedAction: "keep_candidate" as AiReviewSuggestedAction,
    confidence: "high",
  });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run the deterministic mock AI review.
 *
 * Rules:
 *  - Candidates are never mutated.
 *  - Output is deterministic for a given input.
 *  - No API calls, no network, no environment variables.
 */
export function runMockAiDrawingReview(input: AiReviewRunInput): AiReviewResult {
  const now = new Date().toISOString();
  const { projectId } = input;
  const findings: AiReviewFinding[] = [];
  const reviewedCandidateIds: string[] = [];
  const warnings: string[] = [];

  // ── 1. Evaluate cross-drawing candidates ────────────────────────────────

  const candidates = input.crossDrawingResult?.candidates ?? [];

  for (const c of candidates) {
    reviewedCandidateIds.push(c.id);
    findings.push(classifyCandidate(projectId, c));
  }

  // ── 2. Failed drawings ───────────────────────────────────────────────────

  for (const diag of input.failedDrawingDiagnostics ?? []) {
    findings.push(
      makeFinding(projectId, {
        findingType: "failed_drawing",
        riskLevel: "high",
        title: `Failed drawing: ${diag.drawingName}`,
        message: `Drawing "${diag.drawingName}" could not be loaded or parsed. Error: ${diag.errorMessage}`,
        recommendation:
          diag.suggestion ??
          "Re-import or replace the failed drawing before relying on package quantities.",
        linkedEvidenceIds: [],
        sourceDrawingNames: [diag.drawingName],
        sourcePages: [],
        suggestedAction: "request_manual_check",
        confidence: "high",
      })
    );
  }

  // ── 3. Package-level missing drawing types ───────────────────────────────

  const pkg = input.packageAnalysisResult;
  if (pkg) {
    if (pkg.hasPlan && !pkg.hasElevation) {
      findings.push(
        makeFinding(projectId, {
          findingType: "needs_elevation",
          riskLevel: "high",
          title: "No elevation drawings detected in package",
          message:
            "A floor plan was found but no elevation drawings were identified. Heights and facade dimensions cannot be reliably extracted without an elevation.",
          recommendation:
            "Upload the relevant elevation drawings and re-run the package analysis.",
          linkedEvidenceIds: [],
          sourceDrawingNames: [],
          sourcePages: [],
          suggestedAction: "request_manual_check",
          confidence: "high",
        })
      );
    }

    if (pkg.hasPlan && !pkg.hasSchedule) {
      findings.push(
        makeFinding(projectId, {
          findingType: "needs_schedule",
          riskLevel: "high",
          title: "No schedule drawings detected in package",
          message:
            "A floor plan was found but no window/door/material schedule was identified. Item codes and specifications cannot be confirmed without a schedule.",
          recommendation:
            "Upload the relevant schedule drawings and re-run the package analysis.",
          linkedEvidenceIds: [],
          sourceDrawingNames: [],
          sourcePages: [],
          suggestedAction: "request_manual_check",
          confidence: "high",
        })
      );
    }

    if (!pkg.hasSection) {
      warnings.push(
        "No section or detail drawings were detected. Thickness and fixing details may be missing from quantity candidates."
      );
      findings.push(
        makeFinding(projectId, {
          findingType: "needs_section",
          riskLevel: "medium",
          title: "No section/detail drawings detected in package",
          message:
            "Section and detail drawings provide thickness, fixing depth, and profile information. Without them, material and thickness fields may be incomplete.",
          recommendation:
            "Upload section or detail drawings if thickness or fixing specifications are required.",
          linkedEvidenceIds: [],
          sourceDrawingNames: [],
          sourcePages: [],
          suggestedAction: "request_manual_check",
          confidence: "medium",
        })
      );
    }
  }

  // ── 4. Build summary ─────────────────────────────────────────────────────

  const countByType = (type: AiReviewFindingType) =>
    findings.filter((f) => f.findingType === type).length;

  const safe = countByType("quantity_safe");
  const conflicts = countByType("source_conflict");
  const missing = countByType("missing_information");
  const generic = countByType("generic_code");
  const ocr = countByType("ocr_uncertain");
  const suspicious = countByType("suspicious_dimension");
  const failed = countByType("failed_drawing");
  const highRisk = findings.filter(
    (f) => f.riskLevel === "high" || f.riskLevel === "critical"
  ).length;

  const summaryParts: string[] = [];
  if (safe > 0) summaryParts.push(`${safe} safe`);
  if (conflicts > 0) summaryParts.push(`${conflicts} conflict(s)`);
  if (missing > 0) summaryParts.push(`${missing} missing-info`);
  if (generic > 0) summaryParts.push(`${generic} generic code(s)`);
  if (ocr > 0) summaryParts.push(`${ocr} OCR-uncertain`);
  if (suspicious > 0) summaryParts.push(`${suspicious} suspicious dimension(s)`);
  if (failed > 0) summaryParts.push(`${failed} failed drawing(s)`);

  const summary =
    summaryParts.length > 0
      ? `AI review complete. ${summaryParts.join(", ")}. ${highRisk} high-risk finding(s) require attention.`
      : "AI review complete. No candidates were evaluated.";

  return {
    id: uuidv4(),
    projectId,
    status: "completed",
    summary,
    findings,
    reviewedCandidateIds,
    warnings,
    createdAt: now,
    updatedAt: now,
  };
}
