/**
 * Drawing Identity Service — stable drawing-number matching
 *
 * Matches renamed manual uploads to original ZIP filenames via BB#### codes
 * and similar drawing-number patterns embedded in paths or names.
 */

import type { DrawingFile } from "@/types/drawing";
import type { ExtractedPackageFile } from "@/types/package-upload";

/** BB4100, BB4401, BB5001, etc. */
const BB_DRAWING_NUMBER = /\b(BB\d{4})\b/i;

/** Embedded in paths like …-DWG-ARC-BB4401 or …_BB4401 */
const EMBEDDED_BB_NUMBER = /[-_](BB\d{4})\b/i;

/** Generic sheet-style numbers: 2–4 letters + 3–5 digits (conservative) */
const GENERIC_SHEET_NUMBER = /\b([A-Z]{2,4}\d{3,5})\b/;

const FALSE_POSITIVE_CODES = new Set([
  "PDF",
  "DWG",
  "DXF",
  "ZIP",
  "JPEG",
  "PNG",
]);

// ---------------------------------------------------------------------------
// Identity extraction
// ---------------------------------------------------------------------------

/**
 * Extract a stable drawing identity from filename, notes, or ZIP path.
 * Returns normalised uppercase code (e.g. "BB4401") or null.
 */
export function extractDrawingNumberIdentity(
  fileName: string,
  notes?: string | null,
  zipPath?: string | null
): string | null {
  const sources = [fileName, zipPath ?? "", notes ?? ""];

  for (const src of sources) {
    if (!src.trim()) continue;

    const withoutExt = src.replace(/\.[^/.]+$/, "");

    const bb = withoutExt.match(BB_DRAWING_NUMBER);
    if (bb) return bb[1].toUpperCase();

    const embedded = withoutExt.match(EMBEDDED_BB_NUMBER);
    if (embedded) return embedded[1].toUpperCase();
  }

  for (const src of sources) {
    if (!src.trim()) continue;
    const withoutExt = src.replace(/\.[^/.]+$/, "");
    const generic = withoutExt.match(GENERIC_SHEET_NUMBER);
    if (generic) {
      const code = generic[1].toUpperCase();
      const prefix = code.replace(/\d+$/, "");
      if (!FALSE_POSITIVE_CODES.has(prefix) && !FALSE_POSITIVE_CODES.has(code)) {
        return code;
      }
    }
  }

  return null;
}

export function getDrawingIdentity(drawing: DrawingFile): string | null {
  return extractDrawingNumberIdentity(
    drawing.fileName,
    drawing.notes,
    undefined
  );
}

export function isZipSourcedDrawing(drawing: DrawingFile): boolean {
  return !!drawing.notes?.trim().startsWith("[ZIP:");
}

// ---------------------------------------------------------------------------
// Grouping / summaries
// ---------------------------------------------------------------------------

export interface DuplicateIdentitySummary {
  identity: string;
  count: number;
  fileNames: string[];
}

export function groupDrawingsByIdentity(
  drawings: DrawingFile[]
): Map<string, DrawingFile[]> {
  const groups = new Map<string, DrawingFile[]>();

  for (const d of drawings) {
    const identity = getDrawingIdentity(d);
    if (!identity) continue;
    const list = groups.get(identity) ?? [];
    list.push(d);
    groups.set(identity, list);
  }

  return groups;
}

export function summarizeDuplicateIdentities(
  drawings: DrawingFile[]
): DuplicateIdentitySummary[] {
  const result: DuplicateIdentitySummary[] = [];

  for (const [identity, group] of groupDrawingsByIdentity(drawings)) {
    if (group.length > 1) {
      result.push({
        identity,
        count: group.length,
        fileNames: group.map((d) => d.fileName),
      });
    }
  }

  return result.sort((a, b) => a.identity.localeCompare(b.identity));
}

export function pickPreferredDrawingForAnalysis(
  group: DrawingFile[]
): DrawingFile {
  const zipDrawings = group.filter(isZipSourcedDrawing);

  if (zipDrawings.length > 0) {
    return [...zipDrawings].sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    )[0];
  }

  return [...group].sort(
    (a, b) =>
      new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
  )[0];
}

export interface AnalysisDrawingSelection {
  /** Drawing ids that should run text/evidence extraction */
  analysisDrawingIds: Set<string>;
  /** Skipped duplicate rows keyed by skipped drawing id */
  skippedDuplicates: Map<
    string,
    { identity: string; keptDrawingId: string; keptFileName: string }
  >;
}

export function selectDrawingsForPackageAnalysis(
  drawings: DrawingFile[]
): AnalysisDrawingSelection {
  const analysisDrawingIds = new Set<string>();
  const skippedDuplicates = new Map<
    string,
    { identity: string; keptDrawingId: string; keptFileName: string }
  >();

  const groups = groupDrawingsByIdentity(drawings);
  const groupedIds = new Set<string>();
  for (const group of groups.values()) {
    group.forEach((d) => groupedIds.add(d.id));
  }

  for (const d of drawings) {
    if (!groupedIds.has(d.id)) {
      analysisDrawingIds.add(d.id);
    }
  }

  for (const [identity, group] of groups) {
    const kept = pickPreferredDrawingForAnalysis(group);
    analysisDrawingIds.add(kept.id);

    for (const d of group) {
      if (d.id !== kept.id) {
        skippedDuplicates.set(d.id, {
          identity,
          keptDrawingId: kept.id,
          keptFileName: kept.fileName,
        });
      }
    }
  }

  return { analysisDrawingIds, skippedDuplicates };
}

// ---------------------------------------------------------------------------
// ZIP scan duplicate marking
// ---------------------------------------------------------------------------

export function applyDuplicateDetectionToPackageFiles(
  files: ExtractedPackageFile[],
  existingDrawings: DrawingFile[]
): ExtractedPackageFile[] {
  const existingByIdentity = new Map<string, DrawingFile>();
  for (const d of existingDrawings) {
    const identity = getDrawingIdentity(d);
    if (identity && !existingByIdentity.has(identity)) {
      existingByIdentity.set(identity, d);
    }
  }

  const seenInZip = new Map<string, ExtractedPackageFile>();
  const result: ExtractedPackageFile[] = [];

  for (const f of files) {
    const importable =
      f.status === "ready_to_import" || f.status === "needs_conversion";

    if (!importable) {
      result.push(f);
      continue;
    }

    const identity = extractDrawingNumberIdentity(f.fileName, undefined, f.zipPath);

    if (!identity) {
      result.push({ ...f, drawingIdentity: undefined });
      continue;
    }

    const existing = existingByIdentity.get(identity);
    if (existing) {
      result.push({
        ...f,
        drawingIdentity: identity,
        status: "duplicate",
        duplicateOfDrawingId: existing.id,
        duplicateOfFileName: existing.fileName,
        notes: [
          ...f.notes,
          `Duplicate drawing detected: ${identity} already exists in this project (${existing.fileName}).`,
        ],
      });
      continue;
    }

    const priorInZip = seenInZip.get(identity);
    if (priorInZip) {
      result.push({
        ...f,
        drawingIdentity: identity,
        status: "duplicate",
        duplicateOfFileName: priorInZip.fileName,
        notes: [
          ...f.notes,
          `Duplicate in package: ${identity} already listed (${priorInZip.fileName}).`,
        ],
      });
      continue;
    }

    seenInZip.set(identity, f);
    result.push({ ...f, drawingIdentity: identity });
  }

  return result;
}
