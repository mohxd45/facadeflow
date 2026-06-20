import type { DrawingCategory, DrawingFileType, DrawingViewType } from "@/types/drawing";
import type { TakeoffCategory } from "@/types/takeoff";
import type { ConfidenceLevel } from "@/types/takeoff";

/** Maximum allowed file size: 1 GB */
export const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024 * 1024;

/** Show "large file" warning above 250 MB */
export const LARGE_FILE_WARNING_BYTES = 250 * 1024 * 1024;

/** Show "very large file" warning above 500 MB */
export const VERY_LARGE_FILE_WARNING_BYTES = 500 * 1024 * 1024;

/** Full preview for files under 100 MB */
export const PREVIEW_FULL_MAX_BYTES = 100 * 1024 * 1024;

/** Optional preview for files 100 MB – 250 MB */
export const PREVIEW_OPTIONAL_MAX_BYTES = 250 * 1024 * 1024;

/** Above this threshold: metadata only, status queued — no blob in browser */
export const METADATA_ONLY_THRESHOLD_BYTES = 250 * 1024 * 1024;

export const ACCEPTED_DRAWING_TYPES: DrawingFileType[] = ["pdf", "dxf", "dwg"];

export const ACCEPTED_MIME_TYPES: Record<DrawingFileType, string[]> = {
  pdf: ["application/pdf"],
  dxf: ["application/dxf", "image/vnd.dxf", "application/x-dxf"],
  dwg: ["application/acad", "application/x-acad", "image/vnd.dwg", "application/octet-stream"],
};

export const DRAWING_VIEW_TYPE_LABELS: Record<DrawingViewType, string> = {
  plan: "Plan",
  elevation: "Elevation",
  section: "Section",
  detail: "Detail",
  layout: "Layout",
  schedule: "Schedule",
  other: "Other",
};

export const DRAWING_CATEGORY_LABELS: Record<DrawingCategory, string> = {
  acp_cladding_plan: "ACP Cladding Plan",
  typical_floor_plan: "Typical Floor Plan",
  elevation: "Elevation",
  curtain_wall_glass: "Curtain Wall Glass",
  aluminium_fins: "Aluminium Fins",
  balcony_railing: "Balcony Railing",
  canopy_detail: "Canopy Detail",
  glass_balustrade: "Glass Balustrade",
  general: "General",
  other: "Other",
};

export const TAKEOFF_CATEGORY_LABELS: Record<TakeoffCategory, string> = {
  balcony_railing: "Balcony Railing",
  glass_balustrade: "Glass Balustrade",
  acp_cladding: "ACP Cladding",
  curtain_wall_glass_panel: "Curtain Wall Glass Panel",
  aluminium_fins: "Aluminium Fins",
  canopy: "Canopy",
  glass_partitions: "Glass Partitions",
  windows: "Windows",
  doors: "Doors",
  louvers: "Louvers",
  screen: "Screen",
};

export const TAKEOFF_UNITS = ["sqm", "sqft", "lm", "nos", "set"] as const;

export type TakeoffUnit = (typeof TAKEOFF_UNITS)[number];

export const CONFIDENCE_LEVELS: ConfidenceLevel[] = [
  "manual",
  "high",
  "medium",
  "low",
];

export const TAKEOFF_CATEGORIES = Object.keys(
  TAKEOFF_CATEGORY_LABELS
) as TakeoffCategory[];

export const STORAGE_KEYS = {
  projects: "facade-takeoff:projects",
  drawings: "facade-takeoff:drawings",
  takeoffItems: "facade-takeoff:takeoff-items",
  layerMappings: "facade-takeoff:layer-mappings",
  manualQuantities: "facade-takeoff:manual-quantities",
  companyProfile: "facade-takeoff:company-profile",
  seeded: "facade-takeoff:seeded",
  itemCodeRules: "facade-takeoff:item-code-rules",
  codeTakeoffItems: "facade-takeoff:code-takeoff-items",
  drawingTakeoffItems: "facade-takeoff:drawing-takeoff-items",
  drawingIssueItems: "facade-takeoff:drawing-issue-items",
  ocrResults: "facade-takeoff:ocr-results",
  aiReviewResults: "facade-takeoff:ai-review-results",
} as const;

export const INDEXED_DB_NAME = "facade-takeoff-files";
export const INDEXED_DB_STORE = "drawing-blobs";
