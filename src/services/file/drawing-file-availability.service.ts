import type { DrawingFile, DrawingFileAvailabilityStatus } from "@/types/drawing";

function hasUsableStoragePath(path?: string): boolean {
  if (!path) return false;
  if (path.startsWith("queued/")) return false;
  return true;
}

export function getDrawingFileAvailabilityStatus(
  drawing: DrawingFile
): DrawingFileAvailabilityStatus {
  if (drawing.fileType === "dwg") return "conversion_required";
  if (drawing.fileType !== "pdf" && drawing.fileType !== "dxf") return "unsupported_file";

  const hasAnyFileSource =
    Boolean(drawing.hasLocalBlob) ||
    Boolean(drawing.previewUrl) ||
    hasUsableStoragePath(drawing.storagePath);

  if (hasAnyFileSource) return "file_available";
  if (drawing.status === "queued") return "metadata_only";
  return "needs_reupload";
}

export function getDrawingFileAvailabilityNote(drawing: DrawingFile): string {
  const status = getDrawingFileAvailabilityStatus(drawing);
  switch (status) {
    case "file_available":
      return "File data available for AI Vision rendering.";
    case "metadata_only":
      return "This drawing was imported without file data. Re-upload required for AI Vision.";
    case "needs_reupload":
      return "File data is unavailable. Re-upload required for AI Vision.";
    case "conversion_required":
      return "DWG visual conversion is required before AI Vision can analyze this drawing.";
    case "unsupported_file":
      return "Unsupported drawing format for AI Vision rendering.";
    default:
      return "File availability unknown.";
  }
}
