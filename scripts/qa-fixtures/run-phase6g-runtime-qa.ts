/**
 * Phase 6G-B runtime smoke QA
 *
 * Focus:
 * - AI abort/timeout fallback clarity
 * - Drawing Intelligence version staleness marker
 * - Suspicious measurement display/candidate safety
 */

import { NextRequest } from "next/server";
import { POST as aiReviewPost } from "../../src/app/api/ai-review/route";
import {
  DRAWING_INTELLIGENCE_RESULT_VERSION,
  isDrawingIntelligenceResultStale,
  toDrawingIntelligenceRows,
} from "../../src/services/drawing-intelligence/drawing-intelligence-ui.utils";
import { buildSafeTakeoffDraftFromReconciled } from "../../src/services/drawing-intelligence/drawing-intelligence-candidate-action.service";
import type {
  DrawingSheetReconciliation,
  DrawingSheetRef,
  ReconciledElement,
} from "../../src/types/drawing-intelligence";
import type { AiReviewRunInput } from "../../src/types/ai-review";

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

const NOW = new Date().toISOString();

function makeRequest(input: AiReviewRunInput): NextRequest {
  return new NextRequest("http://localhost/api/ai-review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

function makeSheet(id = "s1", page = 1): DrawingSheetRef {
  return { drawingId: id, drawingName: `${id}.pdf`, sourceFormat: "pdf_text", page };
}

function makeElement(overrides?: Partial<ReconciledElement>): ReconciledElement {
  const sheet = overrides?.sheet ?? makeSheet();
  return {
    id: overrides?.id ?? "r-1",
    sheet,
    matchStatus: overrides?.matchStatus ?? "matched",
    confidence: overrides?.confidence ?? "medium",
    systemCodeDetection:
      overrides?.systemCodeDetection ??
      ({
        id: "c-1",
        sheet,
        rawText: "W-01",
        normalizedCode: "W-01",
        confidence: "high",
        source: "pdf_text",
        detectedAt: NOW,
      } as ReconciledElement["systemCodeDetection"]),
    systemDimensionDetection: overrides?.systemDimensionDetection,
    aiDetection:
      overrides?.aiDetection ??
      ({
        id: "ai-1",
        sheet,
        detectionType: "possible_window",
        aiConfidence: 0.8,
        status: "possible",
        detectedAt: NOW,
      } as ReconciledElement["aiDetection"]),
    inferredType: overrides?.inferredType ?? "possible_window",
    hintWidthM: overrides?.hintWidthM,
    hintHeightM: overrides?.hintHeightM,
    linkedMeasurement: overrides?.linkedMeasurement,
    unresolvedMeasurementReason: overrides?.unresolvedMeasurementReason,
    measurementRejectedAsSuspicious: overrides?.measurementRejectedAsSuspicious,
    flaggedIssues: overrides?.flaggedIssues ?? [],
    recommendedEstimatorAction: overrides?.recommendedEstimatorAction ?? "review_manually",
    reconciledAt: NOW,
  };
}

async function run() {
  const original = {
    provider: process.env.AI_REVIEW_PROVIDER,
    key: process.env.OPENAI_API_KEY,
    model: process.env.AI_REVIEW_MODEL,
    timeout: process.env.AI_REVIEW_TIMEOUT_MS,
  };
  const originalFetch = global.fetch;
  try {
    // 6G-B-01: aborted AI Review returns safe fallback with clear reason
    process.env.AI_REVIEW_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.AI_REVIEW_MODEL = "gpt-5-mini";
    process.env.AI_REVIEW_TIMEOUT_MS = "15000";

    global.fetch = (async () => {
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      throw err;
    }) as typeof global.fetch;

    const resp = await aiReviewPost(
      makeRequest({
        projectId: "proj-6g-runtime",
        packageAnalysisResult: {
          hasElevation: true,
          hasPlan: true,
          hasSchedule: false,
          hasSection: false,
        },
      })
    );
    const body = (await (resp as unknown as Response).json()) as Record<string, unknown>;
    const warnings = Array.isArray(body.warnings) ? body.warnings : [];
    const warningText = warnings.join(" || ");
    check(
      "6G-B-01: aborted AI call falls back safely",
      "mock_fallback",
      String((body.runtimeMeta as Record<string, unknown> | undefined)?.source),
      (body.runtimeMeta as Record<string, unknown> | undefined)?.source === "mock_fallback"
    );
    check(
      "6G-B-01b: fallback warning classifies abort reason",
      "contains request aborted",
      warningText,
      warningText.toLowerCase().includes("request aborted")
    );

    // 6G-B-02: stale result version detection works
    check(
      "6G-B-02: current version is not stale",
      "false",
      String(isDrawingIntelligenceResultStale(DRAWING_INTELLIGENCE_RESULT_VERSION)),
      isDrawingIntelligenceResultStale(DRAWING_INTELLIGENCE_RESULT_VERSION) === false
    );
    check(
      "6G-B-02b: legacy/undefined version is stale",
      "true",
      String(isDrawingIntelligenceResultStale(undefined)),
      isDrawingIntelligenceResultStale(undefined) === true
    );

    // 6G-B-03: rejected 20x5 is not displayed as accepted dims
    const suspiciousElement = makeElement({
      id: "r-suspicious",
      hintWidthM: 20,
      hintHeightM: 5,
      measurementRejectedAsSuspicious: true,
      unresolvedMeasurementReason: "Suspicious measurement detected and rejected.",
      flaggedIssues: ["Suspicious measurement rejected — estimator verification required."],
    });
    const reconciliation: DrawingSheetReconciliation = {
      sheet: suspiciousElement.sheet,
      reconciledElements: [suspiciousElement],
      stats: {
        matched: 0,
        systemOnly: 0,
        aiOnly: 0,
        conflicts: 0,
        needsVerification: 1,
        total: 1,
      },
      generatedAt: NOW,
    };
    const rendered = toDrawingIntelligenceRows([reconciliation])[0];
    check(
      "6G-B-03: suspicious dimensions display as '- x -'",
      "- x -",
      `${rendered.width} x ${rendered.height}`,
      rendered.width === "-" && rendered.height === "-"
    );
    check(
      "6G-B-03b: suspicious note is shown",
      "contains Suspicious dimension ignored",
      rendered.notes,
      rendered.notes.includes("Suspicious dimension ignored")
    );

    // 6G-B-04: candidate draft does not use suspicious dimensions
    const draft = buildSafeTakeoffDraftFromReconciled(suspiciousElement, "proj-6g-runtime").input;
    check(
      "6G-B-04: suspicious measurement not used in candidate draft",
      "width/height undefined",
      `${draft?.width ?? "undefined"}/${draft?.height ?? "undefined"}`,
      draft?.width === undefined && draft?.height === undefined
    );

    // 6G-B-05: safe linked dimensions still display correctly
    const safeElement = makeElement({
      id: "r-safe",
      hintWidthM: 1.2,
      hintHeightM: 1.5,
      linkedMeasurement: {
        id: "lm-1",
        sheet: makeSheet("s2", 2),
        rawText: "W-01 schedule 1.2 x 1.5",
        widthM: 1.2,
        heightM: 1.5,
        sourceFormat: "pdf_text",
        confidence: "high",
        reason: "schedule row",
        detectionMethod: "schedule",
        suspicious: false,
      },
      measurementRejectedAsSuspicious: false,
    });
    const safeRow = toDrawingIntelligenceRows([
      {
        sheet: safeElement.sheet,
        reconciledElements: [safeElement],
        stats: {
          matched: 1,
          systemOnly: 0,
          aiOnly: 0,
          conflicts: 0,
          needsVerification: 0,
          total: 1,
        },
        generatedAt: NOW,
      },
    ])[0];
    check(
      "6G-B-05: safe linked dimensions still shown",
      "1.20 x 1.50",
      `${safeRow.width} x ${safeRow.height}`,
      safeRow.width === "1.20" && safeRow.height === "1.50"
    );
    check(
      "6G-B-05b: linked source/method note shown",
      "contains Linked by schedule",
      safeRow.notes,
      safeRow.notes.includes("Linked by schedule")
    );
  } finally {
    process.env.AI_REVIEW_PROVIDER = original.provider;
    process.env.OPENAI_API_KEY = original.key;
    process.env.AI_REVIEW_MODEL = original.model;
    process.env.AI_REVIEW_TIMEOUT_MS = original.timeout;
    global.fetch = originalFetch;
  }

  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.length - pass;
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  console.log("\n" + pad("Scenario", 66) + pad("Status", 10) + pad("Expected", 34) + "Actual");
  console.log("─".repeat(132));
  for (const row of rows) {
    const icon = row.status === "PASS" ? "✓" : "✗";
    console.log(
      pad(row.scenario, 66) +
        pad(`${icon} ${row.status}`, 10) +
        pad(row.expected, 34) +
        row.actual
    );
  }
  console.log(`\nPhase 6G runtime QA: ${pass} passed, ${fail} failed out of ${rows.length} checks.\n`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Phase 6G runtime QA fatal error:", err);
  process.exit(1);
});

