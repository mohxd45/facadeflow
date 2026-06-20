import type { DrawingFileStatus } from "@/types/drawing";
import { Badge } from "@/components/ui/badge";

const STATUS_CONFIG: Record<
  DrawingFileStatus,
  { label: string; variant: "success" | "warning" | "default" | "secondary" | "destructive" }
> = {
  ready: { label: "Ready", variant: "success" },
  queued: { label: "Queued", variant: "warning" },
  processing: { label: "Processing", variant: "default" },
  uploaded: { label: "Uploaded", variant: "secondary" },
  error: { label: "Error", variant: "destructive" },
};

interface DrawingStatusBadgeProps {
  status: DrawingFileStatus;
}

export default function DrawingStatusBadge({ status }: DrawingStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
