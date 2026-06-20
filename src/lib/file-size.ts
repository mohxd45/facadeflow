import {
  LARGE_FILE_WARNING_BYTES,
  MAX_FILE_SIZE_BYTES,
  METADATA_ONLY_THRESHOLD_BYTES,
  PREVIEW_FULL_MAX_BYTES,
  PREVIEW_OPTIONAL_MAX_BYTES,
  VERY_LARGE_FILE_WARNING_BYTES,
} from "./constants";

export type FileSizeTier =
  | "normal"
  | "large"
  | "very_large"
  | "rejected";

export type PreviewStrategy = "full" | "optional" | "none";

export interface FileSizeAnalysis {
  tier: FileSizeTier;
  previewStrategy: PreviewStrategy;
  metadataOnly: boolean;
  warning?: string;
  rejected: boolean;
  rejectReason?: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function analyzeFileSize(bytes: number): FileSizeAnalysis {
  if (bytes > MAX_FILE_SIZE_BYTES) {
    return {
      tier: "rejected",
      previewStrategy: "none",
      metadataOnly: true,
      rejected: true,
      rejectReason: `File exceeds the 1 GB limit (${formatFileSize(bytes)}).`,
    };
  }

  if (bytes > VERY_LARGE_FILE_WARNING_BYTES) {
    return {
      tier: "very_large",
      previewStrategy: "none",
      metadataOnly: true,
      warning:
        "Very large file. This will be stored now and processed later on backend.",
      rejected: false,
    };
  }

  if (bytes > LARGE_FILE_WARNING_BYTES) {
    return {
      tier: "large",
      previewStrategy: "none",
      metadataOnly: true,
      warning: "Large file detected. Processing may take longer.",
      rejected: false,
    };
  }

  if (bytes > PREVIEW_OPTIONAL_MAX_BYTES) {
    return {
      tier: "normal",
      previewStrategy: "none",
      metadataOnly: true,
      rejected: false,
    };
  }

  if (bytes > PREVIEW_FULL_MAX_BYTES) {
    return {
      tier: "normal",
      previewStrategy: "optional",
      metadataOnly: false,
      rejected: false,
    };
  }

  return {
    tier: "normal",
    previewStrategy: "full",
    metadataOnly: false,
    rejected: false,
  };
}

export function shouldStoreBlobLocally(bytes: number): boolean {
  return bytes <= METADATA_ONLY_THRESHOLD_BYTES;
}
