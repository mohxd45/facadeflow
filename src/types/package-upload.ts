/**
 * ZIP Package Upload Types — Phase 2
 *
 * Represents files extracted from a client ZIP package, their classification,
 * status, and readiness for import into the project drawing set.
 */

// ---------------------------------------------------------------------------
// File kind — determined by extension
// ---------------------------------------------------------------------------

export type PackageFileKind =
  | "pdf"
  | "dwg"
  | "dxf"
  | "dwf"
  | "excel"
  | "image"
  | "backup"
  | "document"
  | "unsupported";

export const PACKAGE_FILE_KIND_LABELS: Record<PackageFileKind, string> = {
  pdf:         "PDF",
  dwg:         "DWG",
  dxf:         "DXF",
  dwf:         "DWF",
  excel:       "Excel / CSV",
  image:       "Image",
  backup:      "Backup",
  document:    "Document",
  unsupported: "Unsupported",
};

// ---------------------------------------------------------------------------
// File role — determined by filename / drawing number pattern
// ---------------------------------------------------------------------------

export type PackageFileRole =
  | "floor_plan"
  | "roof_plan"
  | "elevation"
  | "section"
  | "wall_section"
  | "schedule"
  | "detail"
  | "general_notes"
  | "drawing_list"
  | "cad_source"
  | "unknown"
  | "ignored";

export const PACKAGE_FILE_ROLE_LABELS: Record<PackageFileRole, string> = {
  floor_plan:   "Floor Plan",
  roof_plan:    "Roof Plan",
  elevation:    "Elevation",
  section:      "Section",
  wall_section: "Wall Section",
  schedule:     "Schedule",
  detail:       "Detail",
  general_notes:"General Notes",
  drawing_list: "Drawing List",
  cad_source:   "CAD Source",
  unknown:      "Unknown",
  ignored:      "Ignored",
};

// ---------------------------------------------------------------------------
// File import status
// ---------------------------------------------------------------------------

export type PackageFileStatus =
  | "ready_to_import"
  | "ignored"
  | "unsupported"
  | "duplicate"
  | "needs_conversion"
  | "too_large"
  | "error";

export const PACKAGE_FILE_STATUS_LABELS: Record<PackageFileStatus, string> = {
  ready_to_import:  "Ready to import",
  ignored:          "Ignored",
  unsupported:      "Unsupported",
  duplicate:        "Duplicate",
  needs_conversion: "Needs conversion",
  too_large:        "File too large",
  error:            "Error",
};

// ---------------------------------------------------------------------------
// A single file entry extracted from the ZIP
// ---------------------------------------------------------------------------

export interface ExtractedPackageFile {
  /** Stable unique id (generated) */
  id: string;
  /** Full path inside the ZIP (e.g. "drawings/plans/BB4101 Floor Plan.pdf") */
  zipPath: string;
  /** Bare filename without directory (e.g. "BB4101 Floor Plan.pdf") */
  fileName: string;
  /** Lowercase extension without dot (e.g. "pdf", "dxf") */
  extension: string;
  /** File size in bytes */
  sizeBytes: number;
  kind: PackageFileKind;
  role: PackageFileRole;
  status: PackageFileStatus;
  confidence: "high" | "medium" | "low";
  /** Human-readable reason for the role/status classification */
  reason: string;
  notes: string[];
  /**
   * In-memory File object — populated only for files selected for import.
   * Extracted lazily from the JSZip entry on user confirmation.
   */
  file?: File;
  /** If this PDF has a matching CAD file with the same drawing number */
  matchedCadName?: string;
  /** If this DWG/DXF has a matching PDF with the same drawing number */
  matchedPdfName?: string;
  /** Stable drawing number extracted from filename/path (e.g. BB4401) */
  drawingIdentity?: string;
  /** Existing project drawing id when status is duplicate */
  duplicateOfDrawingId?: string;
  /** Existing or prior-in-zip filename when status is duplicate */
  duplicateOfFileName?: string;
}

// ---------------------------------------------------------------------------
// Summary counts for the whole package
// ---------------------------------------------------------------------------

export interface PackageUploadSummary {
  totalFiles: number;
  pdfCount: number;
  dwgCount: number;
  dxfCount: number;
  dwfCount: number;
  excelCount: number;
  imageCount: number;
  backupCount: number;
  ignoredCount: number;
  unsupportedCount: number;
  readyToImportCount: number;
  needsConversionCount: number;
  duplicateCount: number;
}
