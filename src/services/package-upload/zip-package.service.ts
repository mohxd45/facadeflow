/**
 * ZIP Package Upload Service — Phase 2
 *
 * Provides:
 *   scanZipContents(zip, zipFileName)  — classify all files without extracting blobs
 *   loadSelectedFiles(zip, files)      — extract blobs only for selected entries
 *   buildPackageUploadSummary(files)   — summary counts
 *
 * Classification uses the same priority logic as Phase 1B:
 *   1. Drawing number (BB4xxx, L0x, TOR, ROOF …)
 *   2. Filename keyword phrases
 *
 * "balustrade_detail" is NOT a file role here — body-text classification is
 * not possible without PDF extraction.  Balustrade items remain "unknown"
 * until Package Review analysis classifies them.
 */

import JSZip from "jszip";
import { generateId } from "@/lib/utils";
import type {
  ExtractedPackageFile,
  PackageFileKind,
  PackageFileRole,
  PackageFileStatus,
  PackageUploadSummary,
} from "@/types/package-upload";
import type { DrawingCategory, DrawingViewType } from "@/types/drawing";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_IMPORTABLE_BYTES = 250 * 1024 * 1024; // 250 MB per file

/** Paths/names that are always ignored */
const IGNORE_PATH_PATTERNS: RegExp[] = [
  /^__MACOSX\//i,
  /\/\._/,
  /\.bak$/i,
  /\.tmp$/i,
  /^\./, // hidden files
  /Thumbs\.db$/i,
  /desktop\.ini$/i,
  /DS_Store$/i,
];

// ---------------------------------------------------------------------------
// Extension → kind
// ---------------------------------------------------------------------------

function extensionToKind(ext: string): PackageFileKind {
  switch (ext) {
    case "pdf":                     return "pdf";
    case "dwg":                     return "dwg";
    case "dxf":                     return "dxf";
    case "dwf":                     return "dwf";
    case "xlsx": case "xls":
    case "csv":                     return "excel";
    case "png": case "jpg":
    case "jpeg": case "webp":
    case "gif": case "tiff":        return "image";
    case "bak":                     return "backup";
    case "doc": case "docx":
    case "txt": case "rtf":         return "document";
    default:                        return "unsupported";
  }
}

function getMimeType(ext: string): string {
  switch (ext) {
    case "pdf":  return "application/pdf";
    case "dxf":  return "application/dxf";
    case "dwg":  return "application/acad";
    default:     return "application/octet-stream";
  }
}

// ---------------------------------------------------------------------------
// Drawing number → role (Priority 1)
// ---------------------------------------------------------------------------

const BB_RANGES: Array<{ pattern: RegExp; role: PackageFileRole; reason: string }> = [
  { pattern: /BB40\d{2}/i, role: "general_notes", reason: "BB40xx — general notes / drawing list" },
  { pattern: /BB41\d{2}/i, role: "floor_plan",    reason: "BB41xx — floor plan" },
  { pattern: /BB42\d{2}/i, role: "elevation",     reason: "BB42xx — elevation" },
  { pattern: /BB43\d{2}/i, role: "section",       reason: "BB43xx — building section" },
  { pattern: /BB44\d{2}/i, role: "wall_section",  reason: "BB44xx — wall section" },
  { pattern: /BB45\d{2}/i, role: "detail",        reason: "BB45xx — detail" },
  { pattern: /BB50\d{2}/i, role: "schedule",      reason: "BB50xx — schedule" },
];

const LEVEL_CODES: Array<{ pattern: RegExp; role: PackageFileRole; reason: string }> = [
  { pattern: /\bL0[0-9]\b/i, role: "floor_plan", reason: "Floor-level code (L0x)" },
  { pattern: /\bTOR\b/,      role: "roof_plan",  reason: "Top-of-Roof code" },
  { pattern: /\bROOF\b/i,    role: "roof_plan",  reason: "Roof keyword" },
  { pattern: /\bGFL?\b/,     role: "floor_plan", reason: "Ground Floor Level" },
];

// ---------------------------------------------------------------------------
// Filename keyword phrases → role (Priority 2)
// ---------------------------------------------------------------------------

const FILENAME_ROLE_PATTERNS: Array<{
  pattern: RegExp;
  role: PackageFileRole;
  confidence: "high" | "medium";
  reason: string;
}> = [
  { pattern: /GROUND\s+FLOOR\s+PLAN|FIRST\s+FLOOR\s+PLAN|SECOND\s+FLOOR\s+PLAN|THIRD\s+FLOOR\s+PLAN|FOURTH\s+FLOOR\s+PLAN|TYPICAL\s+FLOOR\s+PLAN|FLOOR\s+PLAN|SITE\s+PLAN/i,
    role: "floor_plan", confidence: "high", reason: "Floor plan phrase in filename" },
  { pattern: /ROOF\s+PLAN/i,
    role: "roof_plan", confidence: "high", reason: "Roof plan phrase in filename" },
  { pattern: /BUILDING\s+ELEVATIONS?|ELEVATION\s+SHEET|FACADE\s+ELEVATION|EXTERNAL\s+ELEVATION/i,
    role: "elevation", confidence: "high", reason: "Elevation phrase in filename" },
  { pattern: /BUILDING\s+SECTIONS?|LONGITUDINAL\s+SECTION|CROSS\s+SECTION|TYPICAL\s+SECTION/i,
    role: "section", confidence: "high", reason: "Section phrase in filename" },
  { pattern: /WALL\s+SECTIONS?/i,
    role: "wall_section", confidence: "high", reason: "Wall section phrase in filename" },
  { pattern: /WINDOW\s+SCHEDULE|DOOR\s+SCHEDULE|FINISH\s+SCHEDULE|MATERIAL\s+SCHEDULE/i,
    role: "schedule", confidence: "high", reason: "Schedule phrase in filename" },
  { pattern: /GENERAL\s+NOTES?|GENERAL\s+ARRANGEMENT|COVER\s+SHEET/i,
    role: "general_notes", confidence: "high", reason: "General notes phrase in filename" },
  { pattern: /DRAWING\s+LIST|DRAWING\s+INDEX/i,
    role: "drawing_list", confidence: "high", reason: "Drawing list phrase in filename" },
  // Generic single-word fallbacks (medium confidence)
  { pattern: /\bELEVATIONS?\b/i,  role: "elevation",   confidence: "medium", reason: "Elevation keyword in filename" },
  { pattern: /\bSECTIONS?\b/i,    role: "section",     confidence: "medium", reason: "Section keyword in filename" },
  { pattern: /\bSCHEDULE\b/i,     role: "schedule",    confidence: "medium", reason: "Schedule keyword in filename" },
  { pattern: /\bDETAILS?\b/i,     role: "detail",      confidence: "medium", reason: "Detail keyword in filename" },
  { pattern: /\bLAYOUT\b|\bPLAN\b/i, role: "floor_plan", confidence: "medium", reason: "Plan/layout keyword in filename" },
];

// ---------------------------------------------------------------------------
// Role classification
// ---------------------------------------------------------------------------

function classifyRoleFromFilename(
  fileName: string
): { role: PackageFileRole; confidence: "high" | "medium" | "low"; reason: string } {
  const name = fileName;

  // Priority 1a: BB drawing numbers
  for (const { pattern, role, reason } of BB_RANGES) {
    if (pattern.test(name)) return { role, confidence: "high", reason };
  }

  // Priority 1b: level/floor codes
  for (const { pattern, role, reason } of LEVEL_CODES) {
    if (pattern.test(name)) return { role, confidence: "high", reason };
  }

  // Priority 2: filename keyword phrases
  for (const { pattern, role, confidence, reason } of FILENAME_ROLE_PATTERNS) {
    if (pattern.test(name)) return { role, confidence, reason };
  }

  return { role: "unknown", confidence: "low", reason: "No recognisable drawing number or keyword" };
}

// ---------------------------------------------------------------------------
// Determine status given kind + role + size
// ---------------------------------------------------------------------------

function determineStatus(
  kind: PackageFileKind,
  sizeBytes: number,
  isIgnoredPath: boolean
): PackageFileStatus {
  if (isIgnoredPath) return "ignored";
  if (sizeBytes > MAX_IMPORTABLE_BYTES) return "too_large";
  switch (kind) {
    case "pdf":  return "ready_to_import";
    case "dxf":  return "ready_to_import";
    case "dwg":  return "needs_conversion";   // supported in app (queued status)
    case "dwf":  return "needs_conversion";
    case "backup": return "ignored";
    case "image":  return "ignored";
    case "excel":  return "ignored";         // drawing system doesn't import Excel yet
    case "document": return "ignored";
    default:     return "unsupported";
  }
}

// ---------------------------------------------------------------------------
// Public: scan ZIP contents (no blob extraction yet)
// ---------------------------------------------------------------------------

export interface ZipScanResult {
  files: ExtractedPackageFile[];
  summary: PackageUploadSummary;
}

export async function scanZipContents(
  zipFile: File
): Promise<ZipScanResult> {
  const zipData = await zipFile.arrayBuffer();
  const zip = await JSZip.loadAsync(zipData);
  const entries: ExtractedPackageFile[] = [];

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir) return; // skip directories

    const fileName = relativePath.split("/").pop() || relativePath;
    const ext = fileName.includes(".")
      ? fileName.split(".").pop()!.toLowerCase()
      : "";
    // JSZip stores uncompressed size in an internal _data field; fall back to 0 if unavailable.
    const dataField = (zipEntry as unknown as Record<string, unknown>)["_data"] as
      | { uncompressedSize?: number }
      | undefined;
    const sizeBytes = dataField?.uncompressedSize ?? 0;

    const isIgnoredPath = IGNORE_PATH_PATTERNS.some((re) => re.test(relativePath));
    const kind = extensionToKind(ext);

    const { role, confidence, reason } = isIgnoredPath
      ? { role: "ignored" as PackageFileRole, confidence: "low" as const, reason: "System/temp file" }
      : classifyRoleFromFilename(fileName);

    const status = determineStatus(kind, sizeBytes, isIgnoredPath);

    const notes: string[] = [];
    if (kind === "dwg" || kind === "dwf") {
      notes.push("DWG/DWF detected. Conversion to PDF/DXF required for full text analysis.");
    }
    if (kind === "excel") {
      notes.push("Excel/CSV — not directly importable as a drawing. Used for schedule reference.");
    }
    if (sizeBytes > MAX_IMPORTABLE_BYTES) {
      notes.push(`File too large (${(sizeBytes / 1024 / 1024).toFixed(0)} MB). Maximum is 250 MB.`);
    }

    entries.push({
      id: generateId(),
      zipPath: relativePath,
      fileName,
      extension: ext,
      sizeBytes,
      kind,
      role,
      status,
      confidence,
      reason,
      notes,
    });
  });

  // ── Group PDF / CAD pairs ─────────────────────────────────────────────────
  groupPdfCadPairs(entries);

  const summary = buildPackageUploadSummary(entries);
  return { files: entries, summary };
}

// ---------------------------------------------------------------------------
// Public: extract File blobs for selected entries
// ---------------------------------------------------------------------------

export async function loadSelectedFiles(
  zipFile: File,
  selected: ExtractedPackageFile[]
): Promise<ExtractedPackageFile[]> {
  const zipData = await zipFile.arrayBuffer();
  const zip = await JSZip.loadAsync(zipData);

  return Promise.all(
    selected.map(async (pf) => {
      const entry = zip.file(pf.zipPath);
      if (!entry) {
        return { ...pf, notes: [...pf.notes, "Entry not found in ZIP."] };
      }
      const blob = await entry.async("blob");
      const mime = getMimeType(pf.extension);
      const file = new File([blob], pf.fileName, { type: mime });
      return { ...pf, file };
    })
  );
}

// ---------------------------------------------------------------------------
// Helper: group PDF / CAD pairs
// ---------------------------------------------------------------------------

function groupPdfCadPairs(files: ExtractedPackageFile[]): void {
  // Strip extension and normalise for matching
  const stripExt = (name: string) =>
    name.replace(/\.[^/.]+$/, "").trim().toLowerCase();

  const pdfMap = new Map<string, ExtractedPackageFile>();
  const cadMap = new Map<string, ExtractedPackageFile>();

  for (const f of files) {
    if (f.kind === "pdf") pdfMap.set(stripExt(f.fileName), f);
    if (f.kind === "dwg" || f.kind === "dxf") cadMap.set(stripExt(f.fileName), f);
  }

  for (const [base, cadFile] of cadMap) {
    const pdfFile = pdfMap.get(base);
    if (pdfFile) {
      cadFile.matchedPdfName = pdfFile.fileName;
      pdfFile.matchedCadName = cadFile.fileName;
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: build summary counts
// ---------------------------------------------------------------------------

export function buildPackageUploadSummary(
  files: ExtractedPackageFile[]
): PackageUploadSummary {
  const s: PackageUploadSummary = {
    totalFiles: files.length,
    pdfCount: 0,
    dwgCount: 0,
    dxfCount: 0,
    dwfCount: 0,
    excelCount: 0,
    imageCount: 0,
    backupCount: 0,
    ignoredCount: 0,
    unsupportedCount: 0,
    readyToImportCount: 0,
    needsConversionCount: 0,
    duplicateCount: 0,
  };

  for (const f of files) {
    if (f.kind === "pdf")     s.pdfCount++;
    if (f.kind === "dwg")     s.dwgCount++;
    if (f.kind === "dxf")     s.dxfCount++;
    if (f.kind === "dwf")     s.dwfCount++;
    if (f.kind === "excel")   s.excelCount++;
    if (f.kind === "image")   s.imageCount++;
    if (f.kind === "backup")  s.backupCount++;
    if (f.status === "ignored")          s.ignoredCount++;
    if (f.status === "unsupported")      s.unsupportedCount++;
    if (f.status === "ready_to_import")  s.readyToImportCount++;
    if (f.status === "needs_conversion") s.needsConversionCount++;
    if (f.status === "duplicate")        s.duplicateCount++;
  }

  return s;
}

// ---------------------------------------------------------------------------
// Role → DrawingViewType + DrawingCategory mapping (used during import)
// ---------------------------------------------------------------------------

export function roleToDrawingMeta(
  role: PackageFileRole
): { drawingViewType: DrawingViewType; category: DrawingCategory } {
  switch (role) {
    case "floor_plan":   return { drawingViewType: "plan",      category: "typical_floor_plan" };
    case "roof_plan":    return { drawingViewType: "plan",      category: "general" };
    case "elevation":    return { drawingViewType: "elevation", category: "elevation" };
    case "section":      return { drawingViewType: "section",   category: "general" };
    case "wall_section": return { drawingViewType: "section",   category: "general" };
    case "schedule":     return { drawingViewType: "schedule",  category: "general" };
    case "detail":       return { drawingViewType: "detail",    category: "general" };
    case "general_notes":return { drawingViewType: "other",     category: "general" };
    case "drawing_list": return { drawingViewType: "other",     category: "general" };
    case "cad_source":   return { drawingViewType: "other",     category: "general" };
    default:             return { drawingViewType: "other",     category: "other" };
  }
}
