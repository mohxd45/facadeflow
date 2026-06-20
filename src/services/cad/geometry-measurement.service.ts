/**
 * CAD Geometry Measurement Service
 *
 * Computes scalar measurements (length, area, count) from normalised
 * CadEntity objects produced by the DXF parser service.
 *
 * All values are in raw drawing units — call cad-unit-conversion.service.ts
 * to obtain SI (meters / sqm) values.
 */

import type {
  CadEntity,
  CadLine,
  CadPolyline,
  CadCircle,
  CadArc,
  CadMeasurement,
} from "@/types/cad";

// ---------------------------------------------------------------------------
// Per-entity calculations
// ---------------------------------------------------------------------------

export function calculateLineLength(line: CadLine): number {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function calculatePolylineLength(polyline: CadPolyline): number {
  return polyline.perimeter;
}

/**
 * Returns the area of a closed polyline, or null if the polyline is open
 * or has fewer than 3 vertices.
 */
export function calculatePolylineArea(polyline: CadPolyline): number | null {
  if (!polyline.closed || !polyline.area || polyline.area <= 0) return null;
  return polyline.area;
}

export function calculateCircleArea(circle: CadCircle): number {
  return circle.area; // already computed as π·r² during parsing
}

/**
 * Arc length = r × θ (angle in radians).
 * Handles wrap-around (end < start → add 360°).
 */
export function calculateArcLength(arc: CadArc): number {
  let deg = arc.endAngle - arc.startAngle;
  if (deg < 0) deg += 360;
  return arc.radius * (deg * (Math.PI / 180));
}

// ---------------------------------------------------------------------------
// Generic dispatcher
// ---------------------------------------------------------------------------

export function getEntityMeasurement(entity: CadEntity): CadMeasurement {
  const base = { entityId: entity.id, layer: entity.layer };

  switch (entity.type) {
    case "LINE": {
      const line = entity as CadLine;
      return {
        ...base,
        type: "length",
        value: calculateLineLength(line),
        unit: "drawing_units",
        source: "line",
      };
    }

    case "LWPOLYLINE":
    case "POLYLINE": {
      const poly = entity as CadPolyline;
      const area = calculatePolylineArea(poly);
      if (area !== null) {
        return {
          ...base,
          type: "area",
          value: area,
          unit: "drawing_units",
          source: "polyline",
        };
      }
      return {
        ...base,
        type: "length",
        value: calculatePolylineLength(poly),
        unit: "drawing_units",
        source: "polyline",
      };
    }

    case "CIRCLE":
      return {
        ...base,
        type: "area",
        value: calculateCircleArea(entity as CadCircle),
        unit: "drawing_units",
        source: "circle",
      };

    case "ARC":
      return {
        ...base,
        type: "length",
        value: calculateArcLength(entity as CadArc),
        unit: "drawing_units",
        source: "arc",
      };

    case "INSERT":
      return {
        ...base,
        type: "count",
        value: 1,
        unit: "nos",
        source: "insert",
      };

    case "TEXT":
    case "MTEXT":
      return {
        ...base,
        type: "unknown",
        value: 0,
        unit: "drawing_units",
        source: "text",
      };

    default:
      return {
        ...base,
        type: "unknown",
        value: 0,
        unit: "drawing_units",
        source: "line",
      };
  }
}
