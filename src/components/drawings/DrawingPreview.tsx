"use client";

import { useEffect, useState } from "react";
import type { DrawingFile } from "@/types/drawing";
import { getDwgPlaceholderMessage } from "@/services/file/dwg-placeholder";
import { getFileBlob } from "@/services/file/file-blob.store";
import { formatFileSize } from "@/lib/file-size";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import DrawingStatusBadge from "./DrawingStatusBadge";
import { FileWarning, Loader2 } from "lucide-react";

interface DrawingPreviewProps {
  drawing: DrawingFile | null;
}

export default function DrawingPreview({ drawing }: DrawingPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;

    async function loadPreview() {
      if (!drawing) {
        setPreviewUrl(null);
        return;
      }

      if (drawing.status === "queued" && !drawing.hasLocalBlob) {
        setPreviewUrl(null);
        return;
      }

      if (drawing.previewUrl) {
        setPreviewUrl(drawing.previewUrl);
        return;
      }

      if (drawing.hasLocalBlob) {
        setLoading(true);
        try {
          const blob = await getFileBlob(drawing.id);
          if (blob && drawing.fileType === "pdf") {
            objectUrl = URL.createObjectURL(blob);
            setPreviewUrl(objectUrl);
          }
        } finally {
          setLoading(false);
        }
      }
    }

    loadPreview();

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [drawing]);

  if (!drawing) {
    return (
      <Card className="h-full min-h-[300px]">
        <CardContent className="flex h-full min-h-[300px] items-center justify-center text-sm text-[var(--muted)]">
          Select a drawing to preview
        </CardContent>
      </Card>
    );
  }

  if (drawing.status === "queued" && !drawing.hasLocalBlob) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{drawing.fileName}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center rounded-md border border-dashed border-amber-300 bg-amber-50 p-8 text-center">
            <FileWarning className="h-10 w-10 text-amber-600" />
            <p className="mt-3 text-sm font-medium text-amber-900">
              Queued for backend processing
            </p>
            <p className="mt-1 max-w-sm text-xs text-amber-800">
              This {formatFileSize(drawing.fileSize)} file was registered without
              loading into the browser. It will be processed when uploaded to
              backend storage.
            </p>
            <div className="mt-3">
              <DrawingStatusBadge status={drawing.status} />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (drawing.fileType === "dwg") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{drawing.fileName}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <FileWarning className="h-10 w-10 text-slate-400" />
            <p className="mt-3 text-sm font-medium">DWG Preview Unavailable</p>
            <p className="mt-1 max-w-sm text-xs text-[var(--muted)]">
              {getDwgPlaceholderMessage()}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="flex min-h-[300px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted)]" />
      </Card>
    );
  }

  if (drawing.fileType === "pdf" && previewUrl) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{drawing.fileName}</CardTitle>
        </CardHeader>
        <CardContent>
          <iframe
            src={previewUrl}
            title={drawing.fileName}
            className="h-[500px] w-full rounded-md border border-[var(--border)]"
          />
        </CardContent>
      </Card>
    );
  }

  if (drawing.fileType === "dxf") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{drawing.fileName}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <p className="text-sm font-medium">DXF file stored</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Full DXF geometry preview will be available via backend rendering.
              File size: {formatFileSize(drawing.fileSize)}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-[var(--muted)]">
        Preview not available for this file.
      </CardContent>
    </Card>
  );
}
