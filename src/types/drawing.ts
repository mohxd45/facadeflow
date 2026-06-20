export type DrawingViewType =
  | "plan"
  | "elevation"
  | "section"
  | "detail"
  | "layout"
  | "schedule"
  | "other";

export type DrawingFileType = "pdf" | "dxf" | "dwg";

export type DrawingFileStatus =
  | "uploaded"
  | "processing"
  | "ready"
  | "queued"
  | "error";

export type DrawingCategory =
  | "acp_cladding_plan"
  | "typical_floor_plan"
  | "elevation"
  | "curtain_wall_glass"
  | "aluminium_fins"
  | "balcony_railing"
  | "canopy_detail"
  | "glass_balustrade"
  | "general"
  | "other";

export interface DrawingElement {
  id: string;
  drawingId: string;
  label: string;
  elementType: string;
  geometryRef?: string;
}

export interface DrawingFile {
  id: string;
  projectId: string;
  fileName: string;
  fileType: DrawingFileType;
  fileSize: number;
  drawingViewType: DrawingViewType;
  category: DrawingCategory;
  floorOrLocation?: string;
  uploadedAt: string;
  previewUrl?: string;
  storagePath?: string;
  status: DrawingFileStatus;
  notes?: string;
  hasLocalBlob?: boolean;
  errorMessage?: string;
}

export type CreateDrawingInput = Pick<
  DrawingFile,
  | "projectId"
  | "fileName"
  | "fileType"
  | "fileSize"
  | "drawingViewType"
  | "category"
  | "floorOrLocation"
  | "notes"
>;
