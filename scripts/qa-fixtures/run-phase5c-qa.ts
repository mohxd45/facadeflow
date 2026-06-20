/**
 * Phase 5C QA fixture — AI Review Prompt Builder + Gateway
 *
 * Covers:
 *  5C-01  buildAiReviewPrompt returns systemPrompt + userPrompt
 *  5C-02  userPrompt contains candidate item codes
 *  5C-03  userPrompt contains SUSPICIOUS_DIM flag for suspicious candidate
 *  5C-04  userPrompt contains CONFLICT flag for conflicting candidate
 *  5C-05  userPrompt contains OCR_ONLY flag for OCR-only candidate
 *  5C-06  userPrompt contains MISSING flag for candidate with missingFields
 *  5C-07  userPrompt is truncated when maxInputChars is tiny
 *  5C-08  truncated flag is true when truncation occurs, false otherwise
 *  5C-09  detectItemCodesInText finds W-01, CW-06, SD-01
 *  5C-10  detectItemCodesInText ignores lowercase / non-code tokens
 *  5C-11  dxfEvidence section appears in userPrompt when dxfEvidence is provided
 *  5C-12  dxfEvidence section absent when dxfEvidence is empty/undefined
 *  5C-13  systemPrompt contains JSON schema instructions
 *  5C-14  candidateId reference section is included when candidates exist
 *  5C-15  DXF detected item codes are included in dxfEvidence section
 *
 * Run: npx tsx scripts/qa-fixtures/run-phase5c-qa.ts
 */

import {
  buildAiReviewPrompt,
  detectItemCodesInText,
} from "../../src/services/ai-review/ai-review-prompt-builder.service";
import type { AiReviewRunInput } from "../../src/types/ai-review";
import type {
  CrossDrawingQuantityCandidate,
  CrossDrawingBuildResult,
  CrossDrawingBuildStats,
} from "../../src/types/cross-drawing-quantity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Row {
  scenario: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL";
}

const rows: Row[] = [];

function check(
  scenario: string,
  expected: string,
  actual: string,
  pass: boolean
) {
  rows.push({ scenario, expected, actual, status: pass ? "PASS" : "FAIL" });
}

// ---------------------------------------------------------------------------
// Minimal candidate factory
// ---------------------------------------------------------------------------

function makeCand(
  overrides: Partial<CrossDrawingQuantityCandidate>
): CrossDrawingQuantityCandidate {
  const id = overrides.id ?? "cand-default";
  const itemCode = overrides.itemCode ?? "W-01";
  return {
    id,
    projectId: "proj-test",
    itemCode,
    normalizedItemCode: overrides.normalizedItemCode ?? itemCode,
    description: overrides.description ?? "Test item",
    category: overrides.category ?? "window",
    unit: overrides.unit ?? "nos",
    status: overrides.status ?? "needs_verification",
    confidence: overrides.confidence ?? "medium",
    sourceDrawingNames: overrides.sourceDrawingNames ?? ["E-01.pdf"],
    sourceDrawingIds: overrides.sourceDrawingIds ?? ["d1"],
    linkedEvidenceIds: overrides.linkedEvidenceIds ?? [],
    sourcePages: overrides.sourcePages ?? [],
    occurrenceCount: overrides.occurrenceCount ?? 1,
    missingFields: overrides.missingFields ?? [],
    warnings: overrides.warnings ?? [],
    reasoning: overrides.reasoning ?? [],
    width: overrides.width,
    height: overrides.height,
    count: overrides.count,
    areaEach: overrides.areaEach,
    totalArea: overrides.totalArea,
    length: overrides.length,
    widthSource: overrides.widthSource,
    heightSource: overrides.heightSource,
    countSource: overrides.countSource,
    possibleWidths: overrides.possibleWidths,
    possibleHeights: overrides.possibleHeights,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const blankStats: CrossDrawingBuildStats = {
  totalEvidence: 0,
  groupedItems: 0,
  completeCandidates: 0,
  needsVerification: 0,
  missingInfoCreated: 0,
  highConfidence: 0,
  mediumConfidence: 0,
  lowConfidence: 0,
  conflictingValues: 0,
  genericCodes: 0,
  ocrSourcedCandidates: 0,
};

function makeResult(candidates: CrossDrawingQuantityCandidate[]): CrossDrawingBuildResult {
  return {
    projectId: "proj-test",
    candidates,
    unresolvedIssueIds: [],
    warnings: [],
    stats: blankStats,
  };
}

// ---------------------------------------------------------------------------
// Test 5C-09/5C-10: detectItemCodesInText
// ---------------------------------------------------------------------------

const codeDetectionLabels = ["W-01", "CW-06 curtain wall", "SD-01 frame", "ignore me", "12345"];
const detected = detectItemCodesInText(codeDetectionLabels);
check(
  "5C-09: detectItemCodesInText finds W-01, CW-06, SD-01",
  "includes W-01, CW-06, SD-01",
  detected.join(", "),
  detected.includes("W-01") && detected.includes("CW-06") && detected.includes("SD-01")
);
check(
  "5C-10: detectItemCodesInText ignores pure-number tokens",
  "does not include 12345",
  detected.join(", "),
  !detected.includes("12345")
);

// ---------------------------------------------------------------------------
// Base input for prompt builder tests
// ---------------------------------------------------------------------------

const suspCand = makeCand({
  id: "cand-susp",
  itemCode: "CW-06",
  normalizedItemCode: "CW-06",
  category: "curtain_wall",
  width: 25,
  height: 5,
  confidence: "low",
  warnings: [
    "Suspicious dimension detected. This may be a grid/drawing dimension, not the item size. Verify from schedule/detail before pricing.",
  ],
  missingFields: ["count"],
});

// Conflict candidate: two different possible widths = warning with "Multiple possible"
const conflictCand = makeCand({
  id: "cand-conflict",
  itemCode: "W-13",
  normalizedItemCode: "W-13",
  width: 2.5,
  possibleWidths: [2.5, 1.8],
  confidence: "medium",
  warnings: ["Multiple possible widths: 2.5, 1.8"],
});

// OCR-only candidate: widthSource sourceType = ocr_text
const ocrCand = makeCand({
  id: "cand-ocr",
  itemCode: "W-04",
  normalizedItemCode: "W-04",
  width: 1.2,
  widthSource: {
    drawingId: "d3",
    drawingName: "E-03.pdf",
    drawingType: "elevation",
    sourceType: "ocr_text",
    confidence: "medium",
  },
  confidence: "medium",
});

const missingCand = makeCand({
  id: "cand-missing",
  itemCode: "W-01",
  normalizedItemCode: "W-01",
  missingFields: ["count", "height"],
  status: "needs_verification",
});

const baseInput: AiReviewRunInput = {
  projectId: "proj-test",
  crossDrawingResult: makeResult([suspCand, conflictCand, ocrCand, missingCand]),
  packageAnalysisResult: {
    hasPlan: true,
    hasElevation: true,
    hasSchedule: false,
    hasSection: false,
  },
};

// ---------------------------------------------------------------------------
// 5C-01 to 5C-08: buildAiReviewPrompt
// ---------------------------------------------------------------------------

const { systemPrompt, userPrompt, inputCharCount, truncated } = buildAiReviewPrompt(baseInput);

check(
  "5C-01: buildAiReviewPrompt returns systemPrompt + userPrompt",
  "both non-empty",
  `sys=${systemPrompt.length > 0} user=${userPrompt.length > 0}`,
  systemPrompt.length > 0 && userPrompt.length > 0
);

check(
  "5C-02: userPrompt contains candidate item codes",
  "CW-06 and W-13 present",
  "see prompt",
  userPrompt.includes("CW-06") && userPrompt.includes("W-13")
);

check(
  "5C-03: userPrompt contains SUSPICIOUS_DIM flag for suspicious candidate",
  "SUSPICIOUS_DIM in prompt",
  userPrompt.includes("SUSPICIOUS_DIM") ? "found" : "missing",
  userPrompt.includes("SUSPICIOUS_DIM")
);

check(
  "5C-04: userPrompt contains CONFLICT flag for conflicting candidate",
  "CONFLICT in prompt",
  userPrompt.includes("CONFLICT") ? "found" : "missing",
  userPrompt.includes("CONFLICT")
);

check(
  "5C-05: userPrompt contains OCR_ONLY flag for OCR-only candidate",
  "OCR_ONLY in prompt",
  userPrompt.includes("OCR_ONLY") ? "found" : "missing",
  userPrompt.includes("OCR_ONLY")
);

check(
  "5C-06: userPrompt contains MISSING flag for candidate with missingFields",
  "MISSING: in prompt",
  userPrompt.includes("MISSING:") ? "found" : "missing",
  userPrompt.includes("MISSING:")
);

const { userPrompt: truncatedPrompt, truncated: wasTruncated } = buildAiReviewPrompt(
  baseInput,
  100
);
check(
  "5C-07: userPrompt is truncated when maxInputChars is tiny",
  "truncated prompt ≤ 160 chars (100 content + suffix)",
  `length=${truncatedPrompt.length}`,
  truncatedPrompt.length <= 160
);
check(
  "5C-08: truncated flag is true when truncation occurs, false otherwise",
  "wasTruncated=true for tiny limit, truncated=false for default",
  `tiny=${wasTruncated} default=${truncated}`,
  wasTruncated === true && truncated === false
);

// ---------------------------------------------------------------------------
// 5C-11/5C-12: DXF evidence section
// ---------------------------------------------------------------------------

const inputWithDxf: AiReviewRunInput = {
  ...baseInput,
  dxfEvidence: [
    {
      drawingId: "dxf-1",
      drawingName: "Facade-Plan.dxf",
      units: "Millimeters",
      layers: [
        { name: "WINDOW_SCHEDULE", entityCount: 42 },
        { name: "CURTAIN_WALL", entityCount: 18 },
        { name: "DIMENSIONS", entityCount: 120 },
      ],
      blockNames: ["W-01_BLOCK", "CW-06_TYPICAL"],
      textLabels: ["W-01 2400x1200", "CW-06 curtain wall typical"],
      detectedItemCodes: ["W-01", "CW-06"],
      warnings: [],
      totalEntityCount: 180,
    },
  ],
};

const { userPrompt: dxfPrompt } = buildAiReviewPrompt(inputWithDxf);
check(
  "5C-11: dxfEvidence section appears in userPrompt when dxfEvidence is provided",
  "CAD/DXF Evidence section present",
  dxfPrompt.includes("CAD/DXF Evidence") ? "found" : "missing",
  dxfPrompt.includes("CAD/DXF Evidence")
);
check(
  "5C-12: dxfEvidence section absent when dxfEvidence is empty/undefined",
  "CAD/DXF Evidence absent",
  userPrompt.includes("CAD/DXF Evidence") ? "found (bad)" : "absent (good)",
  !userPrompt.includes("CAD/DXF Evidence")
);
check(
  "5C-13: systemPrompt contains JSON schema instructions",
  "findings and findingType in systemPrompt",
  systemPrompt.includes("findings") ? "found" : "missing",
  systemPrompt.includes("findings") && systemPrompt.includes("findingType")
);
check(
  "5C-14: candidateId reference section included when candidates exist",
  "Candidate ID Reference section present",
  userPrompt.includes("Candidate ID Reference") ? "found" : "missing",
  userPrompt.includes("Candidate ID Reference")
);
check(
  "5C-15: DXF detected item codes in dxfEvidence section",
  "CW-06 and Facade-Plan.dxf in dxfEvidence block",
  dxfPrompt.includes("CW-06") && dxfPrompt.includes("Facade-Plan.dxf") ? "found" : "missing",
  dxfPrompt.includes("CW-06") && dxfPrompt.includes("Facade-Plan.dxf")
);

// ---------------------------------------------------------------------------
// Print results
// ---------------------------------------------------------------------------

const passed = rows.filter((r) => r.status === "PASS").length;
const failed = rows.filter((r) => r.status === "FAIL").length;

console.log("\n=== Phase 5C QA: Prompt Builder + Gateway ===\n");
for (const r of rows) {
  const icon = r.status === "PASS" ? "✅" : "❌";
  console.log(`${icon} ${r.scenario}`);
  if (r.status === "FAIL") {
    console.log(`     Expected: ${r.expected}`);
    console.log(`     Actual:   ${r.actual}`);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
console.log(`Input char count (default limit): ${inputCharCount}`);

if (failed > 0) {
  process.exit(1);
}
