/**
 * Drawing Annotation Extraction Service — Phase 4 + Safety Fix
 *
 * Deterministic (no AI) extraction of takeoff candidates from PDF drawing text.
 * Incomplete or duplicate evidence rows are flagged — never defaulted to qty 1.
 */

import type {
  DrawingTakeoffCandidate,
  DrawingCodeRule,
  DrawingTakeoffUnit,
} from "@/types/drawing-takeoff";
import { DRAWING_CODE_RULES } from "@/types/drawing-takeoff";
import { generateId } from "@/lib/utils";
import {
  deduplicateAndGroupCandidates,
  getCandidateMissingFields,
  isDimensionClearlyAttached,
  isGenericUnnumberedCode,
  isScheduleContext,
} from "@/services/takeoff/candidate-safety.service";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DrawingExtractionResult {
  candidates: DrawingTakeoffCandidate[];
  detectedSheetTitle: string | null;
  notes: string[];
}

export function extractFromDrawingText(
  pdfText: string,
  drawingId?: string
): DrawingExtractionResult {
  const notes: string[] = [];

  if (!pdfText || pdfText.trim().length < 10) {
    return {
      candidates: [],
      detectedSheetTitle: null,
      notes: ["PDF has no readable text. Use a text-layer PDF for extraction."],
    };
  }

  const detectedSheetTitle = detectSheetTitle(pdfText);
  const pages = pdfText.split(/---\s*PAGE BREAK\s*---/i);
  const allCandidates: DrawingTakeoffCandidate[] = [];

  pages.forEach((pageText, pageIdx) => {
    const pageCandidates = extractFromPage(
      pageText,
      pageIdx + 1,
      detectedSheetTitle,
      drawingId
    );
    allCandidates.push(...pageCandidates);
  });

  if (allCandidates.length === 0) {
    notes.push(
      "No recognised item codes found. Check that the drawing contains annotation text like W-01, SD-03, BL-R, etc."
    );
  } else {
    const lowCount = allCandidates.filter((c) => c.confidence === "low").length;
    if (lowCount > allCandidates.length / 2) {
      notes.push(
        `${lowCount} of ${allCandidates.length} rows are evidence-only (low confidence) — verify before accepting.`
      );
    }
  }

  const deduped = deduplicateAndGroupCandidates(allCandidates);

  return { candidates: deduped, detectedSheetTitle, notes };
}

// ---------------------------------------------------------------------------
// Per-page extraction
// ---------------------------------------------------------------------------

function extractFromPage(
  text: string,
  pageNumber: number,
  sheetTitle: string | null,
  drawingId?: string
): DrawingTakeoffCandidate[] {
  const candidates: DrawingTakeoffCandidate[] = [];

  for (const rule of DRAWING_CODE_RULES) {
    const codeRE = buildCodeRegex(rule.prefix);
    let match: RegExpExecArray | null;

    while ((match = codeRE.exec(text)) !== null) {
      const fullCode = match[0].trim();
      const contextStart = Math.max(0, match.index - 20);
      const contextEnd = Math.min(text.length, match.index + match[0].length + 120);
      const context = text.substring(contextStart, contextEnd);

      candidates.push(
        buildCandidate(fullCode, context, rule, pageNumber, sheetTitle, drawingId)
      );
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Build a single candidate
// ---------------------------------------------------------------------------

function buildCandidate(
  itemCode: string,
  contextText: string,
  rule: DrawingCodeRule,
  pageNumber: number,
  sheetTitle: string | null,
  drawingId?: string
): DrawingTakeoffCandidate {
  const warnings: string[] = [];
  const genericCode = isGenericUnnumberedCode(itemCode);
  const scheduleSource = isScheduleContext(sheetTitle);

  const clean = contextText.replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b/g, "");
  const dims = findDimensionPair(clean);
  const dimClearlyAttached = dims
    ? isDimensionClearlyAttached(contextText, itemCode)
    : false;
  const count = findCount(clean, dims);
  const rmQty = rule.unit === "lm" ? findRunningMeterQty(clean) : undefined;

  let areaEach: number | undefined;
  let totalArea: number | undefined;
  let length: number | undefined;

  if (rule.unit === "sqm") {
    if (dims) {
      areaEach = round2(dims.w * dims.h);
      if (count !== undefined) {
        totalArea = round2(areaEach * count);
      } else {
        warnings.push("Count not confirmed. Verify from plan or schedule.");
      }
      if (!dimClearlyAttached && !scheduleSource) {
        warnings.push(
          "Possible dimensions found, but source is unclear. Verify manually."
        );
      }
    } else {
      warnings.push(
        "Code found, but width/height/count were not found in this drawing package. Check schedule/elevation/section or enter manually."
      );
    }
  }

  if (rule.unit === "lm") {
    if (rmQty !== undefined) {
      length = rmQty;
    } else if (dims) {
      length = dims.w;
      warnings.push("Length inferred from first dimension — verify manually.");
    } else {
      warnings.push(
        "Code found, but length was not found in this drawing package. Check plan/CAD or enter manually."
      );
    }
  }

  if (genericCode) {
    warnings.push(
      "Generic code found. Confirm exact item code from schedule/elevation."
    );
  }

  const confidence = assignConfidence({
    unit: rule.unit as DrawingTakeoffUnit,
    hasDims: !!dims,
    hasCount: count !== undefined,
    hasRmQty: rmQty !== undefined,
    dimClearlyAttached,
    scheduleSource,
    genericCode,
    warnings,
  });

  const description = genericCode
    ? `Unnumbered ${rule.label} reference`
    : rule.label;

  const candidate: DrawingTakeoffCandidate = {
    _tempId: generateId(),
    rawSnippet: contextText.trim().slice(0, 200),
    drawingId,
    itemCode,
    description,
    category: rule.category,
    count,
    width: dims?.w,
    height: dims?.h,
    areaEach,
    totalArea,
    length,
    unit: rule.unit as DrawingTakeoffUnit,
    sourceType: "drawing_annotation",
    sourcePage: pageNumber,
    sheetTitle: sheetTitle ?? undefined,
    confidence,
    warnings,
    needsVerification: genericCode,
    missingFields: [],
  };

  candidate.missingFields = getCandidateMissingFields(candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// Helpers — dimension pair
// ---------------------------------------------------------------------------

function dimToMetres(v: number): number {
  return v > 50 ? round2(v / 1000) : v;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface DimPair {
  w: number;
  h: number;
}

function findDimensionPair(text: string): DimPair | null {
  const re = /(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/g;
  let best: DimPair | null = null;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const w = dimToMetres(parseFloat(m[1]));
    const h = dimToMetres(parseFloat(m[2]));
    if (w > 0 && h > 0 && w <= 50 && h <= 50) {
      if (!best || w * h > best.w * best.h) {
        best = { w, h };
      }
    }
  }
  return best;
}

function findCount(text: string, dims: DimPair | null): number | undefined {
  const patterns: RegExp[] = [
    /\b(?:qty|nos?|ea|count|no\.?|pcs?|nr)\s*[:=]?\s*(\d+)\b/i,
    /\b(\d+)\s*(?:nos?|ea|pcs?|nr)\b/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1]);
      if (n > 0 && n <= 9999) return n;
    }
  }

  if (dims) {
    const afterDimRe =
      /(?:\d+(?:\.\d+)?)\s*[xX×]\s*(?:\d+(?:\.\d+)?)\s+(\d{1,3})\b/;
    const m2 = text.match(afterDimRe);
    if (m2) {
      const n = parseInt(m2[1]);
      if (n > 0 && n <= 999) return n;
    }
  }

  return undefined;
}

function findRunningMeterQty(text: string): number | undefined {
  const patterns = [
    /\b(?:rm|lm)\s+(\d+(?:\.\d+)?)\b/i,
    /\b(\d+(?:\.\d+)?)\s+(?:rm|lm)\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const v = parseFloat(m[1]);
      if (v > 0 && v <= 99999) return v;
    }
  }
  return undefined;
}

interface ConfidenceInput {
  unit: DrawingTakeoffUnit;
  hasDims: boolean;
  hasCount: boolean;
  hasRmQty: boolean;
  dimClearlyAttached: boolean;
  scheduleSource: boolean;
  genericCode: boolean;
  warnings: string[];
}

function assignConfidence(inp: ConfidenceInput): "high" | "medium" | "low" {
  if (inp.genericCode) return "low";

  const unclearDims = inp.warnings.some((w) =>
    w.includes("source is unclear")
  );

  if (inp.unit === "sqm") {
    if (inp.hasDims && inp.hasCount && (inp.dimClearlyAttached || inp.scheduleSource)) {
      return "high";
    }
    if (inp.hasDims && inp.hasCount && !unclearDims) return "medium";
    return "low";
  }

  if (inp.unit === "lm") {
    if (inp.hasRmQty) return "high";
    if (inp.hasDims && inp.dimClearlyAttached) return "medium";
    return "low";
  }

  return "low";
}

const SHEET_TITLE_PATTERNS: RegExp[] = [
  /\b(ELEVATION\s*[-–]?\s*(?:NORTH|SOUTH|EAST|WEST|[A-D]))\b/i,
  /\b(FLOOR\s+PLAN(?:\s+[-–]\s*[^\n]+)?)\b/i,
  /\b(SECTION\s+[A-Z]-[A-Z])\b/i,
  /\b(ROOF\s+PLAN)\b/i,
  /\b(SITE\s+PLAN)\b/i,
  /\b(GROUND\s+FLOOR\s+PLAN)\b/i,
  /\b(TYPICAL\s+FLOOR\s+PLAN)\b/i,
  /\b(DETAIL\s+[-–]\s*[^\n,]{2,30})\b/i,
  /\b(SCHEDULE\s*[-–]\s*[^\n,]{2,30})\b/i,
  /\b(WINDOW\s+SCHEDULE)\b/i,
  /\b(DOOR\s+SCHEDULE)\b/i,
];

function detectSheetTitle(text: string): string | null {
  const upper = text.slice(0, 500).toUpperCase();
  for (const re of SHEET_TITLE_PATTERNS) {
    const m = upper.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function buildCodeRegex(prefix: string): RegExp {
  const escaped = prefix.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");

  if (/^[A-Z]$/.test(prefix)) {
    return new RegExp(`\\b${escaped}-\\d{1,3}(?:-\\d+)?\\b`, "g");
  }

  return new RegExp(`\\b${escaped}(?:-\\d{1,3})?\\b`, "g");
}
