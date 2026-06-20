/**
 * Rule-Based Takeoff Analyser  (v2)
 *
 * Design principles:
 * - Zero external dependencies. No AI, no network.
 * - Text is analysed block-by-block (split on newlines / page breaks) so that
 *   quantities from one element are not accidentally attached to another.
 * - sqft is kept as sqft — never silently converted to sqm.
 * - Paired metric/imperial values (18 sqm ≈ 194 sqft) are de-duplicated:
 *   the sqm value is kept; the sqft value is discarded.
 * - Negative patterns on each rule prevent false positives from legend text
 *   ("DOOR REF", "WINDOW TAG", etc.).
 * - Low-confidence rows have null quantity and blank unit — the user is
 *   required to fill them in before committing.
 *
 * Future: replace or augment with an LLM call over the same extracted text,
 * using TakeoffSuggestion[] as the output contract.
 */

import type { TakeoffCategory } from "@/types/takeoff";
import type { DrawingViewType } from "@/types/drawing";

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

export interface TakeoffSuggestion {
  suggestionId: string;
  itemCode: string;
  elementName: string;
  category: TakeoffCategory;
  drawingViewType: DrawingViewType;
  locationFloor: string;
  /** null means "detected keyword, but no reliable quantity found" */
  quantity: number | null;
  unit: string;
  confidence: "manual" | "high" | "medium" | "low";
  notes: string;
  matchedText: string;
  /** 1-based page number where the keyword was found */
  pageNumber: number;
}

// ---------------------------------------------------------------------------
// Unit normalisation  (sqft is its own unit — NOT converted to sqm)
// ---------------------------------------------------------------------------

type UnitKind = "sqm" | "sqft" | "lm" | "nos" | "set" | "unknown";

interface UnitPattern {
  pattern: RegExp;
  kind: UnitKind;
}

const UNIT_PATTERNS: UnitPattern[] = [
  // sqm — metric only
  { pattern: /\bSQ\.?\s*M\.?\b(?!\s*FT)/i, kind: "sqm" },
  { pattern: /\bSQM\b/i, kind: "sqm" },
  { pattern: /\bM2\b/i, kind: "sqm" },
  { pattern: /\bm²\b/, kind: "sqm" },
  // sqft — imperial; kept separate, never auto-converted
  { pattern: /\bSQ\.?\s*FT\.?\b/i, kind: "sqft" },
  { pattern: /\bSQFT\b/i, kind: "sqft" },
  { pattern: /\bSFT\b/i, kind: "sqft" },
  // lm
  { pattern: /\bR\.?\s*M\.?\b/i, kind: "lm" },
  { pattern: /\bLM\b/i, kind: "lm" },
  { pattern: /\bL\.?\s*M\.?\b/i, kind: "lm" },
  { pattern: /\bRUNNING\s+METER\b/i, kind: "lm" },
  { pattern: /\bRUN\.?\s*M\.?\b/i, kind: "lm" },
  // nos
  { pattern: /\bNOS\.?\b/i, kind: "nos" },
  { pattern: /\bPCS\.?\b/i, kind: "nos" },
  { pattern: /\bPC\.?\b/i, kind: "nos" },
  { pattern: /\bEA\.?\b/i, kind: "nos" },
  { pattern: /\bNO\.\b/i, kind: "nos" },
  // set
  { pattern: /\bSETS?\b/i, kind: "set" },
];

function parseUnit(raw: string): UnitKind {
  const t = raw.trim();
  for (const { pattern, kind } of UNIT_PATTERNS) {
    if (pattern.test(t)) return kind;
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Parsed quantity
// ---------------------------------------------------------------------------

interface ParsedQuantity {
  quantity: number;
  unit: UnitKind;
  rawText: string;
  /** Character offset within the owning line block */
  offset: number;
}

/**
 * Quantity regex — requires an explicit unit token right after the number.
 * Formats matched:
 *   AREA = 18.00 SQ.M.
 *   AREA= 194.00 SQ.FT.
 *   520 SQM  |  96 LM  |  40 NOS  |  12 PCS
 *   TOTAL = 236.50 M2
 */
const QTY_RE =
  /(?:(?:AREA|TOTAL|QTY|QUANTITY|SIZE)\s*=\s*)?([\d,]+(?:\.\d+)?)\s*(SQ\.?\s*M\.?|SQ\.?\s*FT\.?|SQFT|SFT|SQM|M2|m²|R\.?M\.?|LM|L\.?M\.?|RUNNING\s+METER|RUN\.?\s*M\.?|NOS\.?|PCS\.?|PC\.?|EA\.?|NO\.|SETS?)/gi;

function extractQuantities(block: string): ParsedQuantity[] {
  const results: ParsedQuantity[] = [];
  const re = new RegExp(QTY_RE.source, "gi");
  let m: RegExpExecArray | null;

  while ((m = re.exec(block)) !== null) {
    const qty = parseFloat(m[1].replace(/,/g, ""));
    if (isNaN(qty) || qty <= 0) continue;
    const unit = parseUnit(m[2]);
    if (unit === "unknown") continue;
    results.push({ quantity: qty, unit, rawText: m[0].trim(), offset: m.index });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Metric/imperial de-duplication
//
// 1 sqm = 10.764 sqft  → ratio is ~10.764
// If a sqm value and a sqft value in the same block satisfy:
//   8 < sqft / sqm < 13
// they represent the same area. Keep the sqm, discard the sqft.
// ---------------------------------------------------------------------------

const SQM_TO_SQFT_RATIO = 10.764;
const RATIO_TOLERANCE = 0.25; // ±25 % accounts for rounding

function deduplicateImperial(quantities: ParsedQuantity[]): ParsedQuantity[] {
  const sqmQtys = quantities.filter((q) => q.unit === "sqm");
  const removeIndexes = new Set<number>();

  quantities.forEach((q, i) => {
    if (q.unit !== "sqft") return;
    for (const sqm of sqmQtys) {
      const expected = sqm.quantity * SQM_TO_SQFT_RATIO;
      const diff = Math.abs(q.quantity - expected) / expected;
      if (diff <= RATIO_TOLERANCE) {
        removeIndexes.add(i);
        break;
      }
    }
  });

  return quantities.filter((_, i) => !removeIndexes.has(i));
}

// ---------------------------------------------------------------------------
// Keyword rules
// ---------------------------------------------------------------------------

interface KeywordRule {
  pattern: RegExp;
  /** Patterns that, if present in the same line group, disqualify this match */
  negativePatterns?: RegExp[];
  category: TakeoffCategory;
  elementName: string;
  drawingViewType: DrawingViewType;
  /** Preferred unit when no quantity is found */
  fallbackUnit: string;
}

const KEYWORD_RULES: KeywordRule[] = [
  // Most specific first (GLASS BALUSTRADE before BALUSTRADE)
  {
    pattern: /\bGLASS\s+BALUSTRADE\b|\bGLASS\s+BARRIER\b/i,
    category: "glass_balustrade",
    elementName: "Glass balustrade",
    drawingViewType: "detail",
    fallbackUnit: "lm",
  },
  {
    pattern: /\bBALUSTRADE\b|\bBALLUSTRADE\b/i,
    negativePatterns: [/\bREF(?:ERENCE)?\b/i, /\bSEE\s+DWG\b/i],
    category: "glass_balustrade",
    elementName: "Balustrade",
    drawingViewType: "detail",
    fallbackUnit: "lm",
  },
  {
    pattern: /\bBALCONY\s+RAILING\b|\bBALCONY\s+RAIL\b/i,
    category: "balcony_railing",
    elementName: "Balcony railing",
    drawingViewType: "elevation",
    fallbackUnit: "lm",
  },
  {
    pattern: /\bBALCONY\b/i,
    negativePatterns: [/\bREF(?:ERENCE)?\b/i],
    category: "balcony_railing",
    elementName: "Balcony element",
    drawingViewType: "elevation",
    fallbackUnit: "sqm",
  },
  {
    pattern: /\bALUMINIU?M\s+COMPOSITE\s+PANEL\b|\bACP\s+CLADDING\b|\bA\.C\.P\.?\b/i,
    category: "acp_cladding",
    elementName: "ACP (Aluminium Composite Panel)",
    drawingViewType: "elevation",
    fallbackUnit: "sqm",
  },
  {
    pattern: /\bACP\b/i,
    negativePatterns: [/\bREF\b/i, /\bTYPE\b/i, /\bTAG\b/i],
    category: "acp_cladding",
    elementName: "ACP panel",
    drawingViewType: "elevation",
    fallbackUnit: "sqm",
  },
  {
    pattern: /\bCURTAIN\s+WALL\s+GLASS\s+PANEL\b|\bCWGP\b/i,
    category: "curtain_wall_glass_panel",
    elementName: "Curtain wall glass panel",
    drawingViewType: "elevation",
    fallbackUnit: "sqm",
  },
  {
    pattern: /\bCURTAIN\s+WALL\b/i,
    negativePatterns: [/\bREF\b/i, /\bSYMBOL\b/i],
    category: "curtain_wall_glass_panel",
    elementName: "Curtain wall",
    drawingViewType: "elevation",
    fallbackUnit: "sqm",
  },
  {
    pattern: /\bALUMINIU?M\s+FIN\b|\bALU\s+FIN\b|\bAL\.\s*FIN\b/i,
    category: "aluminium_fins",
    elementName: "Aluminium fin",
    drawingViewType: "elevation",
    fallbackUnit: "nos",
  },
  {
    pattern: /\bCANOPY\b/i,
    negativePatterns: [/\bREF\b/i],
    category: "canopy",
    elementName: "Canopy",
    drawingViewType: "plan",
    fallbackUnit: "sqm",
  },
  {
    pattern: /\bGLASS\s+PARTITION\b|\bINTERNAL\s+GLASS\b/i,
    category: "glass_partitions",
    elementName: "Glass partition",
    drawingViewType: "plan",
    fallbackUnit: "sqm",
  },
  {
    pattern: /\bLOUVRE?\b|\bLOUVRES?\b|\bVENTILATION\s+PANEL\b/i,
    negativePatterns: [/\bREF\b/i],
    category: "louvers",
    elementName: "Louvre",
    drawingViewType: "elevation",
    fallbackUnit: "sqm",
  },
  {
    pattern: /\bWINDOW\b|\bWINDOWS\b/i,
    // Ignore tag/reference lines like "WINDOW TYPE W1", "WINDOW REF"
    negativePatterns: [
      /\bTYPE\s+W\d/i,
      /\bREF(?:ERENCE)?\b/i,
      /\bTAG\b/i,
      /\bSCHEDULE\b/i,
    ],
    category: "windows",
    elementName: "Window",
    drawingViewType: "plan",
    fallbackUnit: "nos",
  },
  {
    pattern: /\bENTRANCE\s+DOOR\b|\bEXIT\s+DOOR\b/i,
    category: "doors",
    elementName: "Entrance / exit door",
    drawingViewType: "plan",
    fallbackUnit: "nos",
  },
  {
    pattern: /\bDOOR\b|\bDOORS\b/i,
    // Ignore "ACCESS DOOR REF", "DOOR REF D1", "DOOR TYPE", "DOOR SCHEDULE"
    negativePatterns: [
      /\bACCESS\s+DOOR\s+REF\b/i,
      /\bREF(?:ERENCE)?\b/i,
      /\bTYPE\s+D\d/i,
      /\bSCHEDULE\b/i,
      /\bTAG\b/i,
    ],
    category: "doors",
    elementName: "Door",
    drawingViewType: "plan",
    fallbackUnit: "nos",
  },
];

// ---------------------------------------------------------------------------
// Text splitting utilities
// ---------------------------------------------------------------------------

/** Split the full extracted text into per-page arrays of line groups. */
function splitIntoPageBlocks(fullText: string): string[][] {
  const pages = fullText.split(/---\s*PAGE\s*BREAK\s*---/i);
  return pages.map((page) => splitIntoLineGroups(page));
}

/**
 * Split a page's text into "line groups": sequences of non-blank lines
 * separated by blank lines. This approximates paragraph / schedule rows,
 * preventing quantities from one paragraph bleeding into another.
 */
function splitIntoLineGroups(pageText: string): string[] {
  const groups: string[] = [];
  let current: string[] = [];

  for (const line of pageText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (current.length > 0) {
        groups.push(current.join(" "));
        current = [];
      }
    } else {
      current.push(trimmed);
    }
  }
  if (current.length > 0) groups.push(current.join(" "));
  return groups;
}

/**
 * For each keyword match, return the line group it belongs to plus the
 * ±1 adjacent groups (for multi-line schedule rows). This is much tighter
 * than the old ±200 char window.
 */
function groupsAroundMatch(
  groups: string[],
  matchGroupIndex: number,
  spread = 1
): string {
  const start = Math.max(0, matchGroupIndex - spread);
  const end = Math.min(groups.length - 1, matchGroupIndex + spread);
  return groups.slice(start, end + 1).join(" ");
}

// ---------------------------------------------------------------------------
// Main analyser
// ---------------------------------------------------------------------------

let _idCounter = 0;
function nextSuggestionId(): string {
  return `sug-${Date.now()}-${++_idCounter}`;
}

export interface AnalyseOptions {
  drawingId: string;
  projectId: string;
  existingItemCodes: string[];
  maxSuggestions?: number;
}

export function analyzeTextForTakeoff(
  text: string,
  options: AnalyseOptions
): TakeoffSuggestion[] {
  if (!text?.trim()) return [];

  const pages = splitIntoPageBlocks(text);
  const suggestions: TakeoffSuggestion[] = [];

  // Dedup keys: category + rounded quantity + unit (avoids duplicates across pages)
  const seen = new Set<string>();
  // Per-category, one keyword-only suggestion maximum
  const keywordOnlySeen = new Set<TakeoffCategory>();

  let codeNum = options.existingItemCodes.length;
  const nextCode = () => `TKF-${String(++codeNum).padStart(3, "0")}`;

  const max = options.maxSuggestions ?? 25;

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageNumber = pageIdx + 1;
    const groups = pages[pageIdx];

    for (const rule of KEYWORD_RULES) {
      const ruleRe = new RegExp(rule.pattern.source, "gi");

      for (let gIdx = 0; gIdx < groups.length; gIdx++) {
        const group = groups[gIdx];
        const upperGroup = group.toUpperCase();

        ruleRe.lastIndex = 0;
        let kwMatch: RegExpExecArray | null;

        while ((kwMatch = ruleRe.exec(upperGroup)) !== null) {
          const matchedKeyword = kwMatch[0];

          // ----- Negative pattern guard -----------------------------------
          // Use the ±1 group context for negatives (captures nearby legend text)
          const context = groupsAroundMatch(groups, gIdx, 1).toUpperCase();
          const failsNegative = rule.negativePatterns?.some((neg) =>
            neg.test(context)
          );
          if (failsNegative) continue;

          // ----- Quantity search within owning group only -----------------
          // We intentionally do NOT cross paragraph boundaries to avoid
          // borrowing quantities from adjacent elements.
          const searchText = groupsAroundMatch(groups, gIdx, 0); // current group only
          let quantities = extractQuantities(searchText);

          // If nothing found in the immediate group, try ±1 groups with lower trust
          let quantitiesFromAdjacentGroup = false;
          if (quantities.length === 0) {
            quantities = extractQuantities(groupsAroundMatch(groups, gIdx, 1));
            if (quantities.length > 0) quantitiesFromAdjacentGroup = true;
          }

          // ----- Metric / imperial de-dup ---------------------------------
          quantities = deduplicateImperial(quantities);

          // ----- Emit suggestions ----------------------------------------
          if (quantities.length > 0) {
            for (const { quantity, unit, rawText } of quantities) {
              const roundedQty = Math.round(quantity * 100) / 100;
              const dedupKey = `${rule.category}-${roundedQty}-${unit}`;
              if (seen.has(dedupKey)) continue;
              seen.add(dedupKey);

              const confidence = quantitiesFromAdjacentGroup ? "medium" : "medium";
              const notes =
                `Detected "${matchedKeyword}" with ${rawText} on page ${pageNumber}.` +
                (quantitiesFromAdjacentGroup
                  ? " (Quantity found in adjacent text — verify on drawing.)"
                  : "");

              suggestions.push({
                suggestionId: nextSuggestionId(),
                itemCode: nextCode(),
                elementName: rule.elementName,
                category: rule.category,
                drawingViewType: rule.drawingViewType,
                locationFloor: "",
                quantity: roundedQty,
                unit,
                confidence,
                notes,
                matchedText: searchText.slice(0, 160).trim(),
                pageNumber,
              });

              if (suggestions.length >= max) return suggestions;
            }
          } else {
            // Keyword found, no quantity — one low-confidence placeholder per category
            if (keywordOnlySeen.has(rule.category)) continue;
            keywordOnlySeen.add(rule.category);

            suggestions.push({
              suggestionId: nextSuggestionId(),
              itemCode: nextCode(),
              elementName: rule.elementName,
              category: rule.category,
              drawingViewType: rule.drawingViewType,
              locationFloor: "",
              quantity: null,
              unit: "",
              confidence: "low",
              notes: `Keyword "${matchedKeyword}" found in legend or header on page ${pageNumber}. No reliable quantity detected — please fill in manually.`,
              matchedText: context.slice(0, 160).trim(),
              pageNumber,
            });

            if (suggestions.length >= max) return suggestions;
          }
        }
      }
    }
  }

  return suggestions;
}
