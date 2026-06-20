/**
 * Cross-Drawing Quantity Builder — Data Model (Phase 4A)
 *
 * Represents quantity candidates that may be assembled from evidence across
 * multiple drawings: plan, elevation, schedule, section, detail, DXF, OCR.
 *
 * Key design rules (never violated by this phase):
 *  - Values are never invented.
 *  - OCR-sourced evidence never elevates to high confidence.
 *  - Generic codes (W, SD, CW) stay needs_verification.
 *  - totals are only calculated when all required fields are explicitly present.
 *  - Estimator approval is always required before a candidate becomes final.
 */

import type { DrawingPackageType } from "./drawing-package";
import type { DrawingItemCategory, DrawingTakeoffUnit } from "./drawing-takeoff";

// ---------------------------------------------------------------------------
// Source type for a single value within a candidate
// ---------------------------------------------------------------------------

export type CrossDrawingSourceType =
  | "pdf_text"          // text layer extracted from a PDF
  | "ocr_text"          // scanned PDF via Tesseract OCR — confidence capped
  | "manual"            // manually entered by estimator
  | "dxf"               // measured from DXF geometry
  | "cad"               // measured from CAD source
  | "plan"              // extracted from a floor plan drawing
  | "schedule"          // row parsed from a window/door/material schedule
  | "elevation"         // coordinates or labels extracted from elevation drawing
  | "section"           // thickness / depth from section or detail drawing
  | "detail"            // profile / fixing detail
  | "package_evidence"  // aggregated from the Phase 3 package analysis candidates
  | "unknown";

// ---------------------------------------------------------------------------
// Value source — describes exactly where one field value came from
// ---------------------------------------------------------------------------

export interface CrossDrawingValueSource {
  drawingId: string;
  drawingName: string;
  /** Drawing type (plan, elevation, schedule, etc.) — if known */
  drawingType?: DrawingPackageType | string;
  pageNumber?: number;
  sourceType: CrossDrawingSourceType;
  /** ID of the DrawingEvidence or DrawingTakeoffCandidate this value came from */
  evidenceId?: string;
  /** Raw snippet text for traceability */
  rawText?: string;
  confidence: "low" | "medium" | "high";
}

// ---------------------------------------------------------------------------
// Status lifecycle
// ---------------------------------------------------------------------------

export type CrossDrawingQuantityStatus =
  | "draft"               // auto-generated; not reviewed
  | "needs_verification"  // incomplete or low-confidence; needs estimator action
  | "verified"            // estimator approved all values
  | "rejected"            // estimator rejected this candidate
  | "final";              // included in final quantity takeoff

// ---------------------------------------------------------------------------
// Cross-drawing quantity candidate
// ---------------------------------------------------------------------------

export interface CrossDrawingQuantityCandidate {
  id: string;
  projectId: string;

  /** Item code as extracted (may not yet be normalised) */
  itemCode: string;
  /** Normalised code: W-01, CW-06, SD-01, etc. */
  normalizedItemCode: string;
  description: string;
  category: DrawingItemCategory | string;
  unit: DrawingTakeoffUnit | string;

  // ── Quantity fields ───────────────────────────────────────────────────────
  /** Number of identical items (nos). undefined = not yet confirmed. */
  count?: number;
  /** Width in metres. */
  width?: number;
  /** Height in metres. */
  height?: number;
  /** Glass or cladding thickness in metres (e.g. 0.012 = 12 mm). */
  thickness?: number;
  /** Frame or cladding depth / projection (metres). */
  depthOrProjection?: number;
  /** Running length (lm items). */
  length?: number;
  /** Area per unit = width × height (sqm). Only set when both dims are present. */
  areaEach?: number;
  /** Total area = areaEach × count (sqm). Only set when count is also known. */
  totalArea?: number;
  /** Material description. */
  material?: string;
  /** Glass specification (e.g. "10mm tempered + 12mm air + 6mm clear"). */
  glassType?: string;
  /** Frame type (e.g. "Thermally broken aluminium"). */
  frameType?: string;

  // ── Per-field provenance ──────────────────────────────────────────────────
  countSource?: CrossDrawingValueSource;
  widthSource?: CrossDrawingValueSource;
  heightSource?: CrossDrawingValueSource;
  thicknessSource?: CrossDrawingValueSource;
  lengthSource?: CrossDrawingValueSource;
  areaSource?: CrossDrawingValueSource;
  materialSource?: CrossDrawingValueSource;
  glassTypeSource?: CrossDrawingValueSource;
  frameTypeSource?: CrossDrawingValueSource;

  // ── Cross-drawing linkage ─────────────────────────────────────────────────
  /** IDs of all DrawingTakeoffCandidates / DrawingEvidence rows feeding this. */
  linkedEvidenceIds: string[];
  /** DrawingFile IDs of all drawings that contributed to this candidate. */
  sourceDrawingIds: string[];
  /** DrawingFile names (for display without resolving ids). */
  sourceDrawingNames: string[];
  /** Page numbers across all source drawings. */
  sourcePages: number[];
  /** How many times the item code was spotted across the package. */
  occurrenceCount: number;

  // ── Quality / completeness ────────────────────────────────────────────────
  /** Fields that must be filled before this can be saved as verified. */
  missingFields: string[];
  /** Non-blocking notes about data quality (not errors). */
  warnings: string[];
  /** Human-readable chain of decisions that produced this candidate. */
  reasoning: string[];

  // ── Possible (conflicting/unresolved) values — Phase 4C ──────────────────
  /** All width values found across sources (for display/conflict diagnosis). */
  possibleWidths?: number[];
  /** All height values found across sources. */
  possibleHeights?: number[];
  /** All count values found across sources. */
  possibleCounts?: number[];
  /** All length values found across sources. */
  possibleLengths?: number[];
  /** All area values found across sources. */
  possibleAreas?: number[];
  confidence: "low" | "medium" | "high";
  status: CrossDrawingQuantityStatus;

  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Build input
// ---------------------------------------------------------------------------

/**
 * Everything the builder needs to cross-reference. Typed loosely because the
 * exact DrawingFile / ClassifiedDrawing / etc. types live in other modules;
 * the service narrows what it needs internally.
 */
export interface CrossDrawingBuildInput {
  projectId: string;
  /** All DrawingFile records for the project. */
  drawings: DrawingFileRef[];
  /** Output of classifyDrawingByText / classifyDrawingByName per drawing. */
  classifiedDrawings: ClassifiedDrawingRef[];
  /** Flat list of DrawingEvidence items (one per drawing that had text). */
  evidenceItems: EvidenceItemRef[];
  /** Flat list of DrawingTakeoffCandidates from all evidence rows. */
  drawingTakeoffCandidates: TakeoffCandidateRef[];
  /** DrawingIssueItems for this project (missing info). */
  missingInfoItems: MissingInfoRef[];
  /** Optional company-specific rules (reserved for Phase 4B+). */
  companyRules?: Record<string, unknown>;
}

/** Minimal shape expected from DrawingFile — keeps cross-module coupling low. */
export interface DrawingFileRef {
  id: string;
  fileName: string;
  fileType: string;
  notes?: string | null;
}

/** Minimal shape expected from ClassifiedDrawing. */
export interface ClassifiedDrawingRef {
  drawingId: string;
  drawingType: DrawingPackageType | string;
  confidence: "high" | "medium" | "low";
  analysisStatus?: string;
}

/** Minimal shape expected from DrawingEvidence. */
export interface EvidenceItemRef {
  drawingId: string;
  drawingName: string;
  drawingType: DrawingPackageType | string;
  classificationConfidence: "high" | "medium" | "low";
  textSource?: string;
  candidates: TakeoffCandidateRef[];
}

/** Minimal shape expected from DrawingTakeoffCandidate. */
export interface TakeoffCandidateRef {
  _tempId: string;
  itemCode?: string;
  description: string;
  category: string;
  unit: string;
  count?: number;
  width?: number;
  height?: number;
  areaEach?: number;
  totalArea?: number;
  length?: number;
  thickness?: number;
  sourcePage?: number;
  sheetTitle?: string;
  sourceType?: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  rawSnippet: string;
  drawingId?: string;
  needsVerification?: boolean;
  occurrenceCount?: number;
  linkedEvidenceIds?: string[];
}

/** Minimal shape expected from DrawingIssueItem. */
export interface MissingInfoRef {
  id: string;
  manualItemCode?: string;
  issueType: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Build result
// ---------------------------------------------------------------------------

export interface CrossDrawingBuildResult {
  projectId: string;
  candidates: CrossDrawingQuantityCandidate[];
  /** IDs of MissingInfoRef items that remain unresolved after building. */
  unresolvedIssueIds: string[];
  warnings: string[];
  stats: CrossDrawingBuildStats;
}

export interface CrossDrawingBuildStats {
  totalEvidence: number;
  groupedItems: number;
  completeCandidates: number;
  needsVerification: number;
  missingInfoCreated: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  /** Candidates that have conflicting values across sources — Phase 4C */
  conflictingValues: number;
  /** Candidates with a bare generic code (W, SD, CW …) — Phase 4C */
  genericCodes: number;
  /** Candidates whose values all come from OCR — Phase 4C */
  ocrSourcedCandidates: number;
}

// ---------------------------------------------------------------------------
// Debug summary
// ---------------------------------------------------------------------------

export interface CrossDrawingBuildSummary {
  groupedItems: number;
  completeCandidates: number;
  needsVerification: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  warnings: string[];
}
