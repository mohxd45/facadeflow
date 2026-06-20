/**
 * Scale calibration types — Phase 15
 *
 * When a DXF file has unknown units ($INSUNITS = 0) the estimator can manually
 * specify the real-world scale so quantities are still converted to SI.
 */

export type CalibrationSourceUnit =
  | "unknown"
  | "mm"
  | "cm"
  | "m"
  | "inch"
  | "ft";

/** Meters per drawing unit for each named source unit */
export const CALIBRATION_UNIT_SCALE: Record<
  Exclude<CalibrationSourceUnit, "unknown">,
  number
> = {
  mm: 0.001,
  cm: 0.01,
  m: 1.0,
  inch: 0.0254,
  ft: 0.3048,
};

export const CALIBRATION_UNIT_LABELS: Record<CalibrationSourceUnit, string> = {
  unknown: "Unknown (no calibration)",
  mm: "Millimeters (1 DU = 0.001 m)",
  cm: "Centimeters (1 DU = 0.01 m)",
  m: "Meters (1 DU = 1.000 m)",
  inch: "Inches (1 DU = 0.0254 m)",
  ft: "Feet (1 DU = 0.3048 m)",
};

export interface DrawingScaleCalibration {
  drawingId: string;
  sourceUnit: CalibrationSourceUnit;
  /** Custom scale when sourceUnit is "unknown" but user entered a number */
  metersPerDrawingUnit: number;
  verifiedBy?: string;
  notes?: string;
  updatedAt: string;
}
