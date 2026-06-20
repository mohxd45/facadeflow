"use client";

import { useState, useEffect } from "react";
import type { TakeoffCategory } from "@/types/takeoff";
import type { LayerMeasurementMode, LayerMappingUnit } from "@/types/cad";
import { TAKEOFF_CATEGORY_LABELS } from "@/lib/constants";
import { defaultUnitForCategory as cadDefaultUnit } from "@/services/dxf/dxf-takeoff-suggestion.service";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Re-export for consumers that import from this file
export function defaultUnitForCategory(category: TakeoffCategory | ""): LayerMappingUnit {
  return cadDefaultUnit(category || null);
}

// ---------------------------------------------------------------------------
// Form shape
// ---------------------------------------------------------------------------

export interface LayerMappingFormValues {
  layerName: string;
  category: TakeoffCategory | "";
  measurementMode: LayerMeasurementMode;
  unit: LayerMappingUnit;
  notes: string;
}

const EMPTY: LayerMappingFormValues = {
  layerName: "",
  category: "",
  measurementMode: "auto",
  unit: "sqm",
  notes: "",
};

interface AddLayerMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill the layer name (e.g. from DXF layer list) */
  prefillLayerName?: string;
  onSave: (values: LayerMappingFormValues) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AddLayerMappingDialog({
  open,
  onOpenChange,
  prefillLayerName,
  onSave,
}: AddLayerMappingDialogProps) {
  const [form, setForm] = useState<LayerMappingFormValues>({
    ...EMPTY,
    layerName: prefillLayerName ?? "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, layerName: prefillLayerName ?? "" });
    }
  }, [open, prefillLayerName]);

  const set = (patch: Partial<LayerMappingFormValues>) =>
    setForm((prev) => {
      const next = { ...prev, ...patch };
      // Auto-sync unit when category changes
      if (patch.category !== undefined) {
        next.unit = defaultUnitForCategory(patch.category);
      }
      return next;
    });

  const handleSave = async () => {
    if (!form.layerName.trim() || !form.category) return;
    setSaving(true);
    try {
      await onSave(form);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const valid = form.layerName.trim().length > 0 && form.category !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add layer mapping</DialogTitle>
          <DialogDescription>
            Map a DXF layer name to a takeoff category and measurement rule.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="lm-layer">Layer name</Label>
            <Input
              id="lm-layer"
              className="mt-1"
              value={form.layerName}
              placeholder="e.g. BALUSTRADE_GLASS"
              onChange={(e) => set({ layerName: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="lm-cat">Category</Label>
            <Select
              value={form.category}
              onValueChange={(v) => set({ category: v as TakeoffCategory })}
            >
              <SelectTrigger id="lm-cat" className="mt-1">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TAKEOFF_CATEGORY_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="lm-mode">Measurement mode</Label>
              <Select
                value={form.measurementMode}
                onValueChange={(v) => set({ measurementMode: v as LayerMeasurementMode })}
              >
                <SelectTrigger id="lm-mode" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="area">Area (sqm)</SelectItem>
                  <SelectItem value="length">Length (lm)</SelectItem>
                  <SelectItem value="count">Count (nos)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="lm-unit">Unit</Label>
              <Select
                value={form.unit}
                onValueChange={(v) => set({ unit: v as LayerMappingUnit })}
              >
                <SelectTrigger id="lm-unit" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sqm">sqm</SelectItem>
                  <SelectItem value="lm">lm</SelectItem>
                  <SelectItem value="nos">nos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="lm-notes">Notes (optional)</Label>
            <Textarea
              id="lm-notes"
              className="mt-1"
              rows={2}
              placeholder="e.g. Main facade ACP panels only"
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !valid}>
            {saving ? "Saving…" : "Save mapping"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
