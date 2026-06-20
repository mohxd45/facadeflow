"use client";

import type { DrawingFile } from "@/types/drawing";
import DrawingPreview from "@/components/drawings/DrawingPreview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DrawingPreviewDialogProps {
  drawing: DrawingFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function DrawingPreviewDialog({
  drawing,
  open,
  onOpenChange,
}: DrawingPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{drawing?.fileName ?? "Drawing Preview"}</DialogTitle>
        </DialogHeader>
        <DrawingPreview drawing={drawing} />
      </DialogContent>
    </Dialog>
  );
}
