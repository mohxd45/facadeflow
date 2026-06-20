/**
 * DXF Parser Service — Phase 4
 *
 * Wraps the `dxf-parser` library and normalises the raw parsed output
 * into our own `ParsedDxfDrawing` type.
 *
 * Design:
 * - Client-side only; limited to files ≤ 100 MB.
 * - Fully synchronous parsing (dxf-parser has no async mode) wrapped in a
 *   promise so callers can use async/await.
 * - No quantities are extracted yet — this phase proves CAD structure
 *   inspection only.
 *
 * Future:
 * - For files > 100 MB, route to a backend worker.
 * - Phase 5 will layer geometry-based takeoff rules over this output.
 */

import type {
  CadEntity,
  CadEntityType,
  CadLayer,
  CadBlock,
  CadLine,
  CadPolyline,
  CadCircle,
  CadArc,
  CadText,
  CadInsert,
  CadPoint,
  CadBoundingBox,
  ParsedDxfDrawing,
} from "@/types/cad";
import { DXF_UNIT_LABELS } from "@/types/cad";

// ---------------------------------------------------------------------------
// Size guard
// ---------------------------------------------------------------------------

const CLIENT_SIZE_LIMIT_BYTES = 100 * 1024 * 1024; // 100 MB

// ---------------------------------------------------------------------------
// ID generator (cheap sequential for client-side use)
// ---------------------------------------------------------------------------

let _entityIdCounter = 0;
function nextEntityId(): string {
  return `cad-${++_entityIdCounter}`;
}

// ---------------------------------------------------------------------------
// Type normalisation
// ---------------------------------------------------------------------------

function normType(raw: string): CadEntityType {
  switch (raw?.toUpperCase()) {
    case "LINE":
      return "LINE";
    case "POLYLINE":
      return "POLYLINE";
    case "LWPOLYLINE":
      return "LWPOLYLINE";
    case "CIRCLE":
      return "CIRCLE";
    case "ARC":
      return "ARC";
    case "TEXT":
      return "TEXT";
    case "MTEXT":
      return "MTEXT";
    case "INSERT":
      return "INSERT";
    case "SPLINE":
      return "SPLINE";
    case "ELLIPSE":
      return "ELLIPSE";
    case "POINT":
      return "POINT";
    case "DIMENSION":
      return "DIMENSION";
    case "SOLID":
      return "SOLID";
    case "HATCH":
      return "HATCH";
    default:
      return "OTHER";
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function dist2d(a: CadPoint, b: CadPoint): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/** Shoelace formula for polygon area */
function polygonArea(pts: CadPoint[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

function ptBBox(
  pts: CadPoint[]
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (pts.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function makeBBox(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): CadBoundingBox {
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Entity mappers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEntity(raw: any): CadEntity | null {
  if (!raw?.type) return null;

  const base = {
    id: raw.handle ?? nextEntityId(),
    rawType: String(raw.type),
    type: normType(raw.type),
    layer: raw.layer ?? "0",
    color: raw.color,
    visible: raw.visible !== false,
  };

  try {
    switch (base.type) {
      case "LINE": {
        const start: CadPoint = raw.vertices?.[0] ?? raw.start ?? { x: 0, y: 0 };
        const end: CadPoint = raw.vertices?.[1] ?? raw.end ?? { x: 0, y: 0 };
        const length = dist2d(start, end);
        const bb = ptBBox([start, end]);
        const line: CadLine = {
          ...base,
          type: "LINE",
          start,
          end,
          length,
          boundingBox: bb
            ? makeBBox(bb.minX, bb.minY, bb.maxX, bb.maxY)
            : undefined,
        };
        return line;
      }

      case "POLYLINE":
      case "LWPOLYLINE": {
        const vertices: CadPoint[] = (raw.vertices ?? []).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (v: any) => ({ x: v.x ?? 0, y: v.y ?? 0, z: v.z })
        );
        const closed = !!(raw.shape || raw.closed);
        let perimeter = 0;
        for (let i = 0; i < vertices.length - 1; i++) {
          perimeter += dist2d(vertices[i], vertices[i + 1]);
        }
        if (closed && vertices.length > 1) {
          perimeter += dist2d(vertices[vertices.length - 1], vertices[0]);
        }
        const area = closed && vertices.length > 2 ? polygonArea(vertices) : undefined;
        const bb = ptBBox(vertices);
        const poly: CadPolyline = {
          ...base,
          type: base.type as "POLYLINE" | "LWPOLYLINE",
          vertices,
          closed,
          perimeter,
          area,
          boundingBox: bb
            ? makeBBox(bb.minX, bb.minY, bb.maxX, bb.maxY)
            : undefined,
        };
        return poly;
      }

      case "CIRCLE": {
        const center: CadPoint = raw.center ?? { x: 0, y: 0 };
        const radius: number = raw.radius ?? 0;
        const circle: CadCircle = {
          ...base,
          type: "CIRCLE",
          center,
          radius,
          area: Math.PI * radius * radius,
          circumference: 2 * Math.PI * radius,
          boundingBox: makeBBox(
            center.x - radius,
            center.y - radius,
            center.x + radius,
            center.y + radius
          ),
        };
        return circle;
      }

      case "ARC": {
        const center: CadPoint = raw.center ?? { x: 0, y: 0 };
        const arc: CadArc = {
          ...base,
          type: "ARC",
          center,
          radius: raw.radius ?? 0,
          startAngle: raw.startAngle ?? 0,
          endAngle: raw.endAngle ?? 0,
        };
        return arc;
      }

      case "TEXT":
      case "MTEXT": {
        const text: CadText = {
          ...base,
          type: base.type as "TEXT" | "MTEXT",
          text: (raw.text ?? raw.string ?? "").trim(),
          position: raw.startPoint ?? raw.position ?? { x: 0, y: 0 },
          height: raw.textHeight ?? raw.height,
        };
        return text;
      }

      case "INSERT": {
        const insert: CadInsert = {
          ...base,
          type: "INSERT",
          blockName: raw.name ?? "",
          position: raw.position ?? { x: 0, y: 0 },
          rotation: raw.rotation ?? 0,
          xScale: raw.xScale ?? 1,
          yScale: raw.yScale ?? 1,
        };
        return insert;
      }

      default:
        return { ...base };
    }
  } catch {
    return { ...base };
  }
}

// ---------------------------------------------------------------------------
// Bounding box aggregation
// ---------------------------------------------------------------------------

function aggregateBoundingBox(
  entities: CadEntity[]
): CadBoundingBox | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let hasAny = false;

  for (const e of entities) {
    const bb = e.boundingBox;
    if (!bb) continue;
    if (bb.minX < minX) minX = bb.minX;
    if (bb.minY < minY) minY = bb.minY;
    if (bb.maxX > maxX) maxX = bb.maxX;
    if (bb.maxY > maxY) maxY = bb.maxY;
    hasAny = true;
  }

  if (!hasAny || !isFinite(minX)) return null;
  return makeBBox(minX, minY, maxX, maxY);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseDxfFile(
  file: File,
  drawingId: string
): Promise<ParsedDxfDrawing> {
  if (file.size > CLIENT_SIZE_LIMIT_BYTES) {
    throw new Error(
      `DXF file is ${(file.size / 1024 / 1024).toFixed(0)} MB — files over 100 MB require backend processing.`
    );
  }

  const text = await file.text();
  if (!text || text.trim().length === 0) {
    throw new Error("File appears to be empty.");
  }

  // Dynamic import keeps dxf-parser out of the initial bundle
  const { default: DxfParser } = await import("dxf-parser");
  const parser = new DxfParser();

  let dxf;
  try {
    dxf = parser.parseSync(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`DXF parsing failed: ${msg}`);
  }

  if (!dxf) {
    throw new Error("DXF parser returned no output. The file may be corrupt or unsupported.");
  }

  // ---- Layers ------------------------------------------------------------
  const rawLayers = dxf.tables?.layer?.layers ?? {};
  const layers: CadLayer[] = Object.values(rawLayers).map((l) => ({
    name: l.name,
    visible: l.visible !== false,
    frozen: l.frozen ?? false,
    colorIndex: l.colorIndex ?? 7,
    color: l.color ?? 0xffffff,
    entityCount: 0, // filled below
  }));
  const layerMap = new Map<string, CadLayer>(layers.map((l) => [l.name, l]));

  // ---- Entities ----------------------------------------------------------
  const rawEntities: unknown[] = dxf.entities ?? [];
  const entities: CadEntity[] = [];

  for (const raw of rawEntities) {
    const e = mapEntity(raw);
    if (!e) continue;
    entities.push(e);
    const layer = layerMap.get(e.layer);
    if (layer) layer.entityCount++;
    else {
      // Layer referenced but not declared — add it on the fly
      const phantom: CadLayer = {
        name: e.layer,
        visible: true,
        frozen: false,
        colorIndex: 7,
        color: 0xffffff,
        entityCount: 1,
      };
      layers.push(phantom);
      layerMap.set(e.layer, phantom);
    }
  }

  // ---- Blocks ------------------------------------------------------------
  const rawBlocks = dxf.blocks ?? {};
  const blocks: CadBlock[] = Object.values(rawBlocks)
    .filter((b) => !b.name.startsWith("*")) // skip AutoCAD model/paper space
    .map((b) => ({
      name: b.name,
      layer: b.layer ?? "0",
      position: b.position ?? { x: 0, y: 0 },
      entityCount: (b.entities ?? []).length,
    }));

  // ---- Counts by type ----------------------------------------------------
  const entityCountByType: Record<string, number> = {};
  for (const e of entities) {
    entityCountByType[e.type] = (entityCountByType[e.type] ?? 0) + 1;
  }

  // ---- Text labels -------------------------------------------------------
  const textSet = new Set<string>();
  for (const e of entities) {
    if (e.type === "TEXT" || e.type === "MTEXT") {
      const t = (e as CadText).text;
      if (t && t.length > 0 && t.length < 256) textSet.add(t);
    }
  }

  // ---- Referenced block names --------------------------------------------
  const refBlockSet = new Set<string>();
  for (const e of entities) {
    if (e.type === "INSERT") {
      const bn = (e as CadInsert).blockName;
      if (bn) refBlockSet.add(bn);
    }
  }

  // ---- Drawing units ($INSUNITS) ----------------------------------------
  const unitsCode =
    typeof dxf.header?.["$INSUNITS"] === "number"
      ? (dxf.header["$INSUNITS"] as number)
      : 0;
  const units = DXF_UNIT_LABELS[unitsCode] ?? "Unknown";

  // ---- Bounding box ------------------------------------------------------
  const boundingBox = aggregateBoundingBox(entities);

  return {
    drawingId,
    fileName: file.name,
    fileSize: file.size,
    units,
    unitsCode,
    layers,
    entities,
    blocks,
    entityCountByType,
    textLabels: Array.from(textSet).slice(0, 500),
    referencedBlockNames: Array.from(refBlockSet).sort(),
    definedBlockNames: blocks.map((b) => b.name).sort(),
    boundingBox,
    totalEntityCount: entities.length,
    insertCount: entityCountByType["INSERT"] ?? 0,
    layerCount: layers.length,
  };
}
