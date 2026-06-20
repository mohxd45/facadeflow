"use client";

import type { CreateTakeoffItemInput } from "@/types/takeoff";
import type { DrawingFile, DrawingViewType } from "@/types/drawing";
import type { TakeoffCategory, ConfidenceLevel } from "@/types/takeoff";
import {
  CONFIDENCE_LEVELS,
  DRAWING_VIEW_TYPE_LABELS,
  TAKEOFF_CATEGORY_LABELS,
  TAKEOFF_UNITS,
} from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface TakeoffItemFormValues {
  itemCode: string;
  elementName: string;
  category: TakeoffCategory;
  drawingViewType: DrawingViewType;
  locationFloor: string;
  quantity: number;
  unit: string;
  sourceDrawingId: string;
  confidence: ConfidenceLevel;
  notes: string;
}

interface TakeoffItemFormProps {
  values: TakeoffItemFormValues;
  onChange: (values: TakeoffItemFormValues) => void;
  drawings: DrawingFile[];
}

export function getEmptyTakeoffForm(
  overrides?: Partial<TakeoffItemFormValues>
): TakeoffItemFormValues {
  return {
    itemCode: "",
    elementName: "",
    category: "acp_cladding",
    drawingViewType: "plan",
    locationFloor: "",
    quantity: 0,
    unit: "sqm",
    sourceDrawingId: "",
    confidence: "manual",
    notes: "",
    ...overrides,
  };
}

export function formValuesToInput(
  projectId: string,
  values: TakeoffItemFormValues
): CreateTakeoffItemInput {
  return {
    projectId,
    itemCode: values.itemCode,
    elementName: values.elementName,
    category: values.category,
    drawingViewType: values.drawingViewType,
    locationFloor: values.locationFloor,
    quantity: values.quantity,
    unit: values.unit,
    sourceDrawingId: values.sourceDrawingId,
    confidence: values.confidence,
    notes: values.notes || undefined,
  };
}

export default function TakeoffItemForm({
  values,
  onChange,
  drawings,
}: TakeoffItemFormProps) {
  const set = (patch: Partial<TakeoffItemFormValues>) =>
    onChange({ ...values, ...patch });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="itemCode">Item code *</Label>
        <Input
          id="itemCode"
          value={values.itemCode}
          onChange={(e) => set({ itemCode: e.target.value })}
          placeholder="TKF-001"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="elementName">Element name *</Label>
        <Input
          id="elementName"
          value={values.elementName}
          onChange={(e) => set({ elementName: e.target.value })}
          placeholder="e.g. ACP cladding panel"
        />
      </div>
      <div className="space-y-2">
        <Label>Category *</Label>
        <Select
          value={values.category}
          onValueChange={(v) => set({ category: v as TakeoffCategory })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TAKEOFF_CATEGORY_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Drawing view type *</Label>
        <Select
          value={values.drawingViewType}
          onValueChange={(v) =>
            set({ drawingViewType: v as DrawingViewType })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(DRAWING_VIEW_TYPE_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="locationFloor">Location / floor</Label>
        <Input
          id="locationFloor"
          value={values.locationFloor}
          onChange={(e) => set({ locationFloor: e.target.value })}
          placeholder="e.g. Level 12, North elevation"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="quantity">Quantity *</Label>
        <Input
          id="quantity"
          type="number"
          min={0}
          step="any"
          value={values.quantity}
          onChange={(e) =>
            set({ quantity: parseFloat(e.target.value) || 0 })
          }
        />
      </div>
      <div className="space-y-2">
        <Label>Unit *</Label>
        <Select value={values.unit} onValueChange={(v) => set({ unit: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAKEOFF_UNITS.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Source drawing</Label>
        <Select
          value={values.sourceDrawingId || "none"}
          onValueChange={(v) =>
            set({ sourceDrawingId: v === "none" ? "" : v })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Select drawing" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {drawings.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.fileName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Confidence</Label>
        <Select
          value={values.confidence}
          onValueChange={(v) => set({ confidence: v as ConfidenceLevel })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONFIDENCE_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={values.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="Optional notes or assumptions"
          rows={3}
        />
      </div>
    </div>
  );
}
