/**
 * CAD Geometry Types — Phase 4
 *
 * These are our own normalised representations of DXF entities.
 * We do NOT re-export dxf-parser raw types here so the rest of the app
 * stays decoupled from the underlying parsing library.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export interface CadPoint {
  x: number;
  y: number;
  z?: number;
}

export interface CadBoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Base entity
// ---------------------------------------------------------------------------

export type CadEntityType =
  | "LINE"
  | "POLYLINE"
  | "LWPOLYLINE"
  | "CIRCLE"
  | "ARC"
  | "TEXT"
  | "MTEXT"
  | "INSERT"
  | "SPLINE"
  | "ELLIPSE"
  | "POINT"
  | "DIMENSION"
  | "SOLID"
  | "HATCH"
  | "OTHER";

export interface CadEntity {
  id: string;
  /** Normalised entity type (one of CadEntityType) */
  type: CadEntityType;
  /** Raw type string exactly as returned by dxf-parser */
  rawType: string;
  layer: string;
  color?: number;
  visible: boolean;
  boundingBox?: CadBoundingBox;
}

// ---------------------------------------------------------------------------
// Geometry entities
// ---------------------------------------------------------------------------

export interface CadLine extends CadEntity {
  type: "LINE";
  start: CadPoint;
  end: CadPoint;
  /** Approximate length in drawing units */
  length: number;
}

export interface CadPolyline extends CadEntity {
  type: "POLYLINE" | "LWPOLYLINE";
  vertices: CadPoint[];
  closed: boolean;
  /** Approximate perimeter (sum of segment lengths) */
  perimeter: number;
  /** Approximate area for closed polylines (shoelace formula) */
  area?: number;
}

export interface CadCircle extends CadEntity {
  type: "CIRCLE";
  center: CadPoint;
  radius: number;
  /** π * r² */
  area: number;
  /** 2π * r */
  circumference: number;
}

export interface CadArc extends CadEntity {
  type: "ARC";
  center: CadPoint;
  radius: number;
  startAngle: number;
  endAngle: number;
}

export interface CadText extends CadEntity {
  type: "TEXT" | "MTEXT";
  text: string;
  position: CadPoint;
  height?: number;
}

export interface CadInsert extends CadEntity {
  type: "INSERT";
  /** Name of the inserted block */
  blockName: string;
  position: CadPoint;
  rotation: number;
  xScale: number;
  yScale: number;
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export interface CadLayer {
  name: string;
  visible: boolean;
  frozen: boolean;
  colorIndex: number;
  color: number;
  /** Count of entities on this layer */
  entityCount: number;
}

export interface CadBlock {
  name: string;
  layer: string;
  position: CadPoint;
  /** Number of entities defined inside this block */
  entityCount: number;
}

// ---------------------------------------------------------------------------
// Measurement result (produced by geometry-measurement service)
// ---------------------------------------------------------------------------

export interface CadMeasurement {
  entityId: string;
  layer: string;
  type: "length" | "area" | "count" | "unknown";
  /** Value in drawing units (not yet converted to SI) */
  value: number;
  unit: "drawing_units" | "sqm" | "lm" | "nos";
  source: "line" | "polyline" | "circle" | "arc" | "insert" | "text";
}

// ---------------------------------------------------------------------------
// DXF unit codes  →  human-readable labels
// AutoCAD $INSUNITS header variable
// ---------------------------------------------------------------------------

export const DXF_UNIT_LABELS: Record<number, string> = {
  0: "Unitless",
  1: "Inches",
  2: "Feet",
  3: "Miles",
  4: "Millimeters",
  5: "Centimeters",
  6: "Meters",
  7: "Kilometers",
  8: "Microinches",
  9: "Mils",
  10: "Yards",
  11: "Angstroms",
  12: "Nanometers",
  13: "Microns",
  14: "Decimeters",
  15: "Decameters",
  16: "Hectometers",
  17: "Gigameters",
  18: "Astronomical Units",
  19: "Light Years",
  20: "Parsecs",
};

// ---------------------------------------------------------------------------
// Top-level result
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Layer mapping (Phase 6)
// ---------------------------------------------------------------------------

export type LayerMeasurementMode = "area" | "length" | "count" | "auto";
export type LayerMappingUnit = "sqm" | "lm" | "nos";

export interface CadLayerMapping {
  id: string;
  projectId: string;
  /** Exact layer name as it appears in the DXF file */
  layerName: string;
  category: import("@/types/takeoff").TakeoffCategory;
  measurementMode: LayerMeasurementMode;
  unit: LayerMappingUnit;
  enabled: boolean;
  notes?: string;
  /** Entity count from last DXF parse (display-only, not authoritative) */
  entityCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateLayerMappingInput = Omit<
  CadLayerMapping,
  "id" | "createdAt" | "updatedAt"
>;

// ---------------------------------------------------------------------------
// Top-level result
// ---------------------------------------------------------------------------

export interface ParsedDxfDrawing {
  /** ID of the source DrawingFile record */
  drawingId: string;
  fileName: string;
  fileSize: number;

  /** Drawing unit label (from $INSUNITS header) */
  units: string;
  /** Raw $INSUNITS value */
  unitsCode: number;

  layers: CadLayer[];
  entities: CadEntity[];
  blocks: CadBlock[];

  /** Entity counts keyed by normalised type */
  entityCountByType: Record<string, number>;

  /** Unique text strings found in TEXT and MTEXT entities */
  textLabels: string[];

  /** Unique block names referenced by INSERT entities */
  referencedBlockNames: string[];

  /** All defined block names (from BLOCK table) */
  definedBlockNames: string[];

  /** Overall bounding box across all entities, or null if no geometry */
  boundingBox: CadBoundingBox | null;

  totalEntityCount: number;
  /** Number of INSERT entities (block references) */
  insertCount: number;
  /** Number of distinct layers */
  layerCount: number;
}
