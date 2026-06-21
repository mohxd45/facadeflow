/**
 * Drawing Intelligence Measurement Linking Service — Phase 6G
 *
 * Links system measurement detections to reconciled elements with strict safety:
 *  - prefers explicit/schedule-linked measurements
 *  - filters suspicious scale/grid/revision/page-like numbers
 *  - avoids low-confidence/random nearby links
 */

import { v4 as uuidv4 } from "uuid";
import type {
  AiVisualDetection,
  DrawingSheetRef,
  LinkedMeasurementEvidence,
  ReconciledElement,
  SystemCodeDetection,
  SystemDimensionDetection,
} from "@/types/drawing-intelligence";

export interface MeasurementLinkingInput {
  systemCodeDetections: SystemCodeDetection[];
  systemDimensionDetections: SystemDimensionDetection[];
  aiDetections: AiVisualDetection[];
  reconciledElements: ReconciledElement[];
  sheetRefs: DrawingSheetRef[];
}

export interface MeasurementLinkingResult {
  elements: ReconciledElement[];
  unresolved: Array<{ elementId: string; reason: string }>;
  suspicious: Array<{ elementId: string; reason: string; rawText: string }>;
}

function sheetKey(sheet: DrawingSheetRef): string {
  return `${sheet.drawingId}::p${sheet.page}`;
}

function normalizeCode(code: string | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

function confidenceScore(c: "high" | "medium" | "low"): number {
  if (c === "high") return 20;
  if (c === "medium") return 10;
  return -25;
}

function methodScore(method: SystemDimensionDetection["detectionMethod"]): number {
  switch (method) {
    case "schedule":
    case "table":
      return 100;
    case "text_pair":
      return 85;
    case "cad_geometry":
      return 75;
    case "manual":
      return 70;
    case "nearby_dimension":
      return 50;
    default:
      return 40;
  }
}

function rawTextLooksLikeNoise(rawText: string): boolean {
  const t = rawText.toLowerCase();
  const noiseTokens = [
    "scale",
    "grid",
    "revision",
    "rev",
    "sheet",
    "detail",
    "page",
    "nts",
    "typ",
  ];
  return noiseTokens.some((token) => t.includes(token));
}

function hasAnyMeasurementValue(d: SystemDimensionDetection): boolean {
  return (
    typeof d.widthM === "number" ||
    typeof d.heightM === "number" ||
    typeof d.lengthM === "number"
  );
}

function dimensionsAreOutOfFacadeRange(d: SystemDimensionDetection): boolean {
  const values = [d.widthM, d.heightM, d.lengthM].filter(
    (v): v is number => typeof v === "number"
  );
  if (values.length === 0) return true;
  // Basic facade-safe range in metres.
  return values.some((v) => v <= 0.05 || v >= 20);
}

function isSuspiciousMeasurement(d: SystemDimensionDetection, codeMatchStrength: number): boolean {
  if (!hasAnyMeasurementValue(d)) return true;
  if (rawTextLooksLikeNoise(d.rawText)) return true;
  // If out of range and not explicitly code-linked from schedule/text pair, treat as suspicious.
  if (
    dimensionsAreOutOfFacadeRange(d) &&
    codeMatchStrength < 50 &&
    d.detectionMethod !== "schedule" &&
    d.detectionMethod !== "table" &&
    d.detectionMethod !== "text_pair"
  ) {
    return true;
  }
  return false;
}

function codeMatchScore(code: string, d: SystemDimensionDetection): number {
  const codeRef = normalizeCode(d.nearbyCodeRef);
  const rawUpper = d.rawText.toUpperCase();
  if (code.length === 0) return 0;
  if (codeRef === code) return 60;
  if (rawUpper.includes(code)) return 55;
  return 0;
}

function toLinkedMeasurement(
  d: SystemDimensionDetection,
  reason: string
): LinkedMeasurementEvidence {
  return {
    id: `lm-${uuidv4()}`,
    sheet: d.sheet,
    rawText: d.rawText,
    widthM: d.widthM ?? undefined,
    heightM: d.heightM ?? undefined,
    lengthM: d.lengthM ?? undefined,
    areaSqm:
      typeof d.widthM === "number" && typeof d.heightM === "number"
        ? Number((d.widthM * d.heightM).toFixed(3))
        : undefined,
    sourceFormat: d.sheet.sourceFormat,
    confidence: d.confidence,
    reason,
    nearbyCodeRef: d.nearbyCodeRef,
    detectionMethod: d.detectionMethod ?? "nearby_dimension",
    suspicious: false,
    unit: d.unit ?? "m",
  };
}

function hasAiDimensionConflict(element: ReconciledElement, linked: LinkedMeasurementEvidence): boolean {
  const aiW = element.aiDetection?.estimatedWidthM;
  const linkedW = linked.widthM;
  if (typeof aiW !== "number" || typeof linkedW !== "number" || linkedW <= 0) return false;
  return Math.abs(aiW - linkedW) / linkedW > 0.2;
}

export function linkMeasurementsToReconciledElements(
  input: MeasurementLinkingInput
): MeasurementLinkingResult {
  const unresolved: Array<{ elementId: string; reason: string }> = [];
  const suspicious: Array<{ elementId: string; reason: string; rawText: string }> = [];

  const dimsBySheet = new Map<string, SystemDimensionDetection[]>();
  for (const d of input.systemDimensionDetections) {
    const key = sheetKey(d.sheet);
    const list = dimsBySheet.get(key) ?? [];
    list.push(d);
    dimsBySheet.set(key, list);
  }

  const elements = input.reconciledElements.map((element) => {
    const out: ReconciledElement = { ...element };
    const sheetDims = dimsBySheet.get(sheetKey(element.sheet)) ?? [];
    const code = normalizeCode(
      element.systemCodeDetection?.normalizedCode ??
        element.systemCodeDetection?.rawText
    );

    let best: { score: number; dim: SystemDimensionDetection; codeScore: number } | null = null;
    const suspiciousCandidatesForElement: SystemDimensionDetection[] = [];
    for (const d of sheetDims) {
      const codeScore = codeMatchScore(code, d);
      const suspiciousCandidate = isSuspiciousMeasurement(d, codeScore);
      if (suspiciousCandidate) suspiciousCandidatesForElement.push(d);
      const codeMismatchPenalty =
        code.length > 0 && codeScore === 0
          ? d.detectionMethod === "schedule" || d.detectionMethod === "table"
            ? -55
            : -80
          : 0;
      const score =
        methodScore(d.detectionMethod) +
        confidenceScore(d.confidence) +
        codeScore +
        codeMismatchPenalty +
        (suspiciousCandidate ? -90 : 0);

      if (!best || score > best.score) {
        best = { score, dim: d, codeScore };
      }
    }

    for (const s of suspiciousCandidatesForElement) {
      suspicious.push({
        elementId: out.id,
        reason: "Suspicious measurement candidate rejected during linking.",
        rawText: s.rawText,
      });
    }

    if (!best || best.score < 55 || (code.length > 0 && best.codeScore === 0)) {
      out.unresolvedMeasurementReason =
        "No safe dimension could be linked to this element.";
      unresolved.push({
        elementId: out.id,
        reason: out.unresolvedMeasurementReason,
      });
      out.flaggedIssues = [
        ...out.flaggedIssues,
        "Dimension missing or low-confidence link. Send to Missing Info.",
      ];
      return out;
    }

    if (isSuspiciousMeasurement(best.dim, best.codeScore)) {
      out.unresolvedMeasurementReason =
        "Suspicious measurement detected and rejected.";
      unresolved.push({
        elementId: out.id,
        reason: out.unresolvedMeasurementReason,
      });
      suspicious.push({
        elementId: out.id,
        reason: "Measurement resembles scale/grid/detail noise or out-of-range value.",
        rawText: best.dim.rawText,
      });
      out.flaggedIssues = [
        ...out.flaggedIssues,
        "Suspicious measurement rejected — estimator verification required.",
      ];
      if (out.matchStatus === "matched" || out.matchStatus === "system_only") {
        out.matchStatus = "needs_verification";
      }
      return out;
    }

    const linked = toLinkedMeasurement(
      best.dim,
      best.codeScore >= 50
        ? "Linked via explicit code reference in text/schedule."
        : "Linked by same-sheet nearest safe dimension method."
    );
    out.linkedMeasurement = linked;

    // Set hints from linked measurement, but never overwrite existing explicit system dimensions.
    if (typeof out.systemDimensionDetection?.widthM === "number") {
      out.hintWidthM = out.systemDimensionDetection.widthM;
    } else if (typeof linked.widthM === "number") {
      out.hintWidthM = linked.widthM;
    }
    if (typeof out.systemDimensionDetection?.heightM === "number") {
      out.hintHeightM = out.systemDimensionDetection.heightM;
    } else if (typeof linked.heightM === "number") {
      out.hintHeightM = linked.heightM;
    }

    if (hasAiDimensionConflict(out, linked)) {
      out.matchStatus = out.matchStatus === "ai_only" ? "needs_verification" : "conflict";
      out.flaggedIssues = [
        ...out.flaggedIssues,
        "AI hint conflicts with linked system dimension (>20%).",
      ];
    }

    return out;
  });

  return { elements, unresolved, suspicious };
}

