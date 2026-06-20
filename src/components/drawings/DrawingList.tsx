"use client";

import type { DrawingFile } from "@/types/drawing";
import { DRAWING_CATEGORY_LABELS } from "@/lib/constants";
import { formatFileSize } from "@/lib/file-size";
import { formatDateTime } from "@/lib/utils";
import DrawingStatusBadge from "./DrawingStatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Layers } from "lucide-react";

interface DrawingListProps {
  drawings: DrawingFile[];
  onSelect?: (drawing: DrawingFile) => void;
  selectedId?: string;
}

function FileTypeIcon({ type }: { type: DrawingFile["fileType"] }) {
  const colors = {
    pdf: "bg-red-100 text-red-700",
    dxf: "bg-blue-100 text-blue-700",
    dwg: "bg-purple-100 text-purple-700",
  };
  return (
    <div
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xs font-bold uppercase ${colors[type]}`}
    >
      {type}
    </div>
  );
}

export default function DrawingList({
  drawings,
  onSelect,
  selectedId,
}: DrawingListProps) {
  if (drawings.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Layers className="h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
            No drawings yet
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Upload PDF, DXF, or DWG files to get started.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {drawings.map((drawing) => (
        <button
          key={drawing.id}
          type="button"
          onClick={() => onSelect?.(drawing)}
          className={`flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-colors ${
            selectedId === drawing.id
              ? "border-blue-300 bg-blue-50/50"
              : "border-[var(--border)] bg-white hover:bg-slate-50"
          }`}
        >
          <FileTypeIcon type={drawing.fileType} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium">{drawing.fileName}</p>
              <DrawingStatusBadge status={drawing.status} />
            </div>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {DRAWING_CATEGORY_LABELS[drawing.category]}
              {drawing.floorOrLocation && ` · ${drawing.floorOrLocation}`}
              {" · "}
              {formatFileSize(drawing.fileSize)}
              {" · "}
              {formatDateTime(drawing.uploadedAt)}
            </p>
          </div>
          <FileText className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
      ))}
    </div>
  );
}
