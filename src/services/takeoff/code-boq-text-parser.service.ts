/**
 * BOQ Text Parser — Phase 2 (revised Phase 2.1)
 *
 * Parses pasted BOQ / quotation text into structured rows for user review.
 * Does NOT save anything — outputs ParsedBoqRow[] for the review table.
 *
 * ── Supported line formats ────────────────────────────────────────────────
 *   W-01  4.60 x 2.90  qty 1        → 4.60m × 2.90m × 1 = 13.340 sqm
 *   SD-01 6.00 x 2.90  qty 1        → 6.00m × 2.90m × 1 = 17.400 sqm
 *   BL-R  45  RM                    → 45.000 lm  (RM = running metre)
 *   KP    64  SQM                   → 64.000 sqm  (explicit area unit)
 *   SCR   63  SQM                   → 63.000 sqm
 *   A/FIN-01  12.50  lm             → 12.500 lm
 *   CW-01  3000 x 2400  nos 5       → 3.0m × 2.4m × 5 = 36.000 sqm  (mm auto-converted)
 *
 * ── Unit conversion rules ────────────────────────────────────────────────
 *   W×H dimension pairs: apply mm→m conversion when value > 50.
 *   Standalone quantities WITH explicit unit (SQM, RM, LM…): NO conversion.
 *   Standalone quantities WITHOUT explicit unit and value > 50: convert mm→m.
 *
 * ── Confidence rules ─────────────────────────────────────────────────────
 *   high   : rule matched + all required values present + qty > 0 + no warnings
 *   medium : rule matched + unit explicitly overrides rule default
 *   low    : no rule matched, OR missing values, OR qty ≤ 0
 */

import type {
  ItemCodeRule,
  ParsedBoqRow,
  CodeTakeoffUnit,
  CalculationMethod,
} from "@/types/code-takeoff";
import { calculateCodeTakeoff } from "./code-takeoff-calculation.service";

// ---------------------------------------------------------------------------
// Unit synonym map  (nos handled separately as a count indicator)
// ---------------------------------------------------------------------------

const UNIT_SYNONYMS: Record<string, CodeTakeoffUnit> = {
  sqm: "sqm", "sq.m": "sqm", m2: "sqm", "sq m": "sqm",
  lm: "lm",   rm: "lm",    "running meter": "lm", "running metre": "lm",
  "running m": "lm", "r.m": "lm", "r.m.": "lm", rl: "lm",
  // "nos" is intentionally excluded here — it acts as a count keyword
  set: "set", sets: "set",
};

/**
 * Return the area/length/set unit for a token, or null if not recognised.
 * Count-only tokens (nos/ea/pc…) are NOT returned here — they are handled
 * by the count-keyword regex in parseBoqLine.
 */
function parseAreaLengthUnit(token: string): CodeTakeoffUnit | null {
  return UNIT_SYNONYMS[token.toLowerCase().trim()] ?? null;
}

// ---------------------------------------------------------------------------
// Known code prefixes (all caps) for fast first-token check
// ---------------------------------------------------------------------------

const KNOWN_PREFIXES = [
  "A/FIN", "BL-R", "AFIN", "ACP", "CW", "ED", "KP", "LUR", "SCR", "SD",
  "V", "W", "D",
];

/**
 * Returns true if token looks like a company item code:
 *   - Matches a known prefix (exactly or with -suffix), or
 *   - Matches general pattern: 1–6 uppercase letters/slash/hyphen with optional -NN suffix.
 */
function looksLikeItemCode(token: string): boolean {
  const up = token.toUpperCase();
  for (const p of KNOWN_PREFIXES) {
    if (up === p || up.startsWith(p + "-") || up.startsWith(p + "/")) return true;
  }
  return /^[A-Z][A-Z0-9/]*(-[A-Z0-9]+)*(-\d+)?$/.test(up);
}

// ---------------------------------------------------------------------------
// W×H dimension detection
// ---------------------------------------------------------------------------

interface DimPair {
  w: number;
  h: number;
  /** indices in the token array that were consumed */
  consumed: number[];
}

function tryParseDimPair(tokens: string[], start: number): DimPair | null {
  const t0 = tokens[start];
  if (!t0) return null;

  // Inline: "4.60x2.90" or "4.60×2.90"
  const inline = t0.match(/^(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)$/);
  if (inline) {
    return { w: parseFloat(inline[1]), h: parseFloat(inline[2]), consumed: [start] };
  }

  // Separate tokens: NUMBER <x|×> NUMBER
  if (/^\d+(?:\.\d+)?$/.test(t0)) {
    const sep = tokens[start + 1]?.toLowerCase();
    const t2 = tokens[start + 2];
    if ((sep === "x" || sep === "×") && t2 && /^\d+(?:\.\d+)?$/.test(t2)) {
      return { w: parseFloat(t0), h: parseFloat(t2), consumed: [start, start + 1, start + 2] };
    }
  }
  return null;
}

/**
 * Convert a W×H dimension that may be in mm to metres.
 * Only applied to dimension pairs, never to standalone quantities.
 * Rule: if value > 50, assume mm and divide by 1000.
 */
function dimToMetres(v: number): number {
  return v > 50 ? v / 1000 : v;
}

// ---------------------------------------------------------------------------
// Count-keyword pattern (includes "nos", "ea", "pc", "pcs", "nr")
// ---------------------------------------------------------------------------

const COUNT_KW_RE = /^(qty|quantity|count|no\.|nos\.|nos|ea|pcs?|nr)$/i;

// ---------------------------------------------------------------------------
// Main line parser
// ---------------------------------------------------------------------------

export function parseBoqLine(
  raw: string,
  findRule: (code: string) => ItemCodeRule | null
): ParsedBoqRow | null {
  const line = raw.trim();
  if (!line || line.startsWith("#") || line.startsWith("//")) return null;

  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // ── Step 1: First token must be an item code ─────────────────────────────
  if (!looksLikeItemCode(tokens[0])) return null;
  const itemCode = tokens[0].toUpperCase();
  const matchedRule = findRule(itemCode);

  const rest = tokens.slice(1);
  const consumed = new Set<number>();

  // ── Step 2: Scan for explicit area/length/set unit FIRST ─────────────────
  //   (nos/ea/pcs are count keywords, not captured here)
  let unitOverride: CodeTakeoffUnit | undefined;
  for (let i = 0; i < rest.length; i++) {
    const u = parseAreaLengthUnit(rest[i]);
    if (u) {
      unitOverride = u;
      consumed.add(i);
      break; // use the first explicit unit found
    }
  }

  // ── Step 3: Scan for W×H dimension pair ──────────────────────────────────
  let width: number | undefined;
  let height: number | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (consumed.has(i)) continue;
    const dim = tryParseDimPair(rest, i);
    if (dim) {
      // Apply mm→m conversion ONLY to dimension pairs
      width  = dimToMetres(dim.w);
      height = dimToMetres(dim.h);
      dim.consumed.forEach((c) => consumed.add(c));
      break;
    }
  }

  // ── Step 4: Scan for count and standalone quantity ────────────────────────
  let count: number | undefined;
  let manualQuantity: number | undefined;

  for (let i = 0; i < rest.length; i++) {
    if (consumed.has(i)) continue;
    const tok = rest[i];

    // Count keyword + following number: "qty 3", "nos 5", "ea 2"
    if (COUNT_KW_RE.test(tok)) {
      const next = rest[i + 1];
      if (next && /^\d+(?:\.\d+)?$/.test(next) && !consumed.has(i + 1)) {
        count = parseFloat(next);
        consumed.add(i);
        consumed.add(i + 1);
      }
      continue;
    }

    // Bare number
    if (/^\d+(?:\.\d+)?$/.test(tok)) {
      const n = parseFloat(tok);

      if (width !== undefined && height !== undefined) {
        // We already have a W×H pair → this bare number is count
        if (count === undefined) {
          count = Math.round(n);
          consumed.add(i);
        }
      } else {
        // No W×H pair → this is the standalone quantity/area/length value
        if (manualQuantity === undefined) {
          if (unitOverride !== undefined) {
            // Explicit unit already found → use number as-is (no mm conversion)
            // e.g.  KP 64 SQM → 64.0  |  BL-R 45 RM → 45.0
            manualQuantity = n;
          } else {
            // No explicit unit → apply mm→m heuristic only if value suggests mm
            // e.g.  A/FIN 1500 → 1.5  |  BL-R 45 → 45 (≤50, returned as-is)
            manualQuantity = dimToMetres(n);
          }
          consumed.add(i);
        }
      }
    }
  }

  // ── Step 5: Resolve calculation method ───────────────────────────────────
  let methodOverride: CalculationMethod | undefined;
  if (width !== undefined && height !== undefined) {
    methodOverride = "width_height_qty";
  } else if (
    unitOverride === "sqm" ||
    (!unitOverride && matchedRule?.defaultUnit === "sqm" && manualQuantity !== undefined)
  ) {
    methodOverride = "entered_area";
  } else if (
    unitOverride === "lm" ||
    (!unitOverride && matchedRule?.defaultUnit === "lm" && manualQuantity !== undefined)
  ) {
    methodOverride = "entered_length";
  }

  // Effective count for W×H rows
  const effectiveCount = count ?? (width !== undefined ? 1 : undefined);

  // ── Step 6: Calculate quantity ────────────────────────────────────────────
  const calc = calculateCodeTakeoff({
    itemCode,
    matchedRule,
    width,
    height,
    count: effectiveCount,
    manualQuantity,
    unitOverride,
    methodOverride,
    projectId: "", // not needed for calculation only
  });

  // ── Step 7: Parser-level confidence ──────────────────────────────────────
  //
  // The calculation service penalises "medium" for any override, but in the
  // BOQ parser context, overrides are parser-detected values — not user edits.
  // We recompute confidence here based on parsing quality:
  //
  //   high   → rule matched, qty > 0, no warnings at all
  //   medium → rule matched, qty > 0, BUT explicit unit differs from rule default
  //            (user's BOQ specifies a different unit than the company rule)
  //   low    → no rule, missing values, qty ≤ 0, or calculation warnings
  //
  const extraWarnings: string[] = [];
  if (!matchedRule) {
    extraWarnings.push(`No rule found for code "${itemCode}". Review and adjust.`);
  }

  const allWarnings = [...calc.warnings, ...extraWarnings];
  const hasRule = matchedRule !== null;
  const hasPositiveQty = calc.calculatedQuantity > 0;
  const unitDiffersFromRule =
    unitOverride !== undefined && unitOverride !== matchedRule?.defaultUnit;

  let confidence: "high" | "medium" | "low";
  if (!hasRule || !hasPositiveQty || allWarnings.length > 0) {
    confidence = "low";
  } else if (unitDiffersFromRule) {
    confidence = "medium";
  } else {
    confidence = "high";
  }

  return {
    rawText: raw,
    itemCode,
    matchedRule,
    width,
    height,
    count: effectiveCount,
    manualQuantity,
    unit: unitOverride ?? calc.unit,
    calculationMethod: calc.calculationMethod,
    calculatedQuantity: calc.calculatedQuantity,
    confidence,
    warnings: allWarnings,
  };
}

// ---------------------------------------------------------------------------
// Parse full text block
// ---------------------------------------------------------------------------

export function parseBoqText(
  text: string,
  findRule: (code: string) => ItemCodeRule | null
): ParsedBoqRow[] {
  const lines = text.split(/\r?\n/);
  const results: ParsedBoqRow[] = [];
  for (const line of lines) {
    const row = parseBoqLine(line, findRule);
    if (row) results.push(row);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Verification samples (not executed in production — for dev/debugging only)
// ---------------------------------------------------------------------------

/**
 * Run known-good sample cases and return a pass/fail report.
 * Call from browser console:  import("@/services/takeoff/code-boq-text-parser.service")
 *                              .then(m => console.table(m.runParserVerification()))
 */
export function runParserVerification(
  findRule: (code: string) => ItemCodeRule | null
): Array<{
  input: string;
  expectedQty: number;
  expectedUnit: string;
  actualQty: number;
  actualUnit: string;
  pass: boolean;
}> {
  const cases: Array<{ input: string; expectedQty: number; expectedUnit: string }> = [
    { input: "SD-01 6.00 x 2.90 qty 1",  expectedQty: 17.4,  expectedUnit: "sqm" },
    { input: "W-01 4.60 x 2.90 qty 1",   expectedQty: 13.34, expectedUnit: "sqm" },
    { input: "BL-R 45 RM",               expectedQty: 45,    expectedUnit: "lm"  },
    { input: "KP 64 SQM",                expectedQty: 64,    expectedUnit: "sqm" },
    { input: "SCR 63 SQM",               expectedQty: 63,    expectedUnit: "sqm" },
  ];

  return cases.map(({ input, expectedQty, expectedUnit }) => {
    const row = parseBoqLine(input, findRule);
    const actualQty  = row?.calculatedQuantity ?? 0;
    const actualUnit = row?.unit ?? "?";
    const pass =
      Math.abs(actualQty - expectedQty) < 0.001 && actualUnit === expectedUnit;
    return { input, expectedQty, expectedUnit, actualQty, actualUnit, pass };
  });
}
