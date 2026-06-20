"use client";

import { useEffect, useRef, useState } from "react";
import type { DrawingFile } from "@/types/drawing";
import type { QuantityTakeoffItem } from "@/types/takeoff";
import { useTakeoffStore } from "@/stores/takeoff-store";
import { getNextItemCode } from "@/lib/takeoff-utils";
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
  getEmptyTakeoffForm,
  type TakeoffItemFormValues,
} from "./TakeoffItemForm";

interface AddTakeoffItemDialogProps {
  projectId: string;
  drawings: DrawingFile[];
  existingItems: QuantityTakeoffItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: Partial<TakeoffItemFormValues>;
}

export default function AddTakeoffItemDialog({
  projectId,
  drawings,
  existingItems,
  open,
  onOpenChange,
  prefill,
}: AddTakeoffItemDialogProps) {
  const createItem = useTakeoffStore((s) => s.createItem);
  const [values, setValues] = useState<TakeoffItemFormValues>(() =>
    getEmptyTakeoffForm()
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setValues(
        getEmptyTakeoffForm({
          itemCode: getNextItemCode(existingItems),
          sourceDrawingId: drawings[0]?.id ?? "",
          ...prefill,
        })
      );
      setError(null);
    }
    wasOpen.current = open;
  }, [open, existingItems, drawings, prefill]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.itemCode.trim() || !values.elementName.trim()) {
      setError("Item code and element name are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createItem(formValuesToInput(projectId, values));
      onOpenChange(false);
    } catch {
      setError("Failed to save item.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add takeoff item</DialogTitle>
          <DialogDescription>
            Manually add a quantity takeoff line item to this project.
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
              {submitting ? "Saving…" : "Add item"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
