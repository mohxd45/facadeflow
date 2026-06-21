/**
 * Drawing Intelligence System Mapper — Phase 6E
 *
 * Maps existing package/cross-drawing data into SystemSheetEvidence
 * consumed by Phase 6D integration.
 */

import type { CrossDrawingBuildResult } from "@/types/cross-drawing-quantity";
import type { DrawingFile } from "@/types/drawing";
import type { DrawingEvidence } from "@/types/drawing-package";
import type {
  DrawingSheetRef,
  SystemCodeDetection,
  SystemDimensionDetection,
  SystemSheetEvidence,
} from "@/types/drawing-intelligence";

export interface BuildSystemEvidenceInput {
  projectId: string;
  drawings: DrawingFile[];
  crossDrawingResult: CrossDrawingBuildResult | null;
  evidence: DrawingEvidence[];
}

export interface BuildSystemEvidenceResult {
  evidence: SystemSheetEvidence[];
  warnings: string[];
}

function fileTypeToSourceFormat(fileType: string): DrawingSheetRef["sourceFormat"] {
  if (fileType === "dxf") return "dxf";
  if (fileType === "dwg") return "dwg";
  return "pdf_text";
}

function sheetKey(s: DrawingSheetRef): string {
  return `${s.drawingId}::p${s.page}`;
}

function sourceTypeToCodeSource(sourceType?: string): SystemCodeDetection["source"] {
  if (sourceType === "ocr_text") return "ocr_text";
  if (sourceType === "dxf" || sourceType === "cad") return "dxf_text";
  if (sourceType === "schedule") return "schedule_row";
  return "pdf_text";
}

function sourceTypeToDimSource(sourceType?: string): SystemDimensionDetection["source"] {
  if (sourceType === "ocr_text") return "ocr_text";
  if (sourceType === "dxf" || sourceType === "cad") return "dxf_text";
  return "pdf_text";
}

function ensureSheetRow(
  map: Map<string, SystemSheetEvidence>,
  sheet: DrawingSheetRef
): SystemSheetEvidence {
  const key = sheetKey(sheet);
  const existing = map.get(key);
  if (existing) return existing;
  const row: SystemSheetEvidence = {
    sheet,
    codeDetections: [],
    dimensionDetections: [],
    dxfDetections: [],
  };
  map.set(key, row);
  return row;
}

export function buildSystemEvidenceFromPackageData(
  input: BuildSystemEvidenceInput
): BuildSystemEvidenceResult {
  const warnings: string[] = [];
  const byId = new Map(input.drawings.map((d) => [d.id, d]));
  const byName = new Map(input.drawings.map((d) => [d.fileName, d]));
  const rows = new Map<string, SystemSheetEvidence>();
  const now = new Date().toISOString();

  // Preferred source: cross-drawing candidates (more structured).
  if (input.crossDrawingResult?.candidates?.length) {
    for (const c of input.crossDrawingResult.candidates) {
      const sourceDrawingId = c.sourceDrawingIds[0];
      const sourceDrawingName = c.sourceDrawingNames[0];
      const drawing =
        (sourceDrawingId ? byId.get(sourceDrawingId) : undefined) ??
        (sourceDrawingName ? byName.get(sourceDrawingName) : undefined);
      if (!drawing) {
        warnings.push(`System mapping: could not resolve drawing for candidate ${c.itemCode}.`);
        continue;
      }
      const page = c.sourcePages[0] && c.sourcePages[0] > 0 ? c.sourcePages[0] : 1;
      const sheet: DrawingSheetRef = {
        drawingId: drawing.id,
        drawingName: drawing.fileName,
        sourceFormat: fileTypeToSourceFormat(drawing.fileType),
        page,
      };
      const row = ensureSheetRow(rows, sheet);
      row.codeDetections.push({
        id: `sys-code-${c.id}-${drawing.id}-${page}`,
        sheet,
        rawText: c.itemCode,
        normalizedCode: c.normalizedItemCode || c.itemCode,
        confidence: c.confidence,
        source: sourceTypeToCodeSource(c.widthSource?.sourceType ?? c.heightSource?.sourceType),
        detectedAt: now,
      });
      if (
        typeof c.width === "number" ||
        typeof c.height === "number" ||
        typeof c.length === "number"
      ) {
        row.dimensionDetections.push({
          id: `sys-dim-${c.id}-${drawing.id}-${page}`,
          sheet,
          rawText: `${c.width ?? "?"}x${c.height ?? "?"}`,
          widthM: typeof c.width === "number" ? c.width : null,
          heightM: typeof c.height === "number" ? c.height : null,
          lengthM: typeof c.length === "number" ? c.length : null,
          confidence: c.confidence,
          source: sourceTypeToDimSource(c.widthSource?.sourceType ?? c.heightSource?.sourceType),
          detectedAt: now,
        });
      }
    }
    return { evidence: Array.from(rows.values()), warnings };
  }

  // Fallback source: package evidence candidates.
  for (const ev of input.evidence) {
    const drawing = byId.get(ev.drawingId) ?? byName.get(ev.drawingName);
    if (!drawing) {
      warnings.push(`System mapping: drawing not found for evidence ${ev.drawingName}.`);
      continue;
    }
    for (const c of ev.candidates) {
      if (!c.itemCode) continue;
      const page = c.sourcePage && c.sourcePage > 0 ? c.sourcePage : 1;
      const sheet: DrawingSheetRef = {
        drawingId: drawing.id,
        drawingName: drawing.fileName,
        sourceFormat: fileTypeToSourceFormat(drawing.fileType),
        page,
        sheetTitle: c.sheetTitle ?? ev.sheetTitle ?? undefined,
      };
      const row = ensureSheetRow(rows, sheet);
      row.codeDetections.push({
        id: `sys-ev-code-${c._tempId}`,
        sheet,
        rawText: c.itemCode,
        normalizedCode: c.itemCode.toUpperCase(),
        confidence: c.confidence,
        source: sourceTypeToCodeSource(c.sourceType),
        detectedAt: now,
      });
      if (
        typeof c.width === "number" ||
        typeof c.height === "number" ||
        typeof c.length === "number"
      ) {
        row.dimensionDetections.push({
          id: `sys-ev-dim-${c._tempId}`,
          sheet,
          rawText: `${c.width ?? "?"}x${c.height ?? "?"}`,
          widthM: typeof c.width === "number" ? c.width : null,
          heightM: typeof c.height === "number" ? c.height : null,
          lengthM: typeof c.length === "number" ? c.length : null,
          confidence: c.confidence,
          source: sourceTypeToDimSource(c.sourceType),
          detectedAt: now,
        });
      }
    }
  }

  return { evidence: Array.from(rows.values()), warnings };
}

