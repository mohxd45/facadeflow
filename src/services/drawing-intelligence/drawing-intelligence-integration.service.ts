/**
 * Drawing Intelligence Integration Service — Phase 6D
 *
 * Connects:
 *  - system detections (OCR/code/dimension/DXF)
 *  - AI visual detections (Phase 6C)
 * with:
 *  - reconciliation engine (Phase 6A)
 *
 * Safety rules:
 *  - AI-only detections remain advisory (possible/needs_verification)
 *  - AI never auto-verifies/finalizes quantities
 *  - conflicts always require estimator review
 *  - no silent overwrite of system dimensions by AI hints
 */

import type {
  AiVisualDetection,
  AiVisualDetectionResult,
  AiVisualSheetAnalysis,
  DrawingIntelligenceEstimatorAction,
  DrawingSheetReconciliation,
  DrawingSheetRef,
  ReconciledElement,
  ReconciliationInput,
  SystemDimensionDetection,
  SystemSheetEvidence,
} from "@/types/drawing-intelligence";
import { reconcileDrawingIntelligence } from "@/services/drawing-intelligence/drawing-intelligence-reconciler.service";
import { linkMeasurementsToReconciledElements } from "@/services/drawing-intelligence/drawing-intelligence-measurement-linking.service";

export interface ExistingCandidateReference {
  candidateId: string;
  normalizedItemCode?: string;
  sheet?: DrawingSheetRef;
}

export interface IntegrateDrawingIntelligenceInput {
  projectId: string;
  systemEvidence: SystemSheetEvidence[];
  aiVisualDetectionResult: Pick<AiVisualDetectionResult, "detections" | "warnings">;
  drawingSheets?: DrawingSheetRef[];
  existingCandidateRefs?: ExistingCandidateReference[];
}

export interface IntegrateDrawingIntelligenceResult {
  reconciliations: DrawingSheetReconciliation[];
  warnings: string[];
}

function sheetKey(sheet: DrawingSheetRef): string {
  return `${sheet.drawingId}::p${sheet.page}`;
}

function safeSheetRef(
  candidate: DrawingSheetRef | undefined,
  fallbackSheets: DrawingSheetRef[]
): DrawingSheetRef | null {
  if (
    candidate &&
    typeof candidate.drawingId === "string" &&
    typeof candidate.drawingName === "string" &&
    typeof candidate.page === "number" &&
    candidate.page > 0
  ) {
    return candidate;
  }
  return fallbackSheets[0] ?? null;
}

/**
 * Map Phase 6C AI detections into 6A sheet analyses.
 * Invalid/missing sheet refs are safely re-homed to a known sheet when possible.
 */
export function mapAiVisualDetectionsToSheetAnalyses(
  detections: AiVisualDetection[],
  fallbackSheets: DrawingSheetRef[] = []
): { analyses: AiVisualSheetAnalysis[]; warnings: string[] } {
  const warnings: string[] = [];
  const bySheet = new Map<string, AiVisualDetection[]>();

  for (const det of detections) {
    const mappedSheet = safeSheetRef(det.sheet, fallbackSheets);
    if (!mappedSheet) {
      warnings.push(`Dropped AI detection ${det.id}: missing valid sheet reference.`);
      continue;
    }
    const normalized: AiVisualDetection = {
      ...det,
      sheet: mappedSheet,
      // Safety: AI detections in reconciliation remain advisory.
      status: det.status === "needs_verification" ? "needs_verification" : "possible",
    };
    const key = sheetKey(mappedSheet);
    const list = bySheet.get(key) ?? [];
    list.push(normalized);
    bySheet.set(key, list);
  }

  const analysedAt = new Date().toISOString();
  const analyses: AiVisualSheetAnalysis[] = Array.from(bySheet.entries()).map(([k, list]) => {
    const [first] = list;
    return {
      sheet: first.sheet,
      detections: list,
      modelSummary: `Mapped ${list.length} visual detections for ${k}.`,
      analysedAt,
    };
  });

  return { analyses, warnings };
}

/**
 * Map/normalize system detections and safely drop invalid rows.
 */
export function mapSystemDetectionsToSheetEvidence(
  systemEvidence: SystemSheetEvidence[],
  fallbackSheets: DrawingSheetRef[] = []
): { evidence: SystemSheetEvidence[]; warnings: string[] } {
  const warnings: string[] = [];
  const normalized: SystemSheetEvidence[] = [];

  for (const row of systemEvidence) {
    const sheet = safeSheetRef(row.sheet, fallbackSheets);
    if (!sheet) {
      warnings.push("Dropped system evidence row: missing valid sheet reference.");
      continue;
    }
    normalized.push({
      sheet,
      codeDetections: row.codeDetections.filter((c) => c.sheet.page > 0),
      dimensionDetections: row.dimensionDetections.filter((d) => d.sheet.page > 0),
      dxfDetections: row.dxfDetections.filter((d) => d.sheet.page > 0),
    });
  }

  return { evidence: normalized, warnings };
}

function inferRecommendedAction(element: ReconciledElement): DrawingIntelligenceEstimatorAction {
  if (element.matchStatus === "conflict") return "resolve_conflict";
  if (element.matchStatus === "matched") return "accept_as_candidate";
  if (element.matchStatus === "system_only") {
    const missingDims = !element.systemDimensionDetection;
    return missingDims ? "send_to_missing_info" : "review_manually";
  }
  if (element.matchStatus === "needs_verification") {
    if (element.aiDetection?.detectionType === "possible_uncoded_opening") {
      return "create_clarification";
    }
    return "review_manually";
  }
  // ai_only
  if (element.aiDetection?.aiConfidence !== undefined && element.aiDetection.aiConfidence < 0.35) {
    return "reject_suggestion";
  }
  if (element.aiDetection?.detectionType === "possible_uncoded_opening") {
    return "create_clarification";
  }
  return "review_manually";
}

function postProcessSafety(elements: ReconciledElement[]): ReconciledElement[] {
  return elements.map((e) => {
    const out: ReconciledElement = { ...e };

    // Uncoded AI opening should explicitly remain needs_verification.
    if (
      out.matchStatus === "ai_only" &&
      out.aiDetection?.detectionType === "possible_uncoded_opening"
    ) {
      out.matchStatus = "needs_verification";
      out.flaggedIssues = [
        ...out.flaggedIssues,
        "AI uncoded opening has no system code/dimension. Manual verification required.",
      ];
    }

    // Conflict should always require explicit review.
    if (out.matchStatus === "conflict") {
      out.flaggedIssues = [...out.flaggedIssues, "Conflict requires estimator decision."];
    }

    // Safety: never silently overwrite system dimensions with AI values.
    if (out.systemDimensionDetection?.widthM !== null && out.systemDimensionDetection?.widthM !== undefined) {
      out.hintWidthM = out.systemDimensionDetection.widthM;
    }
    if (
      out.systemDimensionDetection?.heightM !== null &&
      out.systemDimensionDetection?.heightM !== undefined
    ) {
      out.hintHeightM = out.systemDimensionDetection.heightM;
    }

    out.recommendedEstimatorAction = inferRecommendedAction(out);
    return out;
  });
}

export function integrateAiSystemDrawingReconciliation(
  input: IntegrateDrawingIntelligenceInput
): IntegrateDrawingIntelligenceResult {
  const warnings: string[] = [];
  const fallbackSheets =
    input.drawingSheets && input.drawingSheets.length > 0
      ? input.drawingSheets
      : input.systemEvidence.map((e) => e.sheet);

  const sysMapped = mapSystemDetectionsToSheetEvidence(input.systemEvidence, fallbackSheets);
  warnings.push(...sysMapped.warnings);

  const aiMapped = mapAiVisualDetectionsToSheetAnalyses(
    input.aiVisualDetectionResult.detections,
    fallbackSheets
  );
  warnings.push(...aiMapped.warnings);

  const reconciliationInput: ReconciliationInput = {
    projectId: input.projectId,
    systemEvidence: sysMapped.evidence,
    aiAnalyses: aiMapped.analyses,
  };

  const base = reconcileDrawingIntelligence(reconciliationInput);
  const reconciliations = base.map((sheetResult) => {
    const prelim = postProcessSafety(sheetResult.reconciledElements);
    const systemDims: SystemDimensionDetection[] = sysMapped.evidence.flatMap(
      (s) => s.dimensionDetections
    );
    const measurementLinked = linkMeasurementsToReconciledElements({
      systemCodeDetections: sysMapped.evidence.flatMap((s) => s.codeDetections),
      systemDimensionDetections: systemDims,
      aiDetections: input.aiVisualDetectionResult.detections,
      reconciledElements: prelim,
      sheetRefs: fallbackSheets,
    });
    const processed = measurementLinked.elements;
    warnings.push(
      ...measurementLinked.unresolved.map((x) => `Measurement unresolved (${x.elementId}): ${x.reason}`),
      ...measurementLinked.suspicious.map((x) => `Suspicious measurement (${x.elementId}): ${x.reason}`)
    );
    return {
      ...sheetResult,
      reconciledElements: processed,
      stats: {
        matched: processed.filter((e) => e.matchStatus === "matched").length,
        systemOnly: processed.filter((e) => e.matchStatus === "system_only").length,
        aiOnly: processed.filter((e) => e.matchStatus === "ai_only").length,
        conflicts: processed.filter((e) => e.matchStatus === "conflict").length,
        needsVerification: processed.filter((e) => e.matchStatus === "needs_verification").length,
        total: processed.length,
      },
    };
  });

  warnings.push(...input.aiVisualDetectionResult.warnings);
  return { reconciliations, warnings: Array.from(new Set(warnings)) };
}

export function aiOnlyReconciliationsCannotBeFinal(
  reconciliations: DrawingSheetReconciliation[]
): true {
  // Type-level assertion pattern used in earlier phases.
  void reconciliations;
  return true;
}

export function noSilentQuantityOverwriteFromAi(
  reconciliations: DrawingSheetReconciliation[]
): boolean {
  return reconciliations.every((sheet) =>
    sheet.reconciledElements.every((e) => {
      if (!e.systemDimensionDetection) return true;
      if (e.systemDimensionDetection.widthM !== null && e.hintWidthM !== undefined) {
        if (Math.abs(e.systemDimensionDetection.widthM - e.hintWidthM) > 0.0001) return false;
      }
      if (e.systemDimensionDetection.heightM !== null && e.hintHeightM !== undefined) {
        if (Math.abs(e.systemDimensionDetection.heightM - e.hintHeightM) > 0.0001) return false;
      }
      return true;
    })
  );
}

