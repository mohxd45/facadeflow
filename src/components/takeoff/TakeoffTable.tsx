"use client";

import { useState } from "react";
import type { QuantityTakeoffItem } from "@/types/takeoff";
import type { DrawingFile } from "@/types/drawing";
import type { Project } from "@/types/project";
import {
  DRAWING_VIEW_TYPE_LABELS,
  TAKEOFF_CATEGORY_LABELS,
} from "@/lib/constants";
import { exportTakeoffToCsv } from "@/lib/takeoff-utils";
import { exportQuantityTakeoffToExcel } from "@/services/export/quantity-excel-export.service";
import { useTakeoffStore } from "@/stores/takeoff-store";
import { useCompanyStore } from "@/stores/company-store";
import { useCodeTakeoffStore } from "@/stores/code-takeoff-store";
import { useDrawingTakeoffStore } from "@/stores/drawing-takeoff-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import AddTakeoffItemDialog from "./AddTakeoffItemDialog";
import EditTakeoffItemDialog from "./EditTakeoffItemDialog";
import type { TakeoffItemFormValues } from "./TakeoffItemForm";
import { Plus, Download, FileSpreadsheet, Pencil, Trash2 } from "lucide-react";

interface TakeoffTableProps {
  project: Project;
  items: QuantityTakeoffItem[];
  drawings: DrawingFile[];
  addDialogOpen?: boolean;
  onAddDialogOpenChange?: (open: boolean) => void;
  addPrefill?: Partial<TakeoffItemFormValues>;
}

const CONFIDENCE_VARIANTS = {
  manual: "secondary",
  high: "success",
  medium: "warning",
  low: "destructive",
} as const;

export default function TakeoffTable({
  project,
  items,
  drawings,
  addDialogOpen: controlledAddOpen,
  onAddDialogOpenChange,
  addPrefill,
}: TakeoffTableProps) {
  const deleteItem = useTakeoffStore((s) => s.deleteItem);
  const companyProfile = useCompanyStore((s) => s.profile);
  const allCodeItems = useCodeTakeoffStore((s) => s.items);
  const codeItems = allCodeItems.filter((i) => i.projectId === project.id);
  const allDrawingItems = useDrawingTakeoffStore((s) => s.items);
  const drawingTakeoffItems = allDrawingItems.filter((i) => i.projectId === project.id);
  const [internalAddOpen, setInternalAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<QuantityTakeoffItem | null>(null);

  const addOpen = controlledAddOpen ?? internalAddOpen;
  const setAddOpen = onAddDialogOpenChange ?? setInternalAddOpen;

  const drawingMap = Object.fromEntries(drawings.map((d) => [d.id, d]));

  const handleDelete = async (item: QuantityTakeoffItem) => {
    if (!window.confirm(`Delete item "${item.itemCode}"?`)) return;
    await deleteItem(item.id);
  };

  const handleExportCsv = () => {
    exportTakeoffToCsv(items, drawings, project.name);
  };

  const handleExportExcel = () => {
    exportQuantityTakeoffToExcel({
      project,
      drawings,
      items,
      companyProfile,
      drawingTakeoffItems: drawingTakeoffItems.length > 0 ? drawingTakeoffItems : undefined,
      codeTakeoffItems: codeItems.length > 0 ? codeItems : undefined,
    });
  };

  const exportDisabled =
    items.length === 0 && codeItems.length === 0 && drawingTakeoffItems.length === 0;
  const extraSheets = [
    drawingTakeoffItems.length > 0 && `Drawing Takeoff (${drawingTakeoffItems.length})`,
    codeItems.length > 0 && `Code Takeoff (${codeItems.length})`,
  ].filter(Boolean);
  const exportTitle = exportDisabled
    ? "No takeoff items to export."
    : extraSheets.length > 0
    ? `Includes extra sheets: ${extraSheets.join(", ")}`
    : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted)]">
          {items.length} takeoff item{items.length !== 1 && "s"}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            disabled={exportDisabled}
            title={exportTitle}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Export Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={exportDisabled}
            title={exportTitle}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add item
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] py-12 text-center">
          <p className="text-sm font-medium">No takeoff items yet</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Add items manually or send a drawing from the Drawings tab.
          </p>
          <Button className="mt-4" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add first item
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Item code</TableHead>
                <TableHead>Element name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Drawing view</TableHead>
                <TableHead>Location / floor</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Source drawing</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs font-medium">
                    {item.itemCode}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {item.elementName}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[var(--muted)]">
                    {TAKEOFF_CATEGORY_LABELS[item.category]}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[var(--muted)]">
                    {
                      DRAWING_VIEW_TYPE_LABELS[
                        item.drawingViewType ?? "plan"
                      ]
                    }
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate">
                    {item.locationFloor || "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {item.quantity.toLocaleString()}
                  </TableCell>
                  <TableCell>{item.unit}</TableCell>
                  <TableCell className="max-w-[140px] truncate text-[var(--muted)]">
                    {drawingMap[item.sourceDrawingId]?.fileName ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        CONFIDENCE_VARIANTS[item.confidence] ?? "secondary"
                      }
                    >
                      {item.confidence}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-[var(--muted)]">
                    {item.notes || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit"
                        onClick={() => setEditItem(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        onClick={() => handleDelete(item)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddTakeoffItemDialog
        projectId={project.id}
        drawings={drawings}
        existingItems={items}
        open={addOpen}
        onOpenChange={setAddOpen}
        prefill={addPrefill}
      />

      <EditTakeoffItemDialog
        item={editItem}
        drawings={drawings}
        open={editItem !== null}
        onOpenChange={(open) => !open && setEditItem(null)}
      />
    </div>
  );
}
