/**
 * AI Drawing Review Layer — Data Model (Phase 5A)
 *
 * Design principles:
 *  - The AI never mutates quantity values; it only creates Findings.
 *  - Findings carry a suggestedAction but the estimator always decides.
 *  - The mock service is deterministic and free of any API calls.
 */

import type { CrossDrawingBuildResult } from "./cross-drawing-quantity";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type AiReviewStatus =
  | "not_started"
  | "running"
  | "completed"
  | "failed";

// ---------------------------------------------------------------------------
// Risk levels
// ---------------------------------------------------------------------------

export type AiReviewRiskLevel = "low" | "medium" | "high" | "critical";

// ---------------------------------------------------------------------------
// Finding types
// ---------------------------------------------------------------------------

export type AiReviewFindingType =
  | "false_positive"
  | "missing_information"
  | "suspicious_dimension"
  | "source_conflict"
  | "generic_code"
  | "ocr_uncertain"
  | "needs_schedule"
  | "needs_elevation"
  | "needs_section"
  | "quantity_safe"
  | "manual_verification_required"
  | "failed_drawing"
  | "boq_mismatch";

// ---------------------------------------------------------------------------
// Suggested actions (advisory only — estimator has final say)
// ---------------------------------------------------------------------------

export type AiReviewSuggestedAction =
  | "keep_candidate"
  | "reject_candidate"
  | "send_to_missing_info"
  | "mark_needs_verification"
  | "request_manual_check"
  | "no_action";

// ---------------------------------------------------------------------------
// Individual finding
// ---------------------------------------------------------------------------

export interface AiReviewFinding {
  id: string;
  projectId: string;

  /** Optional link to a specific CrossDrawingQuantityCandidate */
  candidateId?: string;
  /** As extracted (may be unnormalised) */
  itemCode?: string;
  /** Normalised form: W-01, CW-06, SD-01, etc. */
  normalizedItemCode?: string;

  findingType: AiReviewFindingType;
  riskLevel: AiReviewRiskLevel;

  title: string;
  message: string;
  recommendation: string;

  /** Evidence rows that informed this finding */
  linkedEvidenceIds: string[];
  /** Source drawing names for traceability */
  sourceDrawingNames: string[];
  /** Source page numbers for traceability */
  sourcePages: number[];

  suggestedAction: AiReviewSuggestedAction;
  /** How certain the AI is that this finding is correct */
  confidence: "low" | "medium" | "high";

  createdAt: string;
}

// ---------------------------------------------------------------------------
// Review result
// ---------------------------------------------------------------------------

export interface AiReviewResult {
  id: string;
  projectId: string;

  status: AiReviewStatus;

  /** Short human-readable summary of the review (counts, highlights) */
  summary: string;

  findings: AiReviewFinding[];

  /** IDs of CrossDrawingQuantityCandidates that were evaluated */
  reviewedCandidateIds: string[];

  /** Package-level warnings that do not belong to a specific candidate */
  warnings: string[];

  /**
   * Runtime metadata for model/provider transparency.
   * Contains no secrets and is safe to return to client UI.
   */
  runtimeMeta?: {
    source: "openai" | "mock" | "mock_fallback";
    modelUsed: string;
    fallbackUsed: boolean;
  };

  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Input to the review engine
// ---------------------------------------------------------------------------

export interface FailedDrawingDiagnostic {
  drawingId: string;
  drawingName: string;
  errorMessage: string;
  suggestion?: string;
}

// ---------------------------------------------------------------------------
// Compact CAD/DXF evidence — Phase 5C
// Only structured metadata is included. Raw DXF/DWG files are never sent.
// ---------------------------------------------------------------------------

export interface AiReviewDxfDrawingSummary {
  drawingId: string;
  drawingName: string;
  units: string;
  /** Layer names and entity counts — no geometry */
  layers: Array<{ name: string; entityCount: number }>;
  /** Block names defined in the drawing */
  blockNames: string[];
  /** Unique text labels extracted from TEXT/MTEXT entities */
  textLabels: string[];
  /** Item codes detected in text labels by pattern matching */
  detectedItemCodes: string[];
  /** Parser-level warnings */
  warnings: string[];
  totalEntityCount: number;
}

export interface AiReviewRunInput {
  projectId: string;

  /** Output of the cross-drawing quantity builder */
  crossDrawingResult?: CrossDrawingBuildResult;

  /** Raw package-level findings — passed through to detect missing drawing types */
  packageAnalysisResult?: {
    hasElevation: boolean;
    hasPlan: boolean;
    hasSchedule: boolean;
    hasSection: boolean;
  };

  /** Unresolved missing-info issues */
  missingInfoItems?: Array<{
    id: string;
    manualItemCode?: string;
    issueType: string;
    status: string;
  }>;

  /** Drawings that failed to load/parse */
  failedDrawingDiagnostics?: FailedDrawingDiagnostic[];

  /** OCR results keyed by drawingId */
  ocrResults?: Record<string, { confidence?: number; hasText?: boolean }>;

  /**
   * Compact structured summaries of parsed DXF/CAD drawings — Phase 5C.
   * Contains layer names, block names, text labels, and detected item codes.
   * Raw DXF/DWG file bytes are NEVER included here.
   */
  dxfEvidence?: AiReviewDxfDrawingSummary[];
}
