/**
 * CAD Unit Conversion Service
 *
 * Converts DXF drawing-unit measurements to SI (meters / square meters).
 *
 * The conversion factor is determined by the AutoCAD $INSUNITS header variable.
 * If $INSUNITS is 0 (Unitless) or unrecognised, the functions return null to
 * signal that conversion is not possible and confidence should be lowered.
 *
 * Reference: AutoCAD DXF spec, $INSUNITS group code 70.
 */

/** Meters per one drawing unit for each $INSUNITS code */
const METERS_PER_UNIT: Record<number, number> = {
  1: 0.0254,       // Inches
  2: 0.3048,       // Feet
  3: 1609.344,     // Miles
  4: 0.001,        // Millimeters  ← most common for architectural CAD
  5: 0.01,         // Centimeters
  6: 1.0,          // Meters
  7: 1000.0,       // Kilometers
  8: 2.54e-8,      // Microinches
  9: 2.54e-5,      // Mils
  10: 0.9144,      // Yards
  11: 1e-10,       // Angstroms
  12: 1e-9,        // Nanometers
  13: 1e-6,        // Microns
  14: 0.1,         // Decimeters
  15: 10.0,        // Decameters
  16: 100.0,       // Hectometers
  17: 1e9,         // Gigameters
};

/**
 * Returns the scale factor (meters per drawing unit), or null for unitless/unknown.
 */
export function getMetersPerDrawingUnit(insunits?: number): number | null {
  if (!insunits || insunits === 0) return null;
  return METERS_PER_UNIT[insunits] ?? null;
}

/**
 * Converts a length measured in drawing units to meters.
 * Returns null when units are unitless or unknown.
 */
export function convertLengthToMeters(
  value: number,
  insunits?: number
): number | null {
  const scale = getMetersPerDrawingUnit(insunits);
  if (scale === null) return null;
  return value * scale;
}

/**
 * Converts an area measured in drawing units² to square meters.
 * Returns null when units are unitless or unknown.
 */
export function convertAreaToSquareMeters(
  value: number,
  insunits?: number
): number | null {
  const scale = getMetersPerDrawingUnit(insunits);
  if (scale === null) return null;
  return value * scale * scale;
}

/**
 * Human-readable name for each $INSUNITS code.
 */
export function getUnitLabel(insunits?: number): string {
  if (!insunits || insunits === 0) return "unitless";
  const labels: Record<number, string> = {
    1: "inches",
    2: "feet",
    4: "millimeters",
    5: "centimeters",
    6: "meters",
    7: "kilometers",
    10: "yards",
  };
  return labels[insunits] ?? `unit code ${insunits}`;
}
