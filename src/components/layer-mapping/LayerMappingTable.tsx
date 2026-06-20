"use client";

import { useMemo, useState } from "react";
import type { CadLayerMapping, LayerMeasurementMode, LayerMappingUnit } from "@/types/cad";
import type { TakeoffCategory } from "@/types/takeoff";
import { TAKEOFF_CATEGORY_LABELS } from "@/lib/constants";
import { useLayerMappingStore } from "@/stores/layer-mapping-store";
import { inferTakeoffCategoryFromLayer } from "@/services/dxf/dxf-takeoff-suggestion.service";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, ToggleLeft, ToggleRight, VolumeX } from "lucide-react";
import AddLayerMappingDialog from "./AddLayerMappingDialog";
import type { LayerMappingFormValues } from "./AddLayerMappingDialog";
import { defaultUnitForCategory } from "./AddLayerMappingDialog";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LayerMappingTableProps {
  projectId: string;
}

// ---------------------------------------------------------------------------
// Mode / unit option lists
// ---------------------------------------------------------------------------

const MODE_OPTIONS: { value: LayerMeasurementMode; label: string }[] = [
  { value: "auto",   label: "Auto" },
  { value: "area",   label: "Area" },
  { value: "length", label: "Length" },
  { value: "count",  label: "Count" },
];

const UNIT_OPTIONS: { value: LayerMappingUnit; label: string }[] = [
  { value: "sqm", label: "sqm" },
  { value: "lm",  label: "lm"  },
  { value: "nos", label: "nos" },
];

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

interface MappingRowProps {
  mapping: CadLayerMapping;
  onUpdate: (id: string, patch: Partial<CadLayerMapping>) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
}

function MappingRow({ mapping, onUpdate, onDelete, onToggle }: MappingRowProps) {
  const inferred = inferTakeoffCategoryFromLayer(mapping.layerName);
  const [notes, setNotes] = useState(mapping.notes ?? "");

  return (
    <TableRow className={!mapping.enabled ? "opacity-50" : undefined}>
      {/* Toggle */}
      <TableCell>
        <button
          type="button"
          onClick={() => onToggle(mapping.id)}
          title={mapping.enabled ? "Disable layer" : "Enable layer"}
          className="text-slate-400 hover:text-slate-700"
        >
          {mapping.enabled ? (
            <ToggleRight className="h-5 w-5 text-green-600" />
          ) : (
            <ToggleLeft className="h-5 w-5" />
          )}
        </button>
      </TableCell>

      {/* Layer name */}
      <TableCell className="font-mono text-xs font-medium">{mapping.layerName}</TableCell>

      {/* Entity count */}
      <TableCell className="text-right tabular-nums text-xs text-[var(--muted)]">
        {mapping.entityCount?.toLocaleString() ?? "—"}
      </TableCell>

      {/* Inferred category (read-only hint) */}
      <TableCell className="text-xs text-[var(--muted)]">
        {inferred
          ? TAKEOFF_CATEGORY_LABELS[inferred.category]
          : <span className="italic">Unknown</span>}
      </TableCell>

      {/* Category select */}
      <TableCell>
        <Select
          value={mapping.category}
          onValueChange={(v) => {
            const cat = v as TakeoffCategory;
            onUpdate(mapping.id, {
              category: cat,
              unit: defaultUnitForCategory(cat),
            });
          }}
        >
          <SelectTrigger className="h-7 text-xs w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TAKEOFF_CATEGORY_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k} className="text-xs">{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Measurement mode */}
      <TableCell>
        <Select
          value={mapping.measurementMode}
          onValueChange={(v) => onUpdate(mapping.id, { measurementMode: v as LayerMeasurementMode })}
        >
          <SelectTrigger className="h-7 text-xs w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Unit */}
      <TableCell>
        <Select
          value={mapping.unit}
          onValueChange={(v) => onUpdate(mapping.id, { unit: v as LayerMappingUnit })}
        >
          <SelectTrigger className="h-7 text-xs w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNIT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Notes */}
      <TableCell>
        <Input
          className="h-7 text-xs w-40"
          value={notes}
          placeholder="Optional note…"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (mapping.notes ?? "")) {
              onUpdate(mapping.id, { notes });
            }
          }}
        />
      </TableCell>

      {/* Enabled badge */}
      <TableCell>
        <Badge variant={mapping.enabled ? "success" : "secondary"} className="text-[10px]">
          {mapping.enabled ? "On" : "Off"}
        </Badge>
      </TableCell>

      {/* Delete */}
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Delete mapping"
          onClick={() => onDelete(mapping.id)}
        >
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Main table
// ---------------------------------------------------------------------------

export default function LayerMappingTable({ projectId }: LayerMappingTableProps) {
  const allMappings = useLayerMappingStore((s) => s.mappings);
  const updateMapping = useLayerMappingStore((s) => s.updateMapping);
  const deleteMapping = useLayerMappingStore((s) => s.deleteMapping);
  const toggleEnabled = useLayerMappingStore((s) => s.toggleEnabled);
  const createMapping = useLayerMappingStore((s) => s.createMapping);

  const mappings = useMemo(
    () => allMappings.filter((m) => m.projectId === projectId),
    [allMappings, projectId]
  );

  const bulkDisableNoiseLayers = useLayerMappingStore((s) => s.bulkDisableNoiseLayers);

  const [addOpen, setAddOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [disablingNoise, setDisablingNoise] = useState(false);
  const [noiseToast, setNoiseToast] = useState<string | null>(null);

  const handleUpdate = (id: string, patch: Partial<CadLayerMapping>) => {
    updateMapping(id, patch);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this layer mapping?")) return;
    setDeletingId(id);
    try {
      await deleteMapping(id);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDisableNoise = async () => {
    setDisablingNoise(true);
    try {
      const count = await bulkDisableNoiseLayers(projectId);
      const msg =
        count === 0
          ? "No active noise layers found."
          : `${count} noise layer${count !== 1 ? "s" : ""} disabled.`;
      setNoiseToast(msg);
      setTimeout(() => setNoiseToast(null), 3500);
    } finally {
      setDisablingNoise(false);
    }
  };

  const handleAdd = async (form: LayerMappingFormValues) => {
    if (!form.category) return;
    await createMapping({
      projectId,
      layerName: form.layerName.trim(),
      category: form.category as TakeoffCategory,
      measurementMode: form.measurementMode,
      unit: form.unit,
      enabled: true,
      notes: form.notes || undefined,
    });
  };

  if (mappings.length === 0) {
    return (
      <>
        <div className="rounded-lg border border-dashed border-[var(--border)] py-16 text-center">
          <p className="text-sm font-medium">No layer mappings yet</p>
          <p className="mt-1 max-w-sm mx-auto text-sm text-[var(--muted)]">
            Open a DXF drawing, click{" "}
            <strong>Inspect DXF</strong>, then use{" "}
            <strong>Create mappings from layers</strong> to auto-generate rules.
            Or add one manually below.
          </p>
          <Button
            size="sm"
            className="mt-4"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add layer mapping
          </Button>
        </div>

        <AddLayerMappingDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onSave={handleAdd}
        />
      </>
    );
  }

  const disabledCount = mappings.filter((m) => !m.enabled).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted)]">
          {mappings.length} mapping{mappings.length !== 1 ? "s" : ""} · {disabledCount} disabled.
          Changes are saved automatically.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={disablingNoise}
            onClick={handleDisableNoise}
            title="Disable dimensions, annotations, screws, grids, and other non-quantity layers"
          >
            <VolumeX className="h-4 w-4" />
            {disablingNoise ? "Disabling…" : "Disable noise layers"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add mapping
          </Button>
        </div>
      </div>

      {noiseToast && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          {noiseToast}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/80">
              <TableHead className="w-10" />
              <TableHead>Layer name</TableHead>
              <TableHead className="text-right">Entities</TableHead>
              <TableHead>Inferred category</TableHead>
              <TableHead>Mapped category</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings.map((m) => (
              <MappingRow
                key={m.id}
                mapping={m}
                onUpdate={handleUpdate}
                onDelete={(id) => {
                  if (deletingId !== id) handleDelete(id);
                }}
                onToggle={toggleEnabled}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <AddLayerMappingDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSave={handleAdd}
      />
    </>
  );
}
