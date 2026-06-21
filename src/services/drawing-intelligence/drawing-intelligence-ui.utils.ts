import type {
  DrawingIntelligenceEstimatorAction,
  DrawingSheetReconciliation,
  ReconciledElement,
} from "@/types/drawing-intelligence";
import type { IntegrateDrawingIntelligenceResult } from "@/services/drawing-intelligence/drawing-intelligence-integration.service";

export interface DrawingIntelligencePreviewState {
  visualEvidenceCount: number;
  aiDetectionCount: number;
  reconciledCount: number;
  matched: number;
  systemOnly: number;
  aiOnly: number;
  conflicts: number;
  needsVerification: number;
}

export interface DrawingIntelligenceRow {
  id: string;
  elementType: string;
  code: string;
  count: string;
  width: string;
  height: string;
  length: string;
  area: string;
  sourceRef: string;
  aiConfidence: string;
  systemConfidence: string;
  confidence: string;
  status: string;
  extractionStatus:
    | "ready_for_review"
    | "needs_verification"
    | "missing_info"
    | "conversion_required"
    | "unsupported_file"
    | "failed_to_read";
  recommendedAction: DrawingIntelligenceEstimatorAction | "review_manually";
  sheetRef: string;
  notes: string;
  source: string;
}

export const DRAWING_INTELLIGENCE_RESULT_VERSION = "6g-b-runtime-1";

export function isDrawingIntelligenceResultStale(version?: string): boolean {
  return version !== DRAWING_INTELLIGENCE_RESULT_VERSION;
}

export function mapVisualFailureToExtractionStatus(
  sourceFileType: "pdf" | "dxf" | "dwg"
): "conversion_required" | "unsupported_file" | "failed_to_read" {
  if (sourceFileType === "dwg") return "conversion_required";
  if (sourceFileType === "dxf") return "unsupported_file";
  return "failed_to_read";
}

export function canRunDrawingIntelligence(
  runBusy: boolean,
  analysisStatus: "idle" | "running" | "done" | "error"
): { allowed: boolean; reason?: string } {
  if (runBusy) {
    return { allowed: false, reason: "Drawing Intelligence is already running." };
  }
  if (analysisStatus !== "done") {
    return { allowed: false, reason: "Run Package Analysis first." };
  }
  return { allowed: true };
}

export function computeDrawingIntelligenceStats(
  integration: IntegrateDrawingIntelligenceResult | null,
  visualEvidenceCount: number,
  aiDetectionCount: number
): DrawingIntelligencePreviewState {
  const reconciled = integration?.reconciliations ?? [];
  const flattened = reconciled.flatMap((r) => r.reconciledElements);
  return {
    visualEvidenceCount,
    aiDetectionCount,
    reconciledCount: flattened.length,
    matched: flattened.filter((x) => x.matchStatus === "matched").length,
    systemOnly: flattened.filter((x) => x.matchStatus === "system_only").length,
    aiOnly: flattened.filter((x) => x.matchStatus === "ai_only").length,
    conflicts: flattened.filter((x) => x.matchStatus === "conflict").length,
    needsVerification: flattened.filter((x) => x.matchStatus === "needs_verification").length,
  };
}

function fmt(n: number | undefined): string {
  if (typeof n !== "number") return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function measurementDisplay(
  row: ReconciledElement
): { width: string; height: string; note?: string } {
  const suspicious =
    row.measurementRejectedAsSuspicious === true ||
    (row.unresolvedMeasurementReason ?? "").toLowerCase().includes("suspicious");
  if (suspicious) {
    const reason = row.unresolvedMeasurementReason?.trim();
    return { width: "-", height: "-", note: reason || "Suspicious dimension ignored" };
  }

  if (row.linkedMeasurement) {
    return {
      width: fmt(row.hintWidthM),
      height: fmt(row.hintHeightM),
      note: `Linked by ${row.linkedMeasurement.detectionMethod}`,
    };
  }

  if (row.unresolvedMeasurementReason) {
    return { width: "-", height: "-", note: "Dimension missing" };
  }

  return { width: fmt(row.hintWidthM), height: fmt(row.hintHeightM) };
}

function inferType(row: ReconciledElement): string {
  if (row.inferredType) return String(row.inferredType);
  if (row.systemCodeDetection?.normalizedCode) return "system_coded_element";
  return "unknown_facade_element";
}

function mapExtractionStatus(row: ReconciledElement): DrawingIntelligenceRow["extractionStatus"] {
  if (row.measurementRejectedAsSuspicious) return "needs_verification";
  if (row.unresolvedMeasurementReason && row.unresolvedMeasurementReason.includes("No safe")) {
    return "missing_info";
  }
  if (row.matchStatus === "matched" && row.linkedMeasurement && !row.measurementRejectedAsSuspicious) {
    return "ready_for_review";
  }
  if (row.matchStatus === "system_only" || row.matchStatus === "ai_only") return "needs_verification";
  if (row.matchStatus === "conflict" || row.matchStatus === "needs_verification") {
    return "needs_verification";
  }
  return "needs_verification";
}

function systemConfidence(row: ReconciledElement): string {
  const values: Array<"high" | "medium" | "low"> = [];
  if (row.systemCodeDetection?.confidence) values.push(row.systemCodeDetection.confidence);
  if (row.systemDimensionDetection?.confidence) values.push(row.systemDimensionDetection.confidence);
  if (row.systemDxfDetection?.confidence) values.push(row.systemDxfDetection.confidence);
  if (values.length === 0) return "-";
  if (values.includes("low")) return "low";
  if (values.includes("medium")) return "medium";
  return "high";
}

export function toDrawingIntelligenceRows(
  reconciliations: DrawingSheetReconciliation[]
): DrawingIntelligenceRow[] {
  return reconciliations.flatMap((sheet) =>
    sheet.reconciledElements.map((row) => {
      const code =
        row.systemCodeDetection?.normalizedCode ??
        row.systemCodeDetection?.rawText ??
        row.aiDetection?.detectionType ??
        "-";
      const recommendedAction = row.recommendedEstimatorAction ?? "review_manually";
      const dims = measurementDisplay(row);
      const notes = [
        ...row.flaggedIssues,
        ...(dims.note ? [dims.note] : []),
      ]
        .filter((n) => n.trim().length > 0)
        .join(" | ");
      return {
        id: row.id,
        elementType: inferType(row),
        code,
        count: "-",
        width: dims.width,
        height: dims.height,
        length:
          typeof row.systemDimensionDetection?.lengthM === "number"
            ? fmt(row.systemDimensionDetection.lengthM)
            : "-",
        area:
          typeof row.hintWidthM === "number" && typeof row.hintHeightM === "number"
            ? fmt(Number((row.hintWidthM * row.hintHeightM).toFixed(3)))
            : "-",
        sourceRef: row.systemDxfDetection?.layerName
          ? `${row.sheet.drawingName} / p${row.sheet.page} / layer:${row.systemDxfDetection.layerName}${row.systemDxfDetection.blockName ? ` / block:${row.systemDxfDetection.blockName}` : ""}`
          : `${row.sheet.drawingName} / p${row.sheet.page}`,
        aiConfidence:
          typeof row.aiDetection?.aiConfidence === "number"
            ? row.aiDetection.aiConfidence.toFixed(2)
            : "-",
        systemConfidence: systemConfidence(row),
        confidence: row.confidence,
        status: row.matchStatus,
        extractionStatus: mapExtractionStatus(row),
        recommendedAction,
        sheetRef: `${sheet.sheet.drawingName} / page ${sheet.sheet.page}`,
        notes: notes || "-",
        source: row.systemCodeDetection ? "system+ai" : row.aiDetection ? "ai_visual" : "system",
      };
    })
  );
}

export function actionPlaceholdersAreSafe(): true {
  return true;
}

