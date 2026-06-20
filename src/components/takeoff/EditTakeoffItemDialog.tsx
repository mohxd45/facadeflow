"use client";

import { useEffect, useState } from "react";
import type { DrawingFile } from "@/types/drawing";
import type { QuantityTakeoffItem } from "@/types/takeoff";
import { useTakeoffStore } from "@/stores/takeoff-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import TakeoffItemForm, {
  formValuesToInput,
  type TakeoffItemFormValues,
} from "./TakeoffItemForm";

interface EditTakeoffItemDialogProps {
  item: QuantityTakeoffItem | null;
  drawings: DrawingFile[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function itemToFormValues(item: QuantityTakeoffItem): TakeoffItemFormValues {
  return {
    itemCode: item.itemCode,
    elementName: item.elementName,
    category: item.category,
    drawingViewType: item.drawingViewType ?? "plan",
    locationFloor: item.locationFloor,
    quantity: item.quantity,
    unit: item.unit,
    sourceDrawingId: item.sourceDrawingId,
    confidence: item.confidence,
    notes: item.notes ?? "",
  };
}

export default function EditTakeoffItemDialog({
  item,
  drawings,
  open,
  onOpenChange,
}: EditTakeoffItemDialogProps) {
  const updateItem = useTakeoffStore((s) => s.updateItem);
  const [values, setValues] = useState<TakeoffItemFormValues | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && item) {
      setValues(itemToFormValues(item));
      setError(null);
    }
  }, [open, item]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || !values) return;
    if (!values.itemCode.trim() || !values.elementName.trim()) {
      setError("Item code and element name are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input = formValuesToInput(item.projectId, values);
      await updateItem(item.id, input);
      onOpenChange(false);
    } catch {
      setError("Failed to update item.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!values) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit takeoff item</DialogTitle>
          <DialogDescription>
            Update quantity takeoff details for {item?.itemCode}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <TakeoffItemForm
            values={values}
            onChange={setValues}
            drawings={drawings}
          />
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
