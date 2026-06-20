import type { QuantityTakeoffItem } from "@/types/takeoff";
import type { DrawingFile } from "@/types/drawing";
import {
  DRAWING_VIEW_TYPE_LABELS,
  TAKEOFF_CATEGORY_LABELS,
} from "@/lib/constants";

function escapeCsv(value: string | number): string {
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportTakeoffToCsv(
  items: QuantityTakeoffItem[],
  drawings: DrawingFile[],
  projectName: string
): void {
  const drawingMap = Object.fromEntries(drawings.map((d) => [d.id, d]));

  const headers = [
    "Item Code",
    "Element Name",
    "Category",
    "Drawing View Type",
    "Location / Floor",
    "Quantity",
    "Unit",
    "Source Drawing",
    "Confidence",
    "Notes",
  ];

  const rows = items.map((item) => [
    item.itemCode,
    item.elementName,
    TAKEOFF_CATEGORY_LABELS[item.category],
    DRAWING_VIEW_TYPE_LABELS[item.drawingViewType],
    item.locationFloor,
    item.quantity,
    item.unit,
    drawingMap[item.sourceDrawingId]?.fileName ?? "",
    item.confidence,
    item.notes ?? "",
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${projectName.replace(/\s+/g, "-")}-quantity-takeoff.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function getNextItemCode(existingItems: QuantityTakeoffItem[]): string {
  const numbers = existingItems
    .map((i) => {
      const match = i.itemCode.match(/TKF-(\d+)/i);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => !Number.isNaN(n));

  const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  return `TKF-${String(next).padStart(3, "0")}`;
}
