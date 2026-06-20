import type { DrawingFileType } from "@/types/drawing";

/**
 * DWG preview placeholder — real parsing requires backend worker (ODA / Teigha).
 */
export function getDwgPlaceholderMessage(): string {
  return "DWG preview is not available in the browser. The file will be stored and processed on the backend.";
}

export function isDwgType(fileType: DrawingFileType): boolean {
  return fileType === "dwg";
}
