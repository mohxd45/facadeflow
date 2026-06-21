/**
 * Phase 6A QA fixture — Drawing Intelligence Foundation
 *
 * Tests the reconciliation service and type system deterministically.
 * No network calls, no file I/O beyond reading source text.
 *
 * Run:
 *   npx tsx scripts/qa-fixtures/run-phase6a-qa.ts
 */

import {
  reconcileDrawingIntelligence,
  aiReconciliationCannotMarkVerified,
  aiOnlyElementRequiresEstimatorAction,
} from "../../src/services/drawing-intelligence/drawing-intelligence-reconciler.service";
import type {
  ReconciliationInput,
  AiVisualDetection,
  SystemCodeDetection,
  SystemDimensionDetection,
  AiVisualSheetAnalysis,
  SystemSheetEvidence,
  DrawingSheetRef,
} from "../../src/types/drawing-intelligence";
import {
  AI_DETECTION_ALLOWED_INITIAL_STATUSES,
  AI_FORBIDDEN_ELEMENT_STATUSES,
} from "../../src/types/drawing-intelligence";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Row {
  scenario: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL";
}
const rows: Row[] = [];

function check(scenario: string, expected: string, actual: string, pass: boolean) {
  rows.push({ scenario, expected, actual, status: pass ? "PASS" : "FAIL" });
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();
const PROJECT_ID = "proj-6a";

function makeSheet(
  drawingId: string,
  page: number,
  sheetTitle?: string
): DrawingSheetRef {
  return {
    drawingId,
    drawingName: `${drawingId}.pdf`,
    sourceFormat: "pdf_text",
    page,
    sheetTitle,
  };
}

function makeCodeDetection(
  id: string,
  sheet: DrawingSheetRef,
  normalizedCode: string,
  confidence: SystemCodeDetection["confidence"] = "high"
): SystemCodeDetection {
  return {
    id,
    sheet,
    rawText: normalizedCode,
    normalizedCode,
    confidence,
    source: "pdf_text",
    detectedAt: NOW,
  };
}

function makeDimDetection(
  id: string,
  sheet: DrawingSheetRef,
  widthM: number | null,
  heightM: number | null
): SystemDimensionDetection {
  return {
    id,
    sheet,
    rawText: `${widthM ?? "?"}x${heightM ?? "?"}`,
    widthM,
    heightM,
    lengthM: null,
    confidence: "high",
    source: "pdf_text",
    detectedAt: NOW,
  };
}

function makeAiDetection(
  id: string,
  sheet: DrawingSheetRef,
  detectionType: AiVisualDetection["detectionType"],
  aiConfidence: number,
  estimatedWidthM?: number
): AiVisualDetection {
  return {
    id,
    sheet,
    detectionType,
    aiConfidence,
    estimatedWidthM,
    status: "possible",
    detectedAt: NOW,
  };
}

function makeSystemEvidence(
  sheet: DrawingSheetRef,
  codes: SystemCodeDetection[],
  dims: SystemDimensionDetection[]
): SystemSheetEvidence {
  return { sheet, codeDetections: codes, dimensionDetections: dims, dxfDetections: [] };
}

function makeAiAnalysis(
  sheet: DrawingSheetRef,
  detections: AiVisualDetection[]
): AiVisualSheetAnalysis {
  return { sheet, detections, analysedAt: NOW };
}

// ---------------------------------------------------------------------------
// 6A-01: Empty input → empty output
// ---------------------------------------------------------------------------
{
  const result = reconcileDrawingIntelligence({
    projectId: PROJECT_ID,
    systemEvidence: [],
    aiAnalyses: [],
  });
  check("6A-01: empty input returns empty array", "0 sheets", String(result.length), result.length === 0);
}

// ---------------------------------------------------------------------------
// 6A-02: System evidence only (no AI) → system_only elements
// ---------------------------------------------------------------------------
{
  const sheet = makeSheet("DWG-ELEV", 1, "NORTH ELEVATION");
  const input: ReconciliationInput = {
    projectId: PROJECT_ID,
    systemEvidence: [
      makeSystemEvidence(
        sheet,
        [makeCodeDetection("s1", sheet, "W-01"), makeCodeDetection("s2", sheet, "CW-03")],
        [makeDimDetection("d1", sheet, 1.2, 1.5)]
      ),
    ],
    aiAnalyses: [],
  };
  const [sheetResult] = reconcileDrawingIntelligence(input);
  check("6A-02: system-only produces 2 elements", "2", String(sheetResult.reconciledElements.length), sheetResult.reconciledElements.length === 2);
  const allSystemOnly = sheetResult.reconciledElements.every((e) => e.matchStatus === "system_only");
  check("6A-02b: all elements are system_only", "true", String(allSystemOnly), allSystemOnly);
  check("6A-02c: stats.systemOnly=2", "2", String(sheetResult.stats.systemOnly), sheetResult.stats.systemOnly === 2);
  check("6A-02d: stats.aiOnly=0", "0", String(sheetResult.stats.aiOnly), sheetResult.stats.aiOnly === 0);
}

// ---------------------------------------------------------------------------
// 6A-03: AI only (no system) → ai_only elements with check_ai_suggestion
// ---------------------------------------------------------------------------
{
  const sheet = makeSheet("DWG-PLAN", 2);
  const input: ReconciliationInput = {
    projectId: PROJECT_ID,
    systemEvidence: [],
    aiAnalyses: [
      makeAiAnalysis(sheet, [
        makeAiDetection("ai1", sheet, "possible_window", 0.88, 1.4),
        makeAiDetection("ai2", sheet, "possible_curtain_wall", 0.6),
        makeAiDetection("ai3", sheet, "unknown_facade_element", 0.3),
      ]),
    ],
  };
  const [sheetResult] = reconcileDrawingIntelligence(input);
  check("6A-03: AI-only produces 3 elements", "3", String(sheetResult.reconciledElements.length), sheetResult.reconciledElements.length === 3);
  const allAiOnly = sheetResult.reconciledElements.every((e) => e.matchStatus === "ai_only");
  check("6A-03b: all elements are ai_only", "true", String(allAiOnly), allAiOnly);
  const allNeedEstimator = sheetResult.reconciledElements.every((e) =>
    aiOnlyElementRequiresEstimatorAction(e)
  );
  check("6A-03c: all ai_only elements require estimator action", "true", String(allNeedEstimator), allNeedEstimator);
}

// ---------------------------------------------------------------------------
// 6A-04: Matched — system code + matching AI detection
// ---------------------------------------------------------------------------
{
  const sheet = makeSheet("DWG-ELEV", 1);
  const input: ReconciliationInput = {
    projectId: PROJECT_ID,
    systemEvidence: [
      makeSystemEvidence(
        sheet,
        [makeCodeDetection("s-w01", sheet, "W-01", "high")],
        [makeDimDetection("d-w01", sheet, 1.2, 1.5)]
      ),
    ],
    aiAnalyses: [
      makeAiAnalysis(sheet, [
        makeAiDetection("ai-w01", sheet, "possible_window", 0.92, 1.2),
      ]),
    ],
  };
  const [sheetResult] = reconcileDrawingIntelligence(input);
  check("6A-04: matched produces 1 element", "1", String(sheetResult.reconciledElements.length), sheetResult.reconciledElements.length === 1);
  const el = sheetResult.reconciledElements[0];
  check("6A-04b: matchStatus=matched", "matched", el.matchStatus, el.matchStatus === "matched");
  check("6A-04c: hintWidthM comes from system", "1.2", String(el.hintWidthM), el.hintWidthM === 1.2);
  check("6A-04d: stats.matched=1", "1", String(sheetResult.stats.matched), sheetResult.stats.matched === 1);
}

// ---------------------------------------------------------------------------
// 6A-05: Conflict — system + AI agree on element but width mismatch > 20%
// ---------------------------------------------------------------------------
{
  const sheet = makeSheet("DWG-ELEV", 1);
  const input: ReconciliationInput = {
    projectId: PROJECT_ID,
    systemEvidence: [
      makeSystemEvidence(
        sheet,
        [makeCodeDetection("s-cw", sheet, "CW-06", "high")],
        [makeDimDetection("d-cw", sheet, 2.4, 3.0)]
      ),
    ],
    aiAnalyses: [
      makeAiAnalysis(sheet, [
        makeAiDetection("ai-cw", sheet, "possible_curtain_wall", 0.9, 1.0), // 1.0 vs 2.4 → >20% diff
      ]),
    ],
  };
  const [sheetResult] = reconcileDrawingIntelligence(input);
  const el = sheetResult.reconciledElements[0];
  check("6A-05: conflict status on width mismatch", "conflict", el.matchStatus, el.matchStatus === "conflict");
  check("6A-05b: estimatorAction=resolve_conflict", "resolve_conflict", String(el.estimatorAction), el.estimatorAction === "resolve_conflict");
  check("6A-05c: flaggedIssues is non-empty", "non-empty", String(el.flaggedIssues.length > 0), el.flaggedIssues.length > 0);
  check("6A-05d: stats.conflicts=1", "1", String(sheetResult.stats.conflicts), sheetResult.stats.conflicts === 1);
}

// ---------------------------------------------------------------------------
// 6A-06: Multi-sheet — results are keyed per sheet
// ---------------------------------------------------------------------------
{
  const sheetA = makeSheet("DWG-001", 1);
  const sheetB = makeSheet("DWG-002", 1);
  const input: ReconciliationInput = {
    projectId: PROJECT_ID,
    systemEvidence: [makeSystemEvidence(sheetA, [makeCodeDetection("sA", sheetA, "W-01")], [])],
    aiAnalyses: [makeAiAnalysis(sheetB, [makeAiDetection("aiB", sheetB, "possible_door", 0.7)])],
  };
  const results = reconcileDrawingIntelligence(input);
  check("6A-06: two sheets produce two results", "2", String(results.length), results.length === 2);
  const drawingIds = new Set(results.map((r) => r.sheet.drawingId));
  check("6A-06b: each result is for a different drawing", "2 distinct drawingIds", String(drawingIds.size), drawingIds.size === 2);
}

// ---------------------------------------------------------------------------
// 6A-07: AI detection initial status is always "possible" or "needs_verification"
// ---------------------------------------------------------------------------
{
  const ai = makeAiDetection("x", makeSheet("DWG-001", 1), "possible_window", 0.9);
  check(
    "6A-07: AI detection status is in allowed set",
    "possible|needs_verification",
    ai.status,
    AI_DETECTION_ALLOWED_INITIAL_STATUSES.includes(ai.status)
  );
  const forbidden = AI_FORBIDDEN_ELEMENT_STATUSES;
  check(
    "6A-07b: AI detection status is not in forbidden set",
    "not verified/final/approved",
    ai.status,
    !(forbidden as ReadonlyArray<string>).includes(ai.status)
  );
}

// ---------------------------------------------------------------------------
// 6A-08: Safety audit helpers always return true
// ---------------------------------------------------------------------------
{
  check("6A-08: aiReconciliationCannotMarkVerified returns true", "true", String(aiReconciliationCannotMarkVerified()), aiReconciliationCannotMarkVerified() === true);
}

// ---------------------------------------------------------------------------
// 6A-09: AI confidence band — high AI confidence still only "medium" system band
// ---------------------------------------------------------------------------
{
  // Confidence band is internal; test indirectly via matched element confidence.
  const sheet = makeSheet("DWG-ELEV", 1);
  const input: ReconciliationInput = {
    projectId: PROJECT_ID,
    systemEvidence: [
      makeSystemEvidence(sheet, [makeCodeDetection("s", sheet, "W-01", "low")], []),
    ],
    aiAnalyses: [makeAiAnalysis(sheet, [makeAiDetection("ai", sheet, "possible_window", 0.99, 1.0)])],
  };
  const [sheetResult] = reconcileDrawingIntelligence(input);
  const el = sheetResult.reconciledElements[0];
  // When system confidence is "low", matched confidence must be at most "medium".
  check(
    "6A-09: low system confidence → matched confidence is medium or low",
    "medium or low",
    el.confidence,
    el.confidence === "medium" || el.confidence === "low"
  );
  check(
    "6A-09b: matched confidence is never 'high' without high system confidence",
    "not high",
    el.confidence,
    el.confidence !== "high"
  );
}

// ---------------------------------------------------------------------------
// 6A-10: AI-only element hintWidthM is set but estimatorAction = check_ai_suggestion
// ---------------------------------------------------------------------------
{
  const sheet = makeSheet("DWG-ELEV", 1);
  const input: ReconciliationInput = {
    projectId: PROJECT_ID,
    systemEvidence: [],
    aiAnalyses: [
      makeAiAnalysis(sheet, [makeAiDetection("ai-wd", sheet, "possible_window", 0.8, 1.5)]),
    ],
  };
  const [sheetResult] = reconcileDrawingIntelligence(input);
  const el = sheetResult.reconciledElements[0];
  check("6A-10: ai_only element has hintWidthM set", "1.5", String(el.hintWidthM), el.hintWidthM === 1.5);
  check("6A-10b: ai_only estimatorAction is check_ai_suggestion", "check_ai_suggestion", String(el.estimatorAction), el.estimatorAction === "check_ai_suggestion");
  // Critical: this hint must NOT have been auto-accepted.
  check("6A-10c: ai_only matchStatus is ai_only (not matched)", "ai_only", el.matchStatus, el.matchStatus === "ai_only");
}

// ---------------------------------------------------------------------------
// 6A-11: Stats totals are consistent
// ---------------------------------------------------------------------------
{
  const sheet = makeSheet("DWG-MIXED", 1);
  const input: ReconciliationInput = {
    projectId: PROJECT_ID,
    systemEvidence: [
      makeSystemEvidence(
        sheet,
        [
          makeCodeDetection("s1", sheet, "W-01"),   // will match AI
          makeCodeDetection("s2", sheet, "CW-03"),  // no AI match → system_only
          makeCodeDetection("s3", sheet, "SD-01"),  // no AI match → system_only
        ],
        []
      ),
    ],
    aiAnalyses: [
      makeAiAnalysis(sheet, [
        makeAiDetection("a1", sheet, "possible_window", 0.9),     // matches W-01
        makeAiDetection("a2", sheet, "possible_louver", 0.7),     // no system code → ai_only
      ]),
    ],
  };
  const [sheetResult] = reconcileDrawingIntelligence(input);
  const s = sheetResult.stats;
  check("6A-11: stats.total = matched+systemOnly+aiOnly+conflict+needsVerification",
    "true",
    String(s.total === s.matched + s.systemOnly + s.aiOnly + s.conflicts + s.needsVerification),
    s.total === s.matched + s.systemOnly + s.aiOnly + s.conflicts + s.needsVerification
  );
  check("6A-11b: matched=1 (W-01 ↔ possible_window)", "1", String(s.matched), s.matched === 1);
  check("6A-11c: systemOnly=2 (CW-03, SD-01)", "2", String(s.systemOnly), s.systemOnly === 2);
  check("6A-11d: aiOnly=1 (possible_louver)", "1", String(s.aiOnly), s.aiOnly === 1);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const PASS = rows.filter((r) => r.status === "PASS").length;
const FAIL = rows.length - PASS;

const pad = (s: string, n: number) =>
  s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);

console.log(
  "\n" +
    pad("Scenario", 56) +
    pad("Status", 8) +
    pad("Expected", 28) +
    "Actual"
);
console.log("─".repeat(110));
for (const row of rows) {
  const icon = row.status === "PASS" ? "✓" : "✗";
  console.log(
    pad(row.scenario, 56) +
      pad(`${icon} ${row.status}`, 8) +
      pad(row.expected, 28) +
      row.actual
  );
}
console.log(`\nPhase 6A QA: ${PASS} passed, ${FAIL} failed out of ${rows.length} checks.\n`);
if (FAIL > 0) process.exit(1);
