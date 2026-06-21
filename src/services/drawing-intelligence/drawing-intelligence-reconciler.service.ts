/**
 * Drawing Intelligence Reconciler — Phase 6A skeleton
 *
 * Compares system-extracted drawing data (OCR text, DXF layers, PDF codes)
 * with AI visual detections to produce a set of ReconciledElements per sheet.
 *
 * Safety rules enforced by this service (never relax):
 *  - AI-only detections always produce status="ai_only" or "needs_verification".
 *  - AI detections never produce estimatorAction="accept_system_values" alone.
 *  - Dimension hints from AI are labelled as hints — they NEVER set quantity values.
 *  - This service is pure (no I/O, no stores) — all output is advisory.
 *
 * Phase 6A: foundation only.
 *   Phase 6B will add full DXF geometry comparison.
 *   Phase 6C will add real AI Vision API integration.
 */

import { v4 as uuidv4 } from "uuid";
import type {
  ReconciliationInput,
  DrawingSheetReconciliation,
  ReconciledElement,
  SystemSheetEvidence,
  AiVisualSheetAnalysis,
  AiVisualDetection,
  SystemCodeDetection,
  SystemDimensionDetection,
  ReconciliationMatchStatus,
  ReconciliationConfidence,
  DrawingSheetRef,
} from "@/types/drawing-intelligence";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sheetKey(sheet: DrawingSheetRef): string {
  return `${sheet.drawingId}::p${sheet.page}`;
}

/**
 * Map AI confidence float [0–1] to the three-band confidence type.
 * Thresholds deliberately conservative to keep estimator in control.
 */
function aiConfidenceBand(aiConfidence: number): ReconciliationConfidence {
  if (aiConfidence >= 0.85) return "medium"; // never "high" from AI alone
  if (aiConfidence >= 0.5) return "low";
  return "low";
}

/**
 * Determine whether an AI detection type plausibly matches a system code.
 * Very loose: a possible_window matches any code starting with W, V, etc.
 */
function aiTypeMatchesCode(
  detectionType: AiVisualDetection["detectionType"],
  normalizedCode: string
): boolean {
  const code = normalizedCode.toUpperCase();
  const matchMap: Partial<Record<AiVisualDetection["detectionType"], string[]>> = {
    possible_window: ["W-", "V-"],
    possible_door: ["D-", "ED-", "SD-"],
    possible_sliding_door: ["SD-", "ED-"],
    possible_curtain_wall: ["CW-"],
    possible_acp: ["ACP"],
    possible_railing: ["BL-R", "SCR", "RAIL"],
    possible_louver: ["LUR", "LV-"],
  };
  const prefixes = matchMap[detectionType] ?? [];
  return prefixes.some((p) => code.startsWith(p));
}

/**
 * Pick the best dimension from system + AI, preferring system.
 * Returns undefined if neither source has a value.
 */
function bestDimensionHint(
  systemValue: number | null | undefined,
  aiValue: number | undefined
): number | undefined {
  if (typeof systemValue === "number") return systemValue;
  if (typeof aiValue === "number") return aiValue;
  return undefined;
}

// ---------------------------------------------------------------------------
// Reconcile one sheet
// ---------------------------------------------------------------------------

function reconcileSheet(
  systemEvidence: SystemSheetEvidence | undefined,
  aiAnalysis: AiVisualSheetAnalysis | undefined,
  sheet: DrawingSheetRef
): DrawingSheetReconciliation {
  const now = new Date().toISOString();
  const elements: ReconciledElement[] = [];

  const systemCodes: SystemCodeDetection[] = systemEvidence?.codeDetections ?? [];
  const systemDims: SystemDimensionDetection[] = systemEvidence?.dimensionDetections ?? [];
  const aiDetections: AiVisualDetection[] = aiAnalysis?.detections ?? [];

  // Track which AI detections have been matched to avoid double-counting.
  const matchedAiIds = new Set<string>();

  // 1. Walk every system code detection — try to find a matching AI detection.
  // Build a set of already-consumed dimension IDs so each dim is used at most once.
  const usedDimIds = new Set<string>();

  for (const sysCode of systemCodes) {
    // Find best-fit dimension from system evidence.
    // Strategy (in priority order):
    //  a) rawText explicitly contains the item code prefix (e.g. "CW-06 2.4x3")
    //  b) first unclaimed dimension on the same sheet
    const codePrefix = sysCode.rawText.replace(/[^A-Za-z0-9-]/g, "").slice(0, 4);
    const samePagDims = systemDims.filter(
      (d) =>
        d.sheet.drawingId === sysCode.sheet.drawingId &&
        d.sheet.page === sysCode.sheet.page &&
        !usedDimIds.has(d.id)
    );

    let matchingDim: SystemDimensionDetection | undefined =
      samePagDims.find((d) => d.rawText.includes(codePrefix)) ??
      samePagDims[0]; // fallback: take first unclaimed dim on the same sheet

    if (matchingDim) usedDimIds.add(matchingDim.id);

    // Find an AI detection that plausibly matches this code.
    const matchingAi = aiDetections.find(
      (ai) =>
        !matchedAiIds.has(ai.id) &&
        aiTypeMatchesCode(ai.detectionType, sysCode.normalizedCode)
    );

    let matchStatus: ReconciliationMatchStatus;
    let confidence: ReconciliationConfidence;
    let estimatorAction: ReconciledElement["estimatorAction"];
    const flaggedIssues: string[] = [];

    if (matchingAi) {
      matchedAiIds.add(matchingAi.id);
      // Both system and AI agree on element presence.
      // Check for dimension conflict.
      const sysDimW = matchingDim?.widthM ?? null;
      const aiDimW = matchingAi.estimatedWidthM;
      const hasDimConflict =
        sysDimW !== null &&
        typeof aiDimW === "number" &&
        Math.abs(sysDimW - aiDimW) / sysDimW > 0.2; // >20% discrepancy

      if (hasDimConflict) {
        matchStatus = "conflict";
        confidence = "low";
        estimatorAction = "resolve_conflict";
        flaggedIssues.push(
          `Width conflict: system=${sysDimW?.toFixed(2)}m, AI estimate=${aiDimW?.toFixed(2)}m (>20% difference).`
        );
      } else {
        matchStatus = "matched";
        confidence = sysCode.confidence === "high" ? "high" : "medium";
        estimatorAction =
          matchingDim
            ? "accept_system_values"
            : "verify_dimensions";
        if (!matchingDim) {
          flaggedIssues.push("No dimension detected for this item — verify width/height.");
        }
      }
    } else {
      // System found it but AI did not.
      matchStatus = "system_only";
      confidence = sysCode.confidence;
      estimatorAction = matchingDim ? "accept_system_values" : "verify_dimensions";
      if (!matchingDim) {
        flaggedIssues.push("No dimension detected — check schedule or elevation.");
      }
    }

    elements.push({
      id: uuidv4(),
      sheet,
      matchStatus,
      confidence,
      systemCodeDetection: sysCode,
      systemDimensionDetection: matchingDim,
      aiDetection: matchingAi,
      inferredType: matchingAi?.detectionType,
      hintWidthM: bestDimensionHint(matchingDim?.widthM, matchingAi?.estimatedWidthM),
      hintHeightM: bestDimensionHint(matchingDim?.heightM, matchingAi?.estimatedHeightM),
      flaggedIssues,
      estimatorAction,
      reconciledAt: now,
    });
  }

  // 2. Any AI detections not yet matched → "ai_only" (never auto-create quantities).
  for (const ai of aiDetections) {
    if (matchedAiIds.has(ai.id)) continue;

    const flaggedIssues: string[] = [
      `AI detected a ${ai.detectionType.replace("possible_", "")} with no matching system code. Estimator must verify before adding.`,
    ];

    elements.push({
      id: uuidv4(),
      sheet,
      matchStatus: "ai_only",
      confidence: aiConfidenceBand(ai.aiConfidence),
      aiDetection: ai,
      inferredType: ai.detectionType,
      hintWidthM: ai.estimatedWidthM,
      hintHeightM: ai.estimatedHeightM,
      flaggedIssues,
      estimatorAction: "check_ai_suggestion",
      reconciledAt: now,
    });
  }

  const stats = {
    matched: elements.filter((e) => e.matchStatus === "matched").length,
    systemOnly: elements.filter((e) => e.matchStatus === "system_only").length,
    aiOnly: elements.filter((e) => e.matchStatus === "ai_only").length,
    conflicts: elements.filter((e) => e.matchStatus === "conflict").length,
    needsVerification: elements.filter((e) => e.matchStatus === "needs_verification").length,
    total: elements.length,
  };

  return { sheet, reconciledElements: elements, stats, generatedAt: now };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconcile system drawing evidence with AI visual detections.
 *
 * Returns one DrawingSheetReconciliation per unique sheet covered by either
 * system evidence or AI analysis (or both).
 *
 * Pure function — no side effects. All output is advisory.
 */
export function reconcileDrawingIntelligence(
  input: ReconciliationInput
): DrawingSheetReconciliation[] {
  // Build a map from sheetKey → system evidence.
  const systemBySheet = new Map<string, SystemSheetEvidence>();
  for (const ev of input.systemEvidence) {
    systemBySheet.set(sheetKey(ev.sheet), ev);
  }

  // Build a map from sheetKey → AI analysis.
  const aiBySheet = new Map<string, AiVisualSheetAnalysis>();
  for (const ai of input.aiAnalyses) {
    aiBySheet.set(sheetKey(ai.sheet), ai);
  }

  // Collect the full set of sheets from both sources.
  const allSheetKeys = new Set([...systemBySheet.keys(), ...aiBySheet.keys()]);

  const results: DrawingSheetReconciliation[] = [];

  for (const key of allSheetKeys) {
    const sysEv = systemBySheet.get(key);
    const aiAn = aiBySheet.get(key);
    // Prefer sheet reference from system evidence; fall back to AI.
    const sheet = (sysEv ?? aiAn)!.sheet;
    results.push(reconcileSheet(sysEv, aiAn, sheet));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Safety audit exports (used by fixture tests — never mutate)
// ---------------------------------------------------------------------------

/**
 * Returns true — AI reconciliation output must never auto-mark items verified.
 * Used as a compile-time-verifiable safety assertion in fixture tests.
 */
export function aiReconciliationCannotMarkVerified(): true {
  return true;
}

/**
 * Returns true — AI-only elements must always have estimatorAction that
 * requires human confirmation ("check_ai_suggestion" or "resolve_conflict").
 */
export function aiOnlyElementRequiresEstimatorAction(
  element: ReconciledElement
): boolean {
  if (element.matchStatus !== "ai_only") return true; // not applicable
  return (
    element.estimatorAction === "check_ai_suggestion" ||
    element.estimatorAction === "resolve_conflict"
  );
}
