import { analyzeFileSize } from "@/lib/file-size";
import { formatFileSize } from "@/lib/file-size";
import { AlertTriangle, Info } from "lucide-react";

interface FileSizeWarningProps {
  fileSize: number;
}

export default function FileSizeWarning({ fileSize }: FileSizeWarningProps) {
  const analysis = analyzeFileSize(fileSize);

  if (analysis.rejected) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">File too large</p>
          <p className="mt-0.5">{analysis.rejectReason}</p>
        </div>
      </div>
    );
  }

  if (!analysis.warning) return null;

  const isVeryLarge = analysis.tier === "very_large";

  return (
    <div
      className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
        isVeryLarge
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-yellow-200 bg-yellow-50 text-yellow-900"
      }`}
    >
      {isVeryLarge ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div>
        <p className="font-medium">{analysis.warning}</p>
        <p className="mt-0.5 text-xs opacity-80">
          File size: {formatFileSize(fileSize)}
          {analysis.metadataOnly && " — metadata only, no browser preview"}
        </p>
      </div>
    </div>
  );
}
