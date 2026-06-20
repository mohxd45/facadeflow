/**
 * Missing Information Detection Service — Phase 1
 *
 * Analyses extracted DrawingEvidence across all drawings and produces
 * DrawingIssueItem candidates for missing or unverifiable data.
 *
 * Rules (deterministic — no AI):
 *   1. Code found, no width           → missing_width
 *   2. Code found, no height          → missing_height
 *   3. SQM code found, no count       → missing_count
 *   4. LM code found, no length/RM    → manual_measurement_required
 *   5. Dims found, no code            → missing_code
 *   6. Text: opening keywords, no code nearby → uncoded_opening
 *   7. Text: glass balustrade/railing, no RM  → manual_measurement_required
 *   8. Plan drawing found, no elevation drawing in package → needs_elevation
 *   9. Plan drawing found, no schedule in package → needs_schedule
 *
 * Important:
 *   - Do NOT invent values.
 *   - Do NOT auto-calculate missing data.
 *   - Every gap must be flagged clearly with a recommendation.
 */

import type {
  DrawingIssueItem,
  CreateDrawingIssueItemInput,
  DrawingIssueType,
  DrawingTakeoffCandidate,
  DrawingItemCategory,
} from "@/types/drawing-takeoff";
import { DRAWING_CODE_RULES } from "@/types/drawing-takeoff";
import type { DrawingEvidence, DrawingPackageType } from "@/types/drawing-package";
import { generateId } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MissingInfoDetectionResult {
  issues: CreateDrawingIssueItemInput[];
  /** Summary counts per issue type */
  summary: Partial<Record<DrawingIssueType, number>>;
}

export function detectMissingInformation(
  projectId: string,
  evidence: DrawingEvidence[]
): MissingInfoDetectionResult {
  const issues: CreateDrawingIssueItemInput[] = [];

  // ── Per-candidate rules (rules 1–5) ─────────────────────────────────────
  for (const ev of evidence) {
    for (const candidate of ev.candidates) {
      const candIssues = detectCandidateIssues(projectId, candidate, ev);
      issues.push(...candIssues);
    }

    // ── Raw-text rules (rules 6–7) ─────────────────────────────────────────
    const textIssues = detectTextPatternIssues(projectId, ev);
    issues.push(...textIssues);
  }

  // ── Package-level rules (rules 8–9) ──────────────────────────────────────
  const packageIssues = detectPackageLevelIssues(projectId, evidence);
  issues.push(...packageIssues);

  // Deduplicate by signature (drawingId + page + issueType + description)
  const deduped = deduplicateIssues(issues);

  // Build summary
  const summary: Partial<Record<DrawingIssueType, number>> = {};
  for (const issue of deduped) {
    summary[issue.issueType] = (summary[issue.issueType] ?? 0) + 1;
  }

  return { issues: deduped, summary };
}

// ---------------------------------------------------------------------------
// Rule 1–5: per-candidate checks
// ---------------------------------------------------------------------------

function detectCandidateIssues(
  projectId: string,
  candidate: DrawingTakeoffCandidate,
  evidence: DrawingEvidence
): CreateDrawingIssueItemInput[] {
  const issues: CreateDrawingIssueItemInput[] = [];
  const base = baseIssueFields(projectId, evidence, candidate);
  const code = candidate.itemCode;

  if (!code) {
    // Rule 5: dimensions found but no code
    if (candidate.width || candidate.height) {
      issues.push({
        ...base,
        issueType: "missing_code",
        possibleDescription: "Opening with dimensions but no item code",
        detectedEvidence: formatEvidence(candidate),
        missingFields: ["itemCode"],
        confidence: "medium",
        reason: "Dimensions were detected but no item code was found nearby.",
        recommendation: "Check if this is a window (W), door (D/SD), or other opening and assign the correct code.",
        suggestedUnit: "sqm",
      });
    }
    return issues;
  }

  // Find the rule for this code
  const rule = DRAWING_CODE_RULES.find(
    (r) =>
      code.toUpperCase() === r.prefix.toUpperCase() ||
      code.toUpperCase().startsWith(r.prefix.toUpperCase() + "-")
  );

  const isLm = rule?.unit === "lm";
  const evidenceText = formatEvidence(candidate);

  // Rule 4: LM item with no length
  if (isLm && candidate.length === undefined) {
    issues.push({
      ...base,
      issueType: "manual_measurement_required",
      possibleCategory: rule?.category as DrawingItemCategory | undefined,
      possibleDescription: rule?.label ?? code,
      detectedEvidence: evidenceText,
      missingFields: ["length"],
      suggestedUnit: "lm",
      confidence: "high",
      reason: `${code} is a running-metre item but no RM/LM quantity was found.`,
      recommendation:
        "Measure the running length from CAD, or enter manually from the drawing.",
    });
    return issues;
  }

  // Rules 1–3: SQM items
  if (!isLm) {
    const missing: string[] = [];

    if (candidate.width === undefined) missing.push("width");
    if (candidate.height === undefined) missing.push("height");
    // Only flag missing count for multi-item codes (not canopy/standalone items)
    if (candidate.count === undefined && code !== "KP" && code !== "BL-R") {
      missing.push("count");
    }

    for (const field of missing) {
      const issueType: DrawingIssueType =
        field === "width"
          ? "missing_width"
          : field === "height"
          ? "missing_height"
          : "missing_count";

      const fieldLabel =
        field === "width" ? "Width" : field === "height" ? "Height" : "Count";

      issues.push({
        ...base,
        issueType,
        possibleCategory: rule?.category as DrawingItemCategory | undefined,
        possibleDescription: rule?.label ?? code,
        detectedEvidence: evidenceText,
        missingFields: [field],
        suggestedUnit: "sqm",
        confidence: missing.length > 1 ? "low" : "medium",
        reason: `${code} found but ${fieldLabel} is missing.`,
        recommendation: `Check elevation, section, or schedule drawing for the ${fieldLabel.toLowerCase()} of this item.`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Rules 6–7: raw text pattern scanning
// ---------------------------------------------------------------------------

const UNCODED_OPENING_PATTERNS: RegExp[] = [
  /\b(?:window|opening|openable|casement)\b/i,
];

const BALUSTRADE_PATTERNS: RegExp[] = [
  /\bglass\s+balustrade\b/i,
  /\bbalcony\s+(?:glass\s+)?railing\b/i,
  /\bstaircase\s+railing\b/i,
  /\bglass\s+railing\b/i,
  /\bhandrail\b/i,
];

function detectTextPatternIssues(
  projectId: string,
  evidence: DrawingEvidence
): CreateDrawingIssueItemInput[] {
  const issues: CreateDrawingIssueItemInput[] = [];
  const base = baseEvidenceFields(projectId, evidence);

  // Scan first 5000 chars to avoid very large text
  const text = evidence.rawText.slice(0, 5000);

  // Rule 6: uncoded openings in text
  // Only flag if the text contains opening keywords AND we found no matching
  // candidate with a known code for that region
  const hasCodedWindows = evidence.candidates.some((c) =>
    c.itemCode && /^W-?\d+/i.test(c.itemCode)
  );
  if (!hasCodedWindows) {
    for (const re of UNCODED_OPENING_PATTERNS) {
      if (re.test(text)) {
        issues.push({
          ...base,
          issueType: "uncoded_opening",
          possibleDescription: "Window / opening (no code found nearby)",
          detectedEvidence: `Text contains: "${re.source.replace(/\\/g, '')}"`,
          missingFields: ["itemCode", "width", "height"],
          suggestedUnit: "sqm",
          confidence: "low",
          reason: "Opening-related keywords found in text but no item code (W-xx) was detected.",
          recommendation:
            "Check the window schedule or elevation for item codes and dimensions.",
        });
        break; // One issue per drawing is enough
      }
    }
  }

  // Rule 7: glass balustrade/railing without RM quantity
  const hasCodedBalustrade = evidence.candidates.some((c) =>
    c.itemCode && /^BL-?R/i.test(c.itemCode)
  );
  for (const re of BALUSTRADE_PATTERNS) {
    if (re.test(text) && !hasCodedBalustrade) {
      issues.push({
        ...base,
        issueType: "manual_measurement_required",
        possibleCategory: "glass_balustrade",
        possibleDescription: "Glass Balustrade / Railing",
        detectedEvidence: `Text contains: "${re.source.replace(/\\/g, '')}"`,
        missingFields: ["length"],
        suggestedUnit: "lm",
        confidence: "medium",
        reason:
          "Glass balustrade or railing text detected but no running-metre (RM/LM) quantity found.",
        recommendation:
          "Measure running length from CAD or floor plan, or check balustrade schedule.",
      });
      break;
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Rules 8–9: package-level cross-drawing checks
// ---------------------------------------------------------------------------

function detectPackageLevelIssues(
  projectId: string,
  evidence: DrawingEvidence[]
): CreateDrawingIssueItemInput[] {
  const issues: CreateDrawingIssueItemInput[] = [];
  const types = new Set<DrawingPackageType>(evidence.map((e) => e.drawingType));

  const hasPlan = types.has("plan");
  const hasElevation = types.has("elevation");
  const hasSchedule = types.has("schedule");

  // Only create package-level issues if we have actual drawings
  if (evidence.length === 0) return [];

  const anyDrawing = evidence[0];
  const baseFields = {
    projectId,
    sourceDrawingId: undefined,
    sourceDrawingName: "Drawing Package",
    sourcePage: undefined,
    sourceSheetTitle: undefined,
    status: "open" as const,
  };

  if (hasPlan && !hasElevation) {
    issues.push({
      ...baseFields,
      issueType: "needs_elevation",
      possibleDescription: "Facade items from floor plan need elevation for height verification",
      detectedEvidence: `${evidence.length} drawing(s) analysed — no elevation found`,
      missingFields: ["elevation drawing"],
      confidence: "high",
      reason:
        "Floor plan drawings detected but no elevation drawing is present in this package.",
      recommendation:
        "Upload elevation drawings to verify façade item heights (windows, doors, curtain walls).",
      suggestedUnit: "sqm",
    });
  }

  if (hasPlan && !hasSchedule) {
    issues.push({
      ...baseFields,
      issueType: "needs_schedule",
      possibleDescription: "Window/door schedule needed for size confirmation",
      detectedEvidence: `${evidence.length} drawing(s) analysed — no schedule found`,
      missingFields: ["schedule drawing"],
      confidence: "medium",
      reason:
        "Floor plan detected but no window/door schedule found. Item sizes may be incomplete.",
      recommendation:
        "Upload a window or door schedule to confirm exact widths and heights.",
      suggestedUnit: "sqm",
    });
  }

  void anyDrawing;
  return issues;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseIssueFields(
  projectId: string,
  ev: DrawingEvidence,
  candidate: DrawingTakeoffCandidate
): Omit<
  DrawingIssueItem,
  | "id"
  | "issueType"
  | "possibleCategory"
  | "possibleDescription"
  | "detectedEvidence"
  | "missingFields"
  | "confidence"
  | "reason"
  | "recommendation"
  | "createdAt"
  | "updatedAt"
> {
  return {
    projectId,
    sourceDrawingId: ev.drawingId,
    sourceDrawingName: ev.drawingName,
    sourcePage: candidate.sourcePage,
    sourceSheetTitle: candidate.sheetTitle ?? ev.sheetTitle ?? undefined,
    suggestedUnit: undefined,
    status: "open",
    manualItemCode: candidate.itemCode,
  };
}

function baseEvidenceFields(
  projectId: string,
  ev: DrawingEvidence
): Omit<
  DrawingIssueItem,
  | "id"
  | "issueType"
  | "possibleCategory"
  | "possibleDescription"
  | "detectedEvidence"
  | "missingFields"
  | "confidence"
  | "reason"
  | "recommendation"
  | "createdAt"
  | "updatedAt"
> {
  return {
    projectId,
    sourceDrawingId: ev.drawingId,
    sourceDrawingName: ev.drawingName,
    sourcePage: undefined,
    sourceSheetTitle: ev.sheetTitle ?? undefined,
    suggestedUnit: undefined,
    status: "open",
  };
}

function formatEvidence(c: DrawingTakeoffCandidate): string {
  const parts: string[] = [];
  if (c.itemCode) parts.push(`Code: ${c.itemCode}`);
  if (c.width !== undefined && c.height !== undefined)
    parts.push(`Size: ${c.width}×${c.height}m`);
  else if (c.width !== undefined) parts.push(`Width: ${c.width}m`);
  else if (c.height !== undefined) parts.push(`Height: ${c.height}m`);
  if (c.count !== undefined) parts.push(`Count: ${c.count}`);
  if (c.length !== undefined) parts.push(`Length: ${c.length}m`);
  return parts.join(", ") || "No data";
}

function deduplicateIssues(
  issues: CreateDrawingIssueItemInput[]
): CreateDrawingIssueItemInput[] {
  const seen = new Set<string>();
  const result: CreateDrawingIssueItemInput[] = [];
  for (const issue of issues) {
    const key = [
      issue.projectId,
      issue.sourceDrawingId ?? "",
      issue.sourcePage ?? "",
      issue.issueType,
      issue.possibleDescription ?? "",
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(issue);
    }
  }
  return result;
}

// Keep generateId available for callers who need to assign IDs
export { generateId };
