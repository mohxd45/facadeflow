/**
 * Drawing Package Classifier Service — Phase 1B (rewritten)
 *
 * Priority-based classification.  Earlier priorities cannot be overridden by
 * later ones.
 *
 *   Priority 1 — Drawing number patterns (BB4xxx, L0x, TOR …)
 *   Priority 2 — Filename keywords          (Floor Plan, Elevation, Sections …)
 *   Priority 3 — Title-block text           (first ~400 chars of extracted text)
 *   Priority 4 — Body keywords              (first ~2 000 chars, restricted)
 *
 * IMPORTANT SAFETY RULES:
 *   • "balustrade_detail" is NEVER assigned from body text alone.
 *     Balustrade / railing keywords found in body text are item-level evidence,
 *     not the drawing type.  The type is only set when the filename or title
 *     block explicitly says "Balustrade Detail" / "Railing Detail".
 *
 *   • Classification confidence reflects how many corroborating signals were
 *     found — it does NOT represent quantity accuracy.
 */

import type {
  ClassifiedDrawing,
  DrawingPackageType,
  DrawingAnalysisStatus,
  OcrStatus,
} from "@/types/drawing-package";

// ---------------------------------------------------------------------------
// Internal match shape
// ---------------------------------------------------------------------------

interface ClassificationMatch {
  type: DrawingPackageType;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Priority 1a — architectural drawing-number ranges (BB4xxx style)
//
// These codes follow a common MEP/architectural numbering convention used in
// Middle-East & Australian practice.  Add project-specific overrides at the
// top of your company rules if needed.
// ---------------------------------------------------------------------------

const BB_NUMBER_RANGES: Array<{ pattern: RegExp; type: DrawingPackageType; label: string }> = [
  { pattern: /BB40\d{2}/i, type: "general",   label: "BB40xx — General/Drawing list" },
  { pattern: /BB41\d{2}/i, type: "plan",       label: "BB41xx — Floor plan" },
  { pattern: /BB42\d{2}/i, type: "elevation",  label: "BB42xx — Elevation" },
  { pattern: /BB43\d{2}/i, type: "section",    label: "BB43xx — Building section" },
  { pattern: /BB44\d{2}/i, type: "section",    label: "BB44xx — Wall section" },
  { pattern: /BB45\d{2}/i, type: "detail",     label: "BB45xx — Detail" },
  { pattern: /BB50\d{2}/i, type: "schedule",   label: "BB50xx — Schedule" },
];

// ---------------------------------------------------------------------------
// Priority 1b — floor / level shortcodes in the filename
// ---------------------------------------------------------------------------

const LEVEL_CODE_PATTERNS: Array<{ pattern: RegExp; type: DrawingPackageType; label: string }> = [
  { pattern: /\bL0[0-9]\b/i,  type: "plan", label: "Floor-level code (L0x)" },
  { pattern: /\bTOR\b/,        type: "plan", label: "Top-of-Roof level code" },
  { pattern: /\bROOF\b/i,      type: "plan", label: "Roof keyword" },
  { pattern: /\bGFL?\b/,       type: "plan", label: "Ground Floor Level" },
  { pattern: /\bFFL?\b/,       type: "plan", label: "First Floor Level" },
  { pattern: /\b1FL?\b/i,      type: "plan", label: "1st Floor Level" },
  { pattern: /\b2FL?\b/i,      type: "plan", label: "2nd Floor Level" },
];

// ---------------------------------------------------------------------------
// Priority 2 — filename phrase keywords (ordered most-specific first)
// ---------------------------------------------------------------------------

const FILENAME_PHRASE_PATTERNS: Array<{
  pattern: RegExp;
  type: DrawingPackageType;
  confidence: "high" | "medium";
}> = [
  // Plans (most specific → least specific)
  { pattern: /GROUND\s+FLOOR\s+PLAN|FIRST\s+FLOOR\s+PLAN|SECOND\s+FLOOR\s+PLAN|THIRD\s+FLOOR\s+PLAN|FOURTH\s+FLOOR\s+PLAN|ROOF\s+PLAN|TYPICAL\s+FLOOR\s+PLAN|FLOOR\s+PLAN|SITE\s+PLAN/i,
    type: "plan", confidence: "high" },
  // Elevations
  { pattern: /BUILDING\s+ELEVATIONS?|ELEVATION\s+SHEET|FACADE\s+ELEVATION|EXTERNAL\s+ELEVATION/i,
    type: "elevation", confidence: "high" },
  // Sections
  { pattern: /BUILDING\s+SECTIONS?|WALL\s+SECTIONS?|LONGITUDINAL\s+SECTION|CROSS\s+SECTION|TYPICAL\s+SECTION/i,
    type: "section", confidence: "high" },
  // Schedules
  { pattern: /WINDOW\s+SCHEDULE|DOOR\s+SCHEDULE|FINISH\s+SCHEDULE|MATERIAL\s+SCHEDULE|ROOM\s+SCHEDULE/i,
    type: "schedule", confidence: "high" },
  // General / drawing list
  { pattern: /GENERAL\s+NOTES?|DRAWING\s+LIST|DRAWING\s+INDEX|GENERAL\s+ARRANGEMENT|COVER\s+SHEET/i,
    type: "general", confidence: "high" },
  // Balustrade / railing detail — ONLY when explicitly stated
  { pattern: /GLASS\s+BALUSTRADE\s+DETAIL|RAILING\s+DETAIL|HANDRAIL\s+DETAIL|BALUSTRADE\s+DETAIL/i,
    type: "balustrade_detail", confidence: "high" },
  // Generic single-word fallbacks (medium confidence)
  { pattern: /\bELEVATIONS?\b/i,  type: "elevation", confidence: "medium" },
  { pattern: /\bSECTIONS?\b/i,    type: "section",   confidence: "medium" },
  { pattern: /\bSCHEDULE\b/i,     type: "schedule",  confidence: "medium" },
  { pattern: /\bDETAILS?\b/i,     type: "detail",    confidence: "medium" },
  { pattern: /\bLAYOUT\b|\bPLAN\b/i, type: "plan",   confidence: "medium" },
];

// ---------------------------------------------------------------------------
// Priority 3 — title-block text (first ~400 chars of PDF text)
// ---------------------------------------------------------------------------

const TITLE_BLOCK_PATTERNS: Array<{
  pattern: RegExp;
  type: DrawingPackageType;
  confidence: "high" | "medium";
}> = [
  { pattern: /GROUND\s+FLOOR\s+PLAN|FIRST\s+FLOOR\s+PLAN|SECOND\s+FLOOR\s+PLAN|THIRD\s+FLOOR\s+PLAN|ROOF\s+PLAN|TYPICAL\s+FLOOR\s+PLAN|SITE\s+PLAN/i,
    type: "plan", confidence: "high" },
  { pattern: /BUILDING\s+ELEVATIONS?|ELEVATION\s+SHEET\s*\d|EXTERNAL\s+ELEVATIONS?/i,
    type: "elevation", confidence: "high" },
  { pattern: /BUILDING\s+SECTIONS?|WALL\s+SECTIONS?/i,
    type: "section", confidence: "high" },
  { pattern: /WINDOW\s+SCHEDULE|DOOR\s+SCHEDULE|FINISH\s+SCHEDULE/i,
    type: "schedule", confidence: "high" },
  { pattern: /GENERAL\s+NOTES?|DRAWING\s+LIST|DRAWING\s+INDEX/i,
    type: "general", confidence: "high" },
  // Balustrade detail — only from explicit title
  { pattern: /GLASS\s+BALUSTRADE\s+DETAIL|HANDRAIL\s+DETAIL|RAILING\s+DETAIL/i,
    type: "balustrade_detail", confidence: "high" },
  // Generic medium
  { pattern: /NORTH\s+ELEVATION|SOUTH\s+ELEVATION|EAST\s+ELEVATION|WEST\s+ELEVATION/i,
    type: "elevation", confidence: "high" },
  { pattern: /TYPICAL\s+DETAIL|FIXING\s+DETAIL|CONNECTION\s+DETAIL/i,
    type: "detail", confidence: "medium" },
  { pattern: /\bELEVATION\b/i, type: "elevation", confidence: "medium" },
  { pattern: /\bSECTION\b/i,   type: "section",   confidence: "medium" },
  { pattern: /\bSCHEDULE\b/i,  type: "schedule",  confidence: "medium" },
  { pattern: /\bPLAN\b/i,      type: "plan",       confidence: "medium" },
];

// ---------------------------------------------------------------------------
// Priority 4 — body keywords (NEVER assigns balustrade_detail)
// ---------------------------------------------------------------------------

const BODY_KEYWORD_PATTERNS: Array<{
  pattern: RegExp;
  type: Exclude<DrawingPackageType, "balustrade_detail">;
  confidence: "medium" | "low";
}> = [
  // Strong multi-word patterns first
  { pattern: /FLOOR\s+PLAN|GROUND\s+FLOOR|FIRST\s+FLOOR|SECOND\s+FLOOR/i,
    type: "plan", confidence: "medium" },
  { pattern: /ELEVATION\s+(?:NORTH|SOUTH|EAST|WEST|A|B|C|D|\d)/i,
    type: "elevation", confidence: "medium" },
  { pattern: /SECTION\s+[A-Z0-9]-[A-Z0-9]|SECTION\s+\d/i,
    type: "section", confidence: "medium" },
  { pattern: /WINDOW\s+SCHEDULE|DOOR\s+SCHEDULE/i,
    type: "schedule", confidence: "medium" },
  // Single-word fallbacks
  { pattern: /\bELEVATION\b/i, type: "elevation", confidence: "low" },
  { pattern: /\bSECTION\b/i,   type: "section",   confidence: "low" },
  { pattern: /\bSCHEDULE\b/i,  type: "schedule",  confidence: "low" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchByDrawingNumber(fileName: string): ClassificationMatch | null {
  for (const { pattern, type, label } of BB_NUMBER_RANGES) {
    if (pattern.test(fileName)) {
      return { type, confidence: "high", reasons: [label] };
    }
  }
  for (const { pattern, type, label } of LEVEL_CODE_PATTERNS) {
    if (pattern.test(fileName)) {
      return { type, confidence: "high", reasons: [label] };
    }
  }
  return null;
}

function matchByFilenameKeywords(fileName: string): ClassificationMatch | null {
  for (const { pattern, type, confidence } of FILENAME_PHRASE_PATTERNS) {
    if (pattern.test(fileName)) {
      return { type, confidence, reasons: [`Filename keyword: ${type}`] };
    }
  }
  return null;
}

function matchByTitleBlock(titleText: string): ClassificationMatch | null {
  for (const { pattern, type, confidence } of TITLE_BLOCK_PATTERNS) {
    if (pattern.test(titleText)) {
      return { type, confidence, reasons: [`Title block: ${type}`] };
    }
  }
  return null;
}

function matchByBodyKeywords(bodyText: string): ClassificationMatch | null {
  // Count matches per type
  const scores = new Map<DrawingPackageType, { count: number; confidence: "medium" | "low" }>();
  for (const { pattern, type, confidence } of BODY_KEYWORD_PATTERNS) {
    if (pattern.test(bodyText)) {
      const current = scores.get(type);
      scores.set(type, {
        count: (current?.count ?? 0) + 1,
        confidence: current?.confidence === "medium" ? "medium" : confidence,
      });
    }
  }
  if (scores.size === 0) return null;

  const [type, { count, confidence }] = [...scores.entries()].sort(
    (a, b) => b[1].count - a[1].count
  )[0];

  return {
    type,
    confidence: count >= 3 ? "medium" : confidence,
    reasons: [`Body keywords matched (${count} signal${count > 1 ? "s" : ""})`],
  };
}

/** Extract the most likely sheet/drawing title from the beginning of the text. */
function extractSheetTitle(text: string): string | null {
  const sample = text.slice(0, 600).toUpperCase();

  const SHEET_TITLE_PATTERNS: RegExp[] = [
    /\b(GROUND\s+FLOOR\s+PLAN)\b/i,
    /\b(FIRST\s+FLOOR\s+PLAN)\b/i,
    /\b(SECOND\s+FLOOR\s+PLAN)\b/i,
    /\b(THIRD\s+FLOOR\s+PLAN)\b/i,
    /\b(TYPICAL\s+FLOOR\s+PLAN)\b/i,
    /\b(ROOF\s+PLAN)\b/i,
    /\b(SITE\s+PLAN)\b/i,
    /\b(BUILDING\s+ELEVATIONS?)\b/i,
    /\b(ELEVATION\s+SHEET\s*\d)\b/i,
    /\b(NORTH\s+ELEVATION|SOUTH\s+ELEVATION|EAST\s+ELEVATION|WEST\s+ELEVATION)\b/i,
    /\b(BUILDING\s+SECTIONS?)\b/i,
    /\b(WALL\s+SECTIONS?\s*(?:SHEET\s*\d)?)\b/i,
    /\b(GENERAL\s+NOTES?)\b/i,
    /\b(DRAWING\s+LIST|DRAWING\s+INDEX)\b/i,
    /\b(WINDOW\s+SCHEDULE|DOOR\s+SCHEDULE)\b/i,
  ];

  for (const re of SHEET_TITLE_PATTERNS) {
    const m = sample.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

/** Default Phase 1B fields for a ClassifiedDrawing that has not been analysed. */
function defaultAnalysisFields(
  status: DrawingAnalysisStatus = "not_analysed",
  notes: string[] = []
) {
  return {
    analysisStatus: status,
    needsOcr: false,
    ocrStatus: "not_needed" as OcrStatus,
    extractionNotes: notes,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fast classification based solely on filename + file type.
 * No PDF text extraction required.
 * Used for the pre-analysis Package Summary view.
 */
export function classifyDrawingByName(
  fileName: string,
  fileType: string,
  drawingId = ""
): ClassifiedDrawing {
  if (fileType === "dxf" || fileType === "dwg") {
    return {
      drawingId,
      drawingName: fileName,
      fileType,
      drawingType: "cad_dxf",
      sheetTitle: null,
      confidence: "high",
      reasons: ["File type is DXF/DWG"],
      ...defaultAnalysisFields("unsupported_format", [
        "DXF/DWG files are supported in the DXF Layer Mapping tab.",
      ]),
    };
  }

  const p1 = matchByDrawingNumber(fileName);
  const p2 = matchByFilenameKeywords(fileName);
  const match = p1 ?? p2;

  if (match) {
    return {
      drawingId,
      drawingName: fileName,
      fileType,
      drawingType: match.type,
      sheetTitle: null,
      confidence: match.confidence,
      reasons: match.reasons,
      ...defaultAnalysisFields("not_analysed"),
    };
  }

  return {
    drawingId,
    drawingName: fileName,
    fileType,
    drawingType: "unknown",
    sheetTitle: null,
    confidence: "low",
    reasons: ["No recognisable drawing number or keyword in filename"],
    ...defaultAnalysisFields("not_analysed"),
  };
}

/**
 * Full classification using extracted PDF text plus filename.
 * Used after text extraction in the analysis flow.
 *
 * Priority:
 *   1. Drawing number in filename (BB4xxx, L0x, TOR …)
 *   2. Filename keyword phrases
 *   3. Title-block text (first ~400 chars)
 *   4. Body keywords (first ~2 000 chars) — excludes balustrade_detail
 *
 * The "balustrade_detail" type is ONLY assigned if:
 *   - The filename explicitly contains "Balustrade Detail", "Railing Detail", etc.
 *   - The title block explicitly says "Glass Balustrade Detail" etc.
 * Body text references to glass balustrade are treated as item evidence, NOT
 * as the drawing type.
 */
export function classifyDrawingByText(
  text: string,
  fileName: string,
  fileType: string,
  drawingId = ""
): ClassifiedDrawing {
  if (fileType === "dxf" || fileType === "dwg") {
    return {
      drawingId,
      drawingName: fileName,
      fileType,
      drawingType: "cad_dxf",
      sheetTitle: null,
      confidence: "high",
      reasons: ["File type is DXF/DWG"],
      ...defaultAnalysisFields("unsupported_format", [
        "DXF/DWG files are supported in the DXF Layer Mapping tab.",
      ]),
    };
  }

  const sheetTitle = text ? extractSheetTitle(text) : null;

  // ── Priority resolution ────────────────────────────────────────────────────
  const p1 = matchByDrawingNumber(fileName);
  const p2 = matchByFilenameKeywords(fileName);
  const p3 = text ? matchByTitleBlock(text.slice(0, 400)) : null;
  const p4 = text ? matchByBodyKeywords(text.slice(0, 2000)) : null;

  let match: ClassificationMatch;

  if (p1 && p1.confidence === "high") {
    // Strong drawing number → use it; title block can refine the sheetTitle but not override
    match = p1;
  } else if (p2 && p2.confidence === "high") {
    // High-confidence filename phrase
    match = p2;
  } else if (p3 && p3.confidence === "high") {
    // Title block gives us a clear answer
    match = p3;
  } else if (p1) {
    // Medium filename match (e.g. single word "PLAN" in name)
    match = p1;
  } else if (p3) {
    // Medium/low title block
    match = p3;
  } else if (p2) {
    // Medium filename keyword fallback
    match = p2;
  } else if (p4) {
    // Body keywords — last resort, never balustrade_detail
    match = p4;
  } else {
    match = {
      type: "unknown",
      confidence: "low",
      reasons: ["No classification signal found in filename or text"],
    };
  }

  return {
    drawingId,
    drawingName: fileName,
    fileType,
    drawingType: match.type,
    sheetTitle,
    confidence: match.confidence,
    reasons: match.reasons,
    ...defaultAnalysisFields("text_extractable"),
  };
}
