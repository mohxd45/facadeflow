import type { DrawingFileType } from "@/types/drawing";
import { ACCEPTED_DRAWING_TYPES } from "@/lib/constants";

export function detectDrawingFileType(fileName: string): DrawingFileType | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "dxf") return "dxf";
  if (ext === "dwg") return "dwg";
  return null;
}

export function isAcceptedDrawingFile(file: File): boolean {
  const type = detectDrawingFileType(file.name);
  return type !== null && ACCEPTED_DRAWING_TYPES.includes(type);
}

/**
 * Preview eligibility by file type and size tier.
 * DWG always returns placeholder in v1.
 */
export function canGeneratePreview(
  fileType: DrawingFileType,
  previewStrategy: "full" | "optional" | "none",
  userWantsPreview = true
): boolean {
  if (previewStrategy === "none") return false;
  if (fileType === "dwg") return false;
  if (previewStrategy === "optional" && !userWantsPreview) return false;
  return true;
}
