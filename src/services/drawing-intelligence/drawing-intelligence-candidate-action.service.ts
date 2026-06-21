/**
 * Drawing Intelligence Candidate Action Service — Phase 6F
 *
 * Converts reconciled drawing-intelligence rows into safe takeoff/issue actions.
 * All outputs remain non-final unless estimator explicitly finalizes later.
 */

import type { ReconciledElement } from "@/types/drawing-intelligence";
import type {
  CreateDrawingIssueItemInput,
  CreateDrawingTakeoffItemInput,
  DrawingIssueItem,
  DrawingIssueType,
  DrawingTakeoffItem,
} from "@/types/drawing-takeoff";

export type DrawingIntelligenceActionOutcome =
  | "created"
  | "duplicate"
  | "blocked"
  | "acknowledged"
  | "error";

export interface DrawingIntelligenceActionResult {
  outcome: DrawingIntelligenceActionOutcome;
  message: string;
}

function inferCategory(code: string, inferredType?: string): CreateDrawingTakeoffItemInput["category"] {
  const upper = code.toUpperCase();
  if (upper.startsWith("W-") || upper.startsWith("V-")) return "windows";
  if (upper.startsWith("D-") || upper.startsWith("ED-") || upper.startsWith("SD-")) return "doors";
  if (upper.startsWith("CW-")) return "curtain_wall_glass_panel";
  if (upper.startsWith("ACP")) return "acp_cladding";
  if (upper.startsWith("BL-R")) return "glass_balustrade";
  if (upper.startsWith("LUR") || upper.startsWith("LV-")) return "louvers";

  switch (inferredType) {
    case "possible_window":
      return "windows";
    case "possible_door":
    case "possible_sliding_door":
      return "doors";
    case "possible_curtain_wall":
      return "curtain_wall_glass_panel";
    case "possible_acp":
      return "acp_cladding";
    case "possible_railing":
      return "balcony_railing";
    case "possible_louver":
      return "louvers";
    default:
      return "other";
  }
}

function inferUnit(category: CreateDrawingTakeoffItemInput["category"]): CreateDrawingTakeoffItemInput["unit"] {
  if (category === "glass_balustrade" || category === "balcony_railing" || category === "aluminium_fins") {
    return "lm";
  }
  return "sqm";
}

function markerForElement(elementId: string): string {
  return `DI_RECON:${elementId}`;
}

function hasElementMarker(notesOrReason: string | undefined, elementId: string): boolean {
  if (!notesOrReason) return false;
  return notesOrReason.includes(markerForElement(elementId));
}

function inferConfidence(element: ReconciledElement): CreateDrawingTakeoffItemInput["confidence"] {
  if (element.matchStatus === "matched") return "high";
  if (element.matchStatus === "system_only") return "medium";
  return "low";
}

export function buildSafeTakeoffDraftFromReconciled(
  element: ReconciledElement,
  projectId: string
): { input: CreateDrawingTakeoffItemInput | null; blockedReason?: string } {
  if (element.matchStatus === "conflict") {
    return {
      input: null,
      blockedReason:
        "Conflict result cannot be accepted as a quantity candidate. Resolve conflict first.",
    };
  }

  const code =
    element.systemCodeDetection?.normalizedCode ??
    element.systemCodeDetection?.rawText ??
    element.aiDetection?.detectionType ??
    "UNCODED";
  const category = inferCategory(code, element.inferredType ? String(element.inferredType) : undefined);
  const unit = inferUnit(category);
  const status: CreateDrawingTakeoffItemInput["status"] =
    element.matchStatus === "matched" || (element.matchStatus === "system_only" && !!element.systemDimensionDetection)
      ? "draft"
      : "needs_verification";

  const width =
    typeof element.systemDimensionDetection?.widthM === "number"
      ? element.systemDimensionDetection.widthM
      : typeof element.hintWidthM === "number"
        ? element.hintWidthM
        : undefined;
  const height =
    typeof element.systemDimensionDetection?.heightM === "number"
      ? element.systemDimensionDetection.heightM
      : typeof element.hintHeightM === "number"
        ? element.hintHeightM
        : undefined;
  const areaEach =
    typeof width === "number" && typeof height === "number" && unit === "sqm"
      ? Number((width * height).toFixed(3))
      : undefined;

  const sourceDrawingName = element.sheet.drawingName;
  const sourcePage = element.sheet.page;
  const notes = `Created from Drawing Intelligence reconciliation. ${markerForElement(element.id)}. status=${element.matchStatus}.`;

  return {
    input: {
      projectId,
      drawingId: element.sheet.drawingId,
      sourcePage,
      sheetTitle: element.sheet.sheetTitle,
      sourceDrawingName,
      itemCode: code,
      description: `Drawing Intelligence ${category.replace(/_/g, " ")}`,
      category,
      count: unit === "nos" ? 1 : undefined,
      width,
      height,
      areaEach,
      totalArea: undefined, // Never auto-finalize totals from AI intelligence flow.
      length: undefined,
      unit,
      sourceType: "manual_verify",
      confidence: inferConfidence(element),
      warnings: [
        ...element.flaggedIssues,
        "Created from Drawing Intelligence — estimator verification required.",
      ],
      status,
      notes,
      itemSource: sourceDrawingName,
      widthSource: sourceDrawingName,
      heightSource: sourceDrawingName,
      areaSource: sourceDrawingName,
      missingFields:
        status === "needs_verification"
          ? ["verification_required"]
          : undefined,
    },
  };
}

export function isDuplicateTakeoffFromReconciled(
  element: ReconciledElement,
  existingItems: DrawingTakeoffItem[]
): boolean {
  return existingItems.some((item) => hasElementMarker(item.notes, element.id));
}

export function computeAcceptAsCandidateResult(
  element: ReconciledElement,
  projectId: string,
  existingItems: DrawingTakeoffItem[]
): { result: DrawingIntelligenceActionResult; input: CreateDrawingTakeoffItemInput | null } {
  if (isDuplicateTakeoffFromReconciled(element, existingItems)) {
    return {
      result: { outcome: "duplicate", message: "Candidate already created from this reconciled row." },
      input: null,
    };
  }

  const built = buildSafeTakeoffDraftFromReconciled(element, projectId);
  if (!built.input) {
    return {
      result: { outcome: "blocked", message: built.blockedReason ?? "Candidate creation blocked." },
      input: null,
    };
  }

  return {
    result: { outcome: "created", message: "Candidate draft created from Drawing Intelligence." },
    input: built.input,
  };
}

function mapIssueType(element: ReconciledElement): DrawingIssueType {
  if (element.matchStatus === "conflict") return "manual_measurement_required";
  if (element.matchStatus === "needs_verification") return "uncoded_opening";
  if (!element.systemDimensionDetection) return "missing_width";
  return "unclear_item";
}

export function buildMissingInfoFromReconciled(
  element: ReconciledElement,
  projectId: string
): CreateDrawingIssueItemInput {
  const code = element.systemCodeDetection?.normalizedCode ?? element.systemCodeDetection?.rawText;
  return {
    projectId,
    sourceDrawingId: element.sheet.drawingId,
    sourceDrawingName: element.sheet.drawingName,
    sourcePage: element.sheet.page,
    sourceSheetTitle: element.sheet.sheetTitle,
    issueType: mapIssueType(element),
    possibleCategory: inferCategory(code ?? "UNCODED", String(element.inferredType ?? "")),
    possibleDescription: `Drawing Intelligence ${element.matchStatus} finding`,
    detectedEvidence: code
      ? `Code ${code}; status ${element.matchStatus}.`
      : `AI visual ${element.aiDetection?.detectionType ?? "unknown"}; status ${element.matchStatus}.`,
    missingFields:
      element.matchStatus === "conflict"
        ? ["conflict_resolution"]
        : element.matchStatus === "needs_verification" || element.matchStatus === "ai_only"
          ? ["code", "dimensions"]
          : ["verification_required"],
    suggestedUnit: inferUnit(inferCategory(code ?? "UNCODED", String(element.inferredType ?? ""))),
    confidence: element.confidence,
    reason: `Created from Drawing Intelligence. ${markerForElement(element.id)}.`,
    recommendation:
      element.matchStatus === "conflict"
        ? "Resolve dimension/code conflict with estimator review."
        : "Verify and complete required fields before takeoff finalization.",
    status: "open",
    manualItemCode: code,
  };
}

export function isDuplicateIssueFromReconciled(
  element: ReconciledElement,
  existingIssues: DrawingIssueItem[]
): boolean {
  return existingIssues.some(
    (issue) =>
      issue.status === "open" &&
      hasElementMarker(issue.reason, element.id)
  );
}

export function computeCreateMissingInfoResult(
  element: ReconciledElement,
  projectId: string,
  existingIssues: DrawingIssueItem[]
): { result: DrawingIntelligenceActionResult; input: CreateDrawingIssueItemInput | null } {
  if (isDuplicateIssueFromReconciled(element, existingIssues)) {
    return {
      result: { outcome: "duplicate", message: "Missing Info issue already exists for this row." },
      input: null,
    };
  }
  return {
    result: { outcome: "created", message: "Missing Info issue created from Drawing Intelligence." },
    input: buildMissingInfoFromReconciled(element, projectId),
  };
}

export function computeCreateClarificationResult(
  element: ReconciledElement,
  projectId: string,
  existingIssues: DrawingIssueItem[]
): { result: DrawingIntelligenceActionResult; input: CreateDrawingIssueItemInput | null } {
  if (isDuplicateIssueFromReconciled(element, existingIssues)) {
    return {
      result: { outcome: "duplicate", message: "Clarification issue already exists for this row." },
      input: null,
    };
  }
  const base = buildMissingInfoFromReconciled(element, projectId);
  return {
    result: { outcome: "created", message: "Clarification draft created from Drawing Intelligence." },
    input: {
      ...base,
      issueType: "manual_measurement_required",
      recommendation: "Create clarification/RFI to confirm dimensions or coding from design team.",
    },
  };
}

export function rejectSuggestionSafely(
  element: ReconciledElement
): DrawingIntelligenceActionResult {
  void element;
  return {
    outcome: "acknowledged",
    message:
      "Suggestion rejected locally. Source reconciliation data is preserved and can be reviewed again.",
  };
}

export function noFinalOrVerifiedFromAiOnly(
  input: CreateDrawingTakeoffItemInput
): boolean {
  return input.status !== "verified" && input.status !== "final";
}

