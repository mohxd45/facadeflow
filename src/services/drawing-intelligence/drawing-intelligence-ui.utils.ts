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
  width: string;
  height: string;
  confidence: string;
  status: string;
  recommendedAction: DrawingIntelligenceEstimatorAction | "review_manually";
  sheetRef: string;
  notes: string;
  source: string;
}

export const DRAWING_INTELLIGENCE_RESULT_VERSION = "6g-b-runtime-1";

export function isDrawingIntelligenceResultStale(version?: string): boolean {
  return version !== DRAWING_INTELLIGENCE_RESULT_VERSION;
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
    return { width: "-", height: "-", note: "Suspicious dimension ignored" };
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
        width: dims.width,
        height: dims.height,
        confidence: row.confidence,
        status: row.matchStatus,
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

