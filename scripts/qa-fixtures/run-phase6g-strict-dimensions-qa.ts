/**
 * Phase 6G-C strict dimensions QA
 */

import type {
  DrawingSheetRef,
  ReconciledElement,
  SystemCodeDetection,
  SystemDimensionDetection,
} from "../../src/types/drawing-intelligence";
import { linkMeasurementsToReconciledElements } from "../../src/services/drawing-intelligence/drawing-intelligence-measurement-linking.service";
import { toDrawingIntelligenceRows } from "../../src/services/drawing-intelligence/drawing-intelligence-ui.utils";
import { buildSafeTakeoffDraftFromReconciled } from "../../src/services/drawing-intelligence/drawing-intelligence-candidate-action.service";
import { buildCrossDrawingQuantities } from "../../src/services/drawing-package/cross-drawing-quantity-builder.service";
import type {
  CrossDrawingBuildInput,
  TakeoffCandidateRef,
  EvidenceItemRef,
  ClassifiedDrawingRef,
  DrawingFileRef,
} from "../../src/types/cross-drawing-quantity";

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

function makeSheet(id = "d1", page = 1): DrawingSheetRef {
  return { drawingId: id, drawingName: `${id}.pdf`, sourceFormat: "pdf_text", page };
}

function makeCode(id: string, sheet: DrawingSheetRef, code: string): SystemCodeDetection {
  return {
    id,
    sheet,
    rawText: code,
    normalizedCode: code,
    confidence: "high",
    source: "pdf_text",
    detectedAt: NOW,
  };
}

function makeDim(
  id: string,
  sheet: DrawingSheetRef,
  rawText: string,
  widthM: number | null,
  heightM: number | null,
  detectionMethod: SystemDimensionDetection["detectionMethod"],
  nearbyCodeRef?: string,
  source: SystemDimensionDetection["source"] = "pdf_text",
  reason?: string
): SystemDimensionDetection {
  return {
    id,
    sheet,
    rawText,
    widthM,
    heightM,
    lengthM: null,
    confidence: "high",
    source,
    detectionMethod,
    nearbyCodeRef,
    reason,
    detectedAt: NOW,
  };
}

function makeRecon(id: string, sheet: DrawingSheetRef, code: string): ReconciledElement {
  return {
    id,
    sheet,
    matchStatus: "matched",
    confidence: "medium",
    systemCodeDetection: {
      id: `sys-${id}`,
      sheet,
      rawText: code,
      normalizedCode: code,
      confidence: "high",
      source: "pdf_text",
      detectedAt: NOW,
    },
    aiDetection: {
      id: `ai-${id}`,
      sheet,
      detectionType: "possible_window",
      aiConfidence: 0.75,
      status: "possible",
      detectedAt: NOW,
    },
    inferredType: "possible_window",
    flaggedIssues: [],
    recommendedEstimatorAction: "review_manually",
    reconciledAt: NOW,
  };
}

function cand(
  id: string,
  itemCode: string,
  overrides: Partial<TakeoffCandidateRef> = {}
): TakeoffCandidateRef {
  return {
    _tempId: id,
    itemCode,
    description: itemCode,
    category: "windows",
    unit: "sqm",
    confidence: "medium",
    sourceType: "drawing_annotation",
    warnings: [],
    rawSnippet: "",
    ...overrides,
  };
}

function ev(
  drawingId: string,
  drawingName: string,
  drawingType: string,
  candidates: TakeoffCandidateRef[],
  textSource = "pdf_text"
): EvidenceItemRef {
  return {
    drawingId,
    drawingName,
    drawingType,
    classificationConfidence: "medium",
    textSource,
    candidates,
  };
}

function cls(drawingId: string, drawingType: string): ClassifiedDrawingRef {
  return { drawingId, drawingType, confidence: "medium" };
}

function drw(id: string, name: string): DrawingFileRef {
  return { id, fileName: name, fileType: "pdf" };
}

function input(
  drawings: DrawingFileRef[],
  classifiedDrawings: ClassifiedDrawingRef[],
  evidenceItems: EvidenceItemRef[]
): CrossDrawingBuildInput {
  return {
    projectId: "qa-6gc",
    drawings,
    classifiedDrawings,
    evidenceItems,
    drawingTakeoffCandidates: [],
    missingInfoItems: [],
  };
}

async function run() {
  const sheet = makeSheet("s6gc", 2);
  const code = makeCode("code-1", sheet, "W-01");
  const baseElement = makeRecon("recon-1", sheet, "W-01");

  // 6GC-01 random 20x5 text_pair is rejected
  const rejected = linkMeasurementsToReconciledElements({
    systemCodeDetections: [code],
    systemDimensionDetections: [
      makeDim("dim-1", sheet, "GRID 20 x 5", 20, 5, "text_pair", undefined, "pdf_text"),
    ],
    aiDetections: [],
    reconciledElements: [baseElement],
    sheetRefs: [sheet],
  }).elements[0];
  check(
    "6GC-01: random 20x5 text_pair rejected",
    "true",
    String(rejected.measurementRejectedAsSuspicious === true),
    rejected.measurementRejectedAsSuspicious === true
  );

  // 6GC-02 rejected 20x5 displays as - x -
  const renderedRejected = toDrawingIntelligenceRows([
    {
      sheet,
      reconciledElements: [rejected],
      stats: { matched: 0, systemOnly: 0, aiOnly: 0, conflicts: 0, needsVerification: 1, total: 1 },
      generatedAt: NOW,
    },
  ])[0];
  check(
    "6GC-02: rejected 20x5 displays as - x -",
    "- x -",
    `${renderedRejected.width} x ${renderedRejected.height}`,
    renderedRejected.width === "-" && renderedRejected.height === "-"
  );

  // 6GC-03 rejected 20x5 does not create area/ea 100 sqm
  const rejectedDraft = buildSafeTakeoffDraftFromReconciled(rejected, "proj-6gc").input;
  check(
    "6GC-03: rejected 20x5 does not create area/ea=100",
    "undefined",
    String(rejectedDraft?.areaEach),
    rejectedDraft?.areaEach === undefined
  );

  // 6GC-04 rejected dimensions do not enter cross-drawing quantities
  const crossRejected = buildCrossDrawingQuantities(
    input(
      [drw("d1", "Elevation.pdf")],
      [cls("d1", "elevation")],
      [
        ev("d1", "Elevation.pdf", "elevation", [
          cand("c1", "W-01", {
            width: 20,
            height: 5,
            count: 2,
            rawSnippet: "Elevation text 20 x 5 near grid",
            sourceType: "drawing_annotation",
          }),
        ]),
      ]
    )
  ).candidates[0];
  check(
    "6GC-04: cross-drawing rejects unsafe 20x5 values",
    "width/height undefined",
    `${crossRejected?.width ?? "undefined"}/${crossRejected?.height ?? "undefined"}`,
    crossRejected?.width === undefined && crossRejected?.height === undefined
  );

  // 6GC-05 explicit W-01 1200x1500 accepted
  const explicitAccepted = linkMeasurementsToReconciledElements({
    systemCodeDetections: [code],
    systemDimensionDetections: [
      makeDim("dim-2", sheet, "W-01 1.2 x 1.5", 1.2, 1.5, "text_pair", "W-01", "pdf_text"),
    ],
    aiDetections: [],
    reconciledElements: [baseElement],
    sheetRefs: [sheet],
  }).elements[0];
  check(
    "6GC-05: explicit code+dimension text_pair accepted",
    "1.2x1.5",
    `${explicitAccepted.hintWidthM}x${explicitAccepted.hintHeightM}`,
    explicitAccepted.hintWidthM === 1.2 && explicitAccepted.hintHeightM === 1.5
  );

  // 6GC-06 schedule/table dimension accepted
  const scheduleAccepted = linkMeasurementsToReconciledElements({
    systemCodeDetections: [code],
    systemDimensionDetections: [
      makeDim("dim-3", sheet, "W-01 schedule 1.1 x 1.6", 1.1, 1.6, "schedule", "W-01", "pdf_text"),
    ],
    aiDetections: [],
    reconciledElements: [baseElement],
    sheetRefs: [sheet],
  }).elements[0];
  check(
    "6GC-06: schedule dimension accepted",
    "1.1x1.6",
    `${scheduleAccepted.hintWidthM}x${scheduleAccepted.hintHeightM}`,
    scheduleAccepted.hintWidthM === 1.1 && scheduleAccepted.hintHeightM === 1.6
  );

  // 6GC-07 CAD geometry with object ref accepted
  const cadAccepted = linkMeasurementsToReconciledElements({
    systemCodeDetections: [code],
    systemDimensionDetections: [
      makeDim(
        "dim-4",
        { ...sheet, sourceFormat: "dxf" },
        "entity size",
        1.4,
        1.8,
        "cad_geometry",
        "W-01",
        "dxf_dimension_entity",
        "objectRef:ENT-22"
      ),
    ],
    aiDetections: [],
    reconciledElements: [{ ...baseElement, sheet: { ...sheet, sourceFormat: "dxf" } }],
    sheetRefs: [{ ...sheet, sourceFormat: "dxf" }],
  }).elements[0];
  check(
    "6GC-07: CAD geometry with object ref accepted",
    "1.4x1.8",
    `${cadAccepted.hintWidthM}x${cadAccepted.hintHeightM}`,
    cadAccepted.hintWidthM === 1.4 && cadAccepted.hintHeightM === 1.8
  );

  // 6GC-08 missing dimension remains Missing Info/needs verification
  check(
    "6GC-08: missing dimensions remain unresolved",
    "true",
    String(
      (crossRejected?.missingFields ?? []).includes("width") &&
        (crossRejected?.missingFields ?? []).includes("height")
    ),
    (crossRejected?.missingFields ?? []).includes("width") &&
      (crossRejected?.missingFields ?? []).includes("height")
  );

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
  console.log(`\nPhase 6G strict dimensions QA: ${pass} passed, ${fail} failed out of ${rows.length} checks.\n`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Phase 6G strict dimensions QA fatal error:", err);
  process.exit(1);
});

