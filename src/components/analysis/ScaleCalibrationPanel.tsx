"use client";

import { useState, useEffect } from "react";
import type { DrawingFile } from "@/types/drawing";
import type { CalibrationSourceUnit } from "@/types/calibration";
import {
  CALIBRATION_UNIT_LABELS,
  CALIBRATION_UNIT_SCALE,
} from "@/types/calibration";
import { useScaleCalibrationStore } from "@/stores/scale-calibration-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Ruler, Trash2 } from "lucide-react";

interface ScaleCalibrationPanelProps {
  drawing: DrawingFile;
  /** The DXF file's reported $INSUNITS code (0 = unknown) */
  insunitsCode?: number;
}

const UNIT_OPTIONS: CalibrationSourceUnit[] = ["mm", "cm", "m", "inch", "ft"];

export default function ScaleCalibrationPanel({
  drawing,
  insunitsCode,
}: ScaleCalibrationPanelProps) {
  const getForDrawing = useScaleCalibrationStore((s) => s.getForDrawing);
  const save = useScaleCalibrationStore((s) => s.save);
  const remove = useScaleCalibrationStore((s) => s.remove);

  const existing = getForDrawing(drawing.id);

  const [sourceUnit, setSourceUnit] = useState<CalibrationSourceUnit>(
    existing?.sourceUnit ?? "mm"
  );
  const [customScale, setCustomScale] = useState<string>(
    existing?.metersPerDrawingUnit?.toString() ?? ""
  );
  const [verifiedBy, setVerifiedBy] = useState(existing?.verifiedBy ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saved, setSaved] = useState(false);

  // Sync form when store changes (e.g. after removing)
  useEffect(() => {
    const cal = getForDrawing(drawing.id);
    if (cal) {
      setSourceUnit(cal.sourceUnit);
      setCustomScale(cal.metersPerDrawingUnit.toString());
      setVerifiedBy(cal.verifiedBy ?? "");
      setNotes(cal.notes ?? "");
    }
  }, [drawing.id, getForDrawing]);

  const effectiveScale =
    sourceUnit !== "unknown"
      ? (CALIBRATION_UNIT_SCALE[sourceUnit] ?? null)
      : (parseFloat(customScale) || null);

  const isCustom = sourceUnit === "unknown";

  const handleSave = () => {
    const scale =
      sourceUnit !== "unknown"
        ? CALIBRATION_UNIT_SCALE[sourceUnit]
        : parseFloat(customScale);

    if (!scale || isNaN(scale) || scale <= 0) return;

    save({
      drawingId: drawing.id,
      sourceUnit,
      metersPerDrawingUnit: scale,
      verifiedBy: verifiedBy.trim() || undefined,
      notes: notes.trim() || undefined,
      updatedAt: new Date().toISOString(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleRemove = () => {
    remove(drawing.id);
    setSourceUnit("mm");
    setCustomScale("");
    setVerifiedBy("");
    setNotes("");
  };

  const insunitsOk = insunitsCode !== undefined && insunitsCode !== 0;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-white px-4 py-4 space-y-3">
      <div className="flex items-center gap-2">
        <Ruler className="h-4 w-4 text-blue-600 shrink-0" />
        <h4 className="text-sm font-semibold">Drawing Scale Calibration</h4>
        {existing && existing.sourceUnit !== "unknown" && (
          <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="h-3 w-3" />
            Calibrated
          </span>
        )}
      </div>

      {insunitsOk ? (
        <p className="text-xs text-[var(--muted)]">
          This drawing has{" "}
          <strong>
            $INSUNITS = {insunitsCode}
          </strong>{" "}
          — scale is known. You can override it below if needed.
        </p>
      ) : (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          Drawing units unknown (<code>$INSUNITS = 0</code>). Quantities will be
          marked <strong>low confidence</strong> unless you set a scale here.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--muted)]">
            Drawing unit is
          </label>
          <Select
            value={sourceUnit}
            onValueChange={(v) => setSourceUnit(v as CalibrationSourceUnit)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNIT_OPTIONS.map((u) => (
                <SelectItem key={u} value={u} className="text-xs">
                  {CALIBRATION_UNIT_LABELS[u]}
                </SelectItem>
              ))}
              <SelectItem value="unknown" className="text-xs">
                Custom (enter meters per DU)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isCustom && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--muted)]">
              1 drawing unit = ___ meters
            </label>
            <Input
              type="number"
              min="0"
              step="any"
              className="h-8 text-xs"
              value={customScale}
              onChange={(e) => setCustomScale(e.target.value)}
              placeholder="e.g. 0.001 for mm"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--muted)]">
            Verified by (optional)
          </label>
          <Input
            className="h-8 text-xs"
            value={verifiedBy}
            onChange={(e) => setVerifiedBy(e.target.value)}
            placeholder="e.g. John Smith"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--muted)]">
            Notes (optional)
          </label>
          <Input
            className="h-8 text-xs"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Verified against title block scale"
          />
        </div>
      </div>

      {effectiveScale !== null && (
        <p className="text-xs text-[var(--muted)]">
          Effective scale:{" "}
          <strong>1 DU = {effectiveScale} m</strong>
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={handleSave} disabled={isCustom && !parseFloat(customScale)}>
          {saved ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Saved
            </>
          ) : (
            "Save calibration"
          )}
        </Button>
        {existing && (
          <Button
            size="sm"
            variant="ghost"
            className="text-red-500 hover:text-red-700"
            onClick={handleRemove}
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
