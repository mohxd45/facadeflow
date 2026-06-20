"use client";

import { useState } from "react";
import type { ParsedDxfDrawing } from "@/types/cad";
import type { DrawingFile } from "@/types/drawing";
import { formatFileSize } from "@/lib/file-size";
import { useLayerMappingStore } from "@/stores/layer-mapping-store";
import {
  inferTakeoffCategoryFromLayer,
  defaultUnitForCategory,
} from "@/services/dxf/dxf-takeoff-suggestion.service";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Layers, Box, Type, FileText } from "lucide-react";
import ScaleCalibrationPanel from "./ScaleCalibrationPanel";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DxfInspectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: ParsedDxfDrawing;
  drawing: DrawingFile;
  projectId: string;
  /** Optional: if provided, shows a "Generate Takeoff" button */
  onGenerateTakeoff?: () => void;
  /** Called after mappings are bulk-created, with the count of newly created mappings */
  onMappingsCreated?: (count: number) => void;
}

// ---------------------------------------------------------------------------
// Small helper components
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-slate-50 px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-100 text-blue-700">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs text-[var(--muted)]">{label}</p>
        <p className="text-lg font-semibold leading-tight">{value.toLocaleString()}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export default function DxfInspectModal({
  open,
  onOpenChange,
  result,
  drawing,
  projectId,
  onGenerateTakeoff,
  onMappingsCreated,
}: DxfInspectModalProps) {
  const allMappings = useLayerMappingStore((s) => s.mappings);
  const createMapping = useLayerMappingStore((s) => s.createMapping);
  const [creatingMappings, setCreatingMappings] = useState(false);
  const [mappingToast, setMappingToast] = useState<string | null>(null);

  const handleCreateMappings = async () => {
    const existingLayers = new Set(
      allMappings.filter((m) => m.projectId === projectId).map((m) => m.layerName)
    );
    const toCreate = result.layers.filter((l) => !existingLayers.has(l.name));
    if (toCreate.length === 0) {
      setMappingToast("All layers already have mappings.");
      setTimeout(() => setMappingToast(null), 3000);
      return;
    }
    setCreatingMappings(true);
    try {
      for (const layer of toCreate) {
        const inferred = inferTakeoffCategoryFromLayer(layer.name);
        await createMapping({
          projectId,
          layerName: layer.name,
          category: inferred?.category ?? "acp_cladding",
          measurementMode: "auto",
          unit: defaultUnitForCategory(inferred?.category ?? null),
          enabled: true,
          entityCount: layer.entityCount,
        });
      }
      const msg = `${toCreate.length} layer mapping${toCreate.length !== 1 ? "s" : ""} created.`;
      setMappingToast(msg);
      setTimeout(() => setMappingToast(null), 3000);
      onMappingsCreated?.(toCreate.length);
    } finally {
      setCreatingMappings(false);
    }
  };
  const sortedEntityTypes = Object.entries(result.entityCountByType).sort(
    ([, a], [, b]) => b - a
  );

  const sortedLayers = [...result.layers].sort(
    (a, b) => b.entityCount - a.entityCount
  );

  const bbText = result.boundingBox
    ? `${result.boundingBox.width.toFixed(2)} × ${result.boundingBox.height.toFixed(2)} ${result.units}`
    : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>DXF Inspection — {drawing.fileName}</DialogTitle>
          <DialogDescription>
            CAD structure extracted from{" "}
            <span className="font-medium">{drawing.fileName}</span> (
            {formatFileSize(drawing.fileSize)}). Units:{" "}
            <strong>{result.units}</strong>. This is a read-only inspection —
            no items have been added to the takeoff table.
          </DialogDescription>
        </DialogHeader>

        {/* ── Summary cards ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={Layers}
            label="Layers"
            value={result.layerCount}
          />
          <StatCard
            icon={Box}
            label="Total entities"
            value={result.totalEntityCount}
          />
          <StatCard
            icon={FileText}
            label="Block references"
            value={result.insertCount}
          />
          <StatCard
            icon={Type}
            label="Text labels"
            value={result.textLabels.length}
          />
        </div>

        {/* Drawing extents */}
        <div className="rounded-md border border-[var(--border)] px-4 py-2.5 text-sm">
          <span className="font-medium">Drawing extents:</span>{" "}
          <span className="text-[var(--muted)]">{bbText}</span>
          {result.boundingBox && (
            <span className="ml-4 text-[var(--muted)]">
              Origin ({result.boundingBox.minX.toFixed(2)},{" "}
              {result.boundingBox.minY.toFixed(2)}) → (
              {result.boundingBox.maxX.toFixed(2)},{" "}
              {result.boundingBox.maxY.toFixed(2)})
            </span>
          )}
        </div>

        {/* ── Entity type breakdown ─────────────────────────────────── */}
        <section>
          <h3 className="mb-2 text-sm font-semibold">Entity types</h3>
          <div className="flex flex-wrap gap-2">
            {sortedEntityTypes.map(([type, count]) => (
              <span
                key={type}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-slate-50 px-3 py-1 text-xs"
              >
                <span className="font-mono font-medium">{type}</span>
                <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                  {count.toLocaleString()}
                </Badge>
              </span>
            ))}
          </div>
        </section>

        {/* ── Layer table ───────────────────────────────────────────── */}
        <section>
          <h3 className="mb-2 text-sm font-semibold">
            Layers ({result.layerCount})
          </h3>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border)]">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead>Layer name</TableHead>
                  <TableHead className="text-right">Entities</TableHead>
                  <TableHead className="text-center">Visible</TableHead>
                  <TableHead className="text-center">Frozen</TableHead>
                  <TableHead className="text-right">Color index</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedLayers.map((layer) => (
                  <TableRow key={layer.name}>
                    <TableCell className="font-mono text-xs">
                      {layer.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {layer.entityCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      {layer.visible ? (
                        <span className="text-green-600">●</span>
                      ) : (
                        <span className="text-slate-400">○</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {layer.frozen ? (
                        <span className="text-amber-500">❄</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-[var(--muted)]">
                      {layer.colorIndex}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* ── Block definitions ────────────────────────────────────── */}
        {result.definedBlockNames.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">
              Defined blocks ({result.definedBlockNames.length})
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {result.definedBlockNames.map((bn) => (
                <span
                  key={bn}
                  className="rounded border border-[var(--border)] bg-slate-50 px-2 py-0.5 font-mono text-xs"
                >
                  {bn}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ── Referenced blocks ────────────────────────────────────── */}
        {result.referencedBlockNames.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">
              Referenced blocks in entities ({result.referencedBlockNames.length})
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {result.referencedBlockNames.map((bn) => (
                <span
                  key={bn}
                  className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-xs text-blue-800"
                >
                  {bn}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ── Text labels ──────────────────────────────────────────── */}
        {result.textLabels.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold">
              Text labels ({result.textLabels.length}
              {result.textLabels.length === 500 ? " — first 500 shown" : ""})
            </h3>
            <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--border)] bg-slate-50 p-3">
              <div className="flex flex-wrap gap-1.5">
                {result.textLabels.map((t, i) => (
                  <span
                    key={i}
                    className="max-w-xs truncate rounded border border-[var(--border)] bg-white px-2 py-0.5 font-mono text-xs"
                    title={t}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── Scale calibration ────────────────────────────────────── */}
        <ScaleCalibrationPanel drawing={drawing} insunitsCode={result.unitsCode} />

        {/* ── Mapping toast ────────────────────────────────────────── */}
        {mappingToast && (
          <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
            ✓ {mappingToast}
          </div>
        )}

        {/* ── Actions ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={creatingMappings}
              onClick={handleCreateMappings}
            >
              {creatingMappings ? "Creating…" : "Create mappings from layers"}
            </Button>
            {onGenerateTakeoff && (
              <Button
                onClick={() => {
                  onOpenChange(false);
                  onGenerateTakeoff();
                }}
              >
                Generate Takeoff from DXF
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
