/**
 * PDF BOQ Extraction Service — Phase 3
 *
 * Extracts company code-based takeoff rows from an uploaded quotation/BOQ PDF.
 *
 * Pipeline:
 *   1. extractPdfText() → raw text (spaces, no original line structure)
 *   2. Strip price columns  (e.g. 19,824.00 → removed)
 *   3. Reconstruct item lines (insert \n before each item code or known description)
 *   4. Map description phrases → company codes  (CANOPY → KP, etc.)
 *   5. Strip description words from each line, leaving: code + dims/unit/qty
 *   6. Feed through parseBoqText() → ParsedBoqRow[]
 *   7. Annotate each row with PDF source snippet + "Extracted from PDF" warning
 *
 * ── Coordinate systems / assumptions ────────────────────────────────────
 *   - Drawing units are typically mm; dimToMetres() handles >50 threshold.
 *   - Prices are stripped via comma-thousands pattern (\d{1,3}(,\d{3})+).
 *   - Description words are all-uppercase runs of letters with no digits.
 *
 * ── Limitations ──────────────────────────────────────────────────────────
 *   - Requires embedded text layer (not a scanned/raster PDF).
 *   - Multi-column PDF tables may produce interleaved text.
 *   - Always review extracted rows before saving.
 */

import type { ItemCodeRule, ParsedBoqRow } from "@/types/code-takeoff";
import { extractPdfText } from "@/services/pdf/pdf-text-extractor";
import { parseBoqText } from "./code-boq-text-parser.service";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PdfBoqExtractionResult {
  rows: ParsedBoqRow[];
  rawText: string;
  pageCount: number;
  isLikelyScanned: boolean;
  /** High-level warnings about the extraction quality */
  extractionWarnings: string[];
  error?: string;
}

export async function extractBoqFromPdf(
  file: File,
  findRule: (code: string) => ItemCodeRule | null
): Promise<PdfBoqExtractionResult> {
  const { text, pageCount, isLikelyScanned, error } = await extractPdfText(file);

  if (error) {
    return {
      rows: [],
      rawText: "",
      pageCount: 0,
      isLikelyScanned: false,
      extractionWarnings: [],
      error,
    };
  }

  if (isLikelyScanned || text.trim().length < 30) {
    return {
      rows: [],
      rawText: text,
      pageCount,
      isLikelyScanned: true,
      extractionWarnings: [
        "This PDF appears to be a scanned image with no embedded text. " +
          "Paste the text manually using the Paste BOQ option instead.",
      ],
    };
  }

  const extractionWarnings: string[] = [];
  const rows = parsePdfBoqText(text, findRule, extractionWarnings);

  if (rows.length === 0) {
    extractionWarnings.push(
      "No item codes were recognised in the PDF text. " +
        "Try the Paste BOQ option and paste the relevant rows manually."
    );
  }

  // Tag every row as coming from a PDF extraction so reviewers know
  const taggedRows = rows.map((row) => ({
    ...row,
    description:
      row.description
        ? `${row.description} [PDF extract]`
        : "[PDF extract]",
    warnings: [
      ...row.warnings,
      "Row extracted from PDF — verify dimensions and quantity before accepting.",
    ],
    // Downgrade from high → medium for PDF-extracted rows (extra caution)
    confidence:
      row.confidence === "high"
        ? ("medium" as const)
        : row.confidence,
  }));

  return { rows: taggedRows, rawText: text, pageCount, isLikelyScanned, extractionWarnings };
}

// ---------------------------------------------------------------------------
// Text → ParsedBoqRow pipeline
// ---------------------------------------------------------------------------

function parsePdfBoqText(
  rawText: string,
  findRule: (code: string) => ItemCodeRule | null,
  warnings: string[]
): ParsedBoqRow[] {
  // Step 1 — Normalise and strip prices
  const step1 = normalisePdfText(rawText);

  // Step 2 — Replace known description phrases with company codes
  const step2 = replaceDescriptionsWithCodes(step1);

  // Step 3 — Insert line breaks before each item start
  const step3 = insertItemLineBreaks(step2);

  // Step 4 — For each reconstructed line, keep only the BOQ-parseable tokens
  const lines = step3.split("\n").map((l) => l.trim()).filter(Boolean);
  const cleanLines: string[] = [];

  for (const line of lines) {
    const stripped = stripDescriptionWords(line);
    if (stripped) cleanLines.push(stripped);
  }

  if (cleanLines.length === 0) return [];

  // Diagnostic: warn if we found lines but very few have quantities
  const linesWithNumbers = cleanLines.filter((l) =>
    /\d/.test(l.replace(/^[A-Z\/-]+\s*/, ""))
  ).length;
  if (cleanLines.length > 2 && linesWithNumbers / cleanLines.length < 0.3) {
    warnings.push(
      "Most extracted lines have no numeric data. " +
        "The PDF may use a layout that this extractor cannot parse."
    );
  }

  // Step 5 — Run through the existing BOQ line parser
  return parseBoqText(cleanLines.join("\n"), findRule);
}

// ---------------------------------------------------------------------------
// Step 1 — Normalise
// ---------------------------------------------------------------------------

function normalisePdfText(raw: string): string {
  return (
    raw
      // Remove page-break markers inserted by the PDF extractor
      .replace(/---\s*PAGE BREAK\s*---/gi, "\n")
      // Collapse whitespace runs to single space
      .replace(/[ \t]+/g, " ")
      // Strip price columns: numbers with thousands separators like 19,824.00
      .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b/g, "")
      // Remove leftover multi-space artefacts from stripping
      .replace(/  +/g, " ")
      .trim()
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Description phrase → company code replacement
// ---------------------------------------------------------------------------

/**
 * Known description → code mappings, ordered from most specific to least.
 * Each pattern is tested against full-line text (case-insensitive).
 * The replacement is the company code that the BOQ parser understands.
 */
const DESCRIPTION_CODE_MAP: Array<{
  pattern: RegExp;
  code: string;
}> = [
  // Balustrade / railing (most specific first)
  { pattern: /balcony\s+glass\s+balustrade/gi,   code: "BL-R" },
  { pattern: /glass\s+balustrade/gi,             code: "BL-R" },
  { pattern: /staircase\s+(?:glass\s+)?railing/gi, code: "BL-R" },
  { pattern: /stair\s+(?:glass\s+)?railing/gi,  code: "BL-R" },
  { pattern: /balcony\s+railing/gi,              code: "BL-R" },
  { pattern: /handrail(?:ing)?/gi,               code: "BL-R" },
  // Screen
  { pattern: /alumin(?:i?um)?\s+screen/gi,       code: "SCR" },
  { pattern: /architectural\s+screen/gi,         code: "SCR" },
  // Canopy
  { pattern: /canopy/gi,                         code: "KP"  },
  { pattern: /awning/gi,                         code: "KP"  },
  // Aluminium fins
  { pattern: /alumin(?:i?um)?\s+fins?/gi,        code: "A/FIN" },
  { pattern: /vertical\s+fins?/gi,               code: "A/FIN" },
  { pattern: /horizontal\s+fins?/gi,             code: "A/FIN" },
  // Curtain wall
  { pattern: /curtain\s+wall/gi,                 code: "CW"  },
  // Louver
  { pattern: /lou?v(?:r|er)e?s?/gi,              code: "LUR" },
  // ACP
  { pattern: /alumin(?:i?um)?\s+composite/gi,    code: "ACP" },
  { pattern: /\bacp\b/gi,                        code: "ACP" },
  { pattern: /cladding/gi,                       code: "ACP" },
];

function replaceDescriptionsWithCodes(text: string): string {
  let result = text;
  for (const { pattern, code } of DESCRIPTION_CODE_MAP) {
    // Only replace when the phrase stands at a word boundary — avoids false positives
    // inside other words. We wrap the existing pattern with non-capturing lookaheads.
    result = result.replace(pattern, ` ${code} `);
  }
  return result.replace(/  +/g, " ");
}

// ---------------------------------------------------------------------------
// Step 3 — Insert line breaks before each item start
// ---------------------------------------------------------------------------

/**
 * Patterns we recognise as the start of a new BOQ item.
 * Each regex is applied globally and a \n is inserted before the match.
 *
 * The optional `\d{1,3}\s+` prefix strips serial numbers (e.g. "8 BL-R" → "\nBL-R").
 */
const ITEM_START_PATTERNS: RegExp[] = [
  // Compound codes (must come before single-letter codes)
  /\b(?:\d{1,3}\s+)?(A\/FIN)(?=[\s\-\d])/g,
  /\b(?:\d{1,3}\s+)?(BL-R)(?=[\s\-\d])/g,
  /\b(?:\d{1,3}\s+)?(ACP|CW|ED|KP|LUR|SCR|SD)(?=[\s\-])/g,
  // Single-letter codes — require -NN suffix to avoid false positives
  /\b(?:\d{1,3}\s+)?(W|V|D)(?=-\d{2})/g,
  // Also: single-letter codes followed directly by a space+number
  /\b(?:\d{1,3}\s+)?(W|V|D)(?=\s+\d)/g,
];

function insertItemLineBreaks(text: string): string {
  let result = text;

  for (const pattern of ITEM_START_PATTERNS) {
    // Replace: strip optional serial, insert \n before code
    result = result.replace(pattern, (match, code: string) => `\n${code}`);
  }

  // Also split on hard line-break sequences that came from the PDF
  result = result.replace(/\n{2,}/g, "\n");

  return result;
}

// ---------------------------------------------------------------------------
// Step 4 — Strip description words from a reconstructed line
// ---------------------------------------------------------------------------

/**
 * Tokens we KEEP in a line (everything else is description / noise).
 *
 * Keep:
 *   - Item code (first token — never stripped)
 *   - Numbers (integer or decimal)
 *   - Dimension separator x / × / X
 *   - Unit keywords: sqm, sq.m, m2, rm, lm, nos, ea, set
 *   - Count keywords: qty, count, no., nos., nos, ea, pcs, nr
 *   - Inline dimension like "6.00x2.90"
 */
const KEEP_TOKEN_RE =
  /^(?:\d+(?:\.\d+)?(?:[xX×]\d+(?:\.\d+)?)?|[xX×]|sqm|sq\.m|m2|rm|lm|nos|ea|set|sets|qty|count|no\.|nos\.|pcs?|nr)$/i;

function stripDescriptionWords(line: string): string | null {
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // First token must be a code
  const code = tokens[0];

  // Validate first token looks like a company item code
  if (!looksLikeItemCode(code)) return null;

  const kept: string[] = [code];
  for (let i = 1; i < tokens.length; i++) {
    if (KEEP_TOKEN_RE.test(tokens[i])) {
      kept.push(tokens[i]);
    }
    // All-uppercase words that don't match keep-list → silently dropped (description)
  }

  // A line with only the code and nothing numeric is useless → skip
  const hasData = kept.slice(1).some((t) => /\d/.test(t));
  if (!hasData) return null;

  return kept.join(" ");
}

// ---------------------------------------------------------------------------
// Item code detector (mirrors the BOQ parser's looksLikeItemCode)
// ---------------------------------------------------------------------------

const KNOWN_CODE_PREFIXES = [
  "A/FIN", "BL-R", "AFIN", "ACP", "CW", "ED", "KP", "LUR", "SCR", "SD",
  "V", "W", "D",
];

function looksLikeItemCode(token: string): boolean {
  const up = token.toUpperCase();
  for (const p of KNOWN_CODE_PREFIXES) {
    if (up === p || up.startsWith(p + "-") || up.startsWith(p + "/")) return true;
  }
  return /^[A-Z][A-Z0-9/]*(-[A-Z0-9]+)*(-\d+)?$/.test(up);
}
