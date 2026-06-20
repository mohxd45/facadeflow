/**
 * DXF Viewer Utilities — Phase 15A
 *
 * Bounding-box helpers and coordinate transforms used by the DXF visual
 * review viewer to implement zoom-to-layer and fit-to-drawing.
 */

import type { CadEntity, CadBoundingBox, ParsedDxfDrawing } from "@/types/cad";
import type {
  CadLine,
  CadPolyline,
  CadCircle,
  CadArc,
  CadText,
  CadInsert,
} from "@/types/cad";

// ---------------------------------------------------------------------------
// ViewerTransform — the current pan/zoom state of the viewer
// ---------------------------------------------------------------------------

export interface ViewerTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

export const DEFAULT_TRANSFORM: ViewerTransform = {
  scale: 1,
  translateX: 0,
  translateY: 0,
};

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 50;

export function clampScale(s: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s));
}

// ---------------------------------------------------------------------------
// SvgTransform — how the renderer mapped DXF coords → SVG canvas coords
// (exported from dxf-svg-renderer.service so we can invert it here)
// ---------------------------------------------------------------------------

export interface SvgRenderTransform {
  /** DXF minX used as origin */
  minX: number;
  /** DXF maxY used as origin (because Y is flipped) */
  maxY: number;
  /** Drawing-unit → pixel scale factor applied by the renderer */
  scale: number;
  /** Pixel padding added around the drawing */
  padding: number;
}

// ---------------------------------------------------------------------------
// Bounding box helpers
// ---------------------------------------------------------------------------

function mergeBBox(
  acc: { minX: number; minY: number; maxX: number; maxY: number } | null,
  points: Array<{ x: number; y: number }>
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  for (const { x, y } of points) {
    if (!isFinite(x) || !isFinite(y)) continue;
    if (acc === null) {
      acc = { minX: x, minY: y, maxX: x, maxY: y };
    } else {
      if (x < acc.minX) acc.minX = x;
      if (y < acc.minY) acc.minY = y;
      if (x > acc.maxX) acc.maxX = x;
      if (y > acc.maxY) acc.maxY = y;
    }
  }
  return acc;
}

/** Extract representative sample points from a CAD entity. */
function entitySamplePoints(e: CadEntity): Array<{ x: number; y: number }> {
  // Use pre-computed bounding box when available
  if (e.boundingBox) {
    return [
      { x: e.boundingBox.minX, y: e.boundingBox.minY },
      { x: e.boundingBox.maxX, y: e.boundingBox.maxY },
    ];
  }
  switch (e.type) {
    case "LINE": {
      const l = e as CadLine;
      return [l.start, l.end];
    }
    case "POLYLINE":
    case "LWPOLYLINE": {
      const pl = e as CadPolyline;
      return pl.vertices.length > 0 ? pl.vertices : [];
    }
    case "CIRCLE": {
      const c = e as CadCircle;
      return [
        { x: c.center.x - c.radius, y: c.center.y - c.radius },
        { x: c.center.x + c.radius, y: c.center.y + c.radius },
      ];
    }
    case "ARC": {
      const a = e as CadArc;
      // Conservative bbox: full circle extent
      return [
        { x: a.center.x - a.radius, y: a.center.y - a.radius },
        { x: a.center.x + a.radius, y: a.center.y + a.radius },
      ];
    }
    case "TEXT":
    case "MTEXT": {
      const t = e as CadText;
      return [t.position];
    }
    case "INSERT": {
      const ins = e as CadInsert;
      return [ins.position];
    }
    default:
      return [];
  }
}

/**
 * Compute the bounding box of a collection of entities.
 * Returns null if no finite coordinates are found.
 */
export function getEntitiesBoundingBox(
  entities: CadEntity[]
): CadBoundingBox | null {
  let acc: { minX: number; minY: number; maxX: number; maxY: number } | null =
    null;
  for (const e of entities) {
    acc = mergeBBox(acc, entitySamplePoints(e));
  }
  if (!acc) return null;
  return {
    ...acc,
    width: acc.maxX - acc.minX,
    height: acc.maxY - acc.minY,
  };
}

/**
 * Compute the bounding box of all entities on a specific layer.
 */
export function getLayerBoundingBox(
  parsed: ParsedDxfDrawing,
  layerName: string
): CadBoundingBox | null {
  const entities = parsed.entities.filter((e) => e.layer === layerName);
  return getEntitiesBoundingBox(entities);
}

/**
 * Expand a bounding box by a fraction of its size in all directions.
 * paddingRatio = 0.1 adds 10% on each side.
 */
export function expandBoundingBox(
  bbox: CadBoundingBox,
  paddingRatio: number
): CadBoundingBox {
  const px = bbox.width * paddingRatio;
  const py = bbox.height * paddingRatio;
  const minSide = Math.min(bbox.width, bbox.height);
  const minPad = minSide * 0.05; // ensure at least 5% padding even for thin lines
  const padX = Math.max(px, minPad);
  const padY = Math.max(py, minPad);
  const minX = bbox.minX - padX;
  const minY = bbox.minY - padY;
  const maxX = bbox.maxX + padX;
  const maxY = bbox.maxY + padY;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Coordinate conversion: DXF bbox → SVG canvas bbox
// ---------------------------------------------------------------------------

/**
 * Convert a DXF-space bounding box to SVG canvas coordinates using the
 * same transform the renderer applied when generating the SVG.
 *
 * Renderer formula:
 *   svgX = (dxfX - minX) * scale + padding
 *   svgY = (maxY - dxfY) * scale + padding   ← Y is flipped
 */
export function dxfBboxToSvgBbox(
  dxfBbox: CadBoundingBox,
  t: SvgRenderTransform
): CadBoundingBox {
  const svgMinX = (dxfBbox.minX - t.minX) * t.scale + t.padding;
  const svgMinY = (t.maxY - dxfBbox.maxY) * t.scale + t.padding;
  const svgMaxX = (dxfBbox.maxX - t.minX) * t.scale + t.padding;
  const svgMaxY = (t.maxY - dxfBbox.minY) * t.scale + t.padding;
  return {
    minX: Math.min(svgMinX, svgMaxX),
    minY: Math.min(svgMinY, svgMaxY),
    maxX: Math.max(svgMinX, svgMaxX),
    maxY: Math.max(svgMinY, svgMaxY),
    width: Math.abs(svgMaxX - svgMinX),
    height: Math.abs(svgMaxY - svgMinY),
  };
}

// ---------------------------------------------------------------------------
// Fit a bbox into the viewport → ViewerTransform
// ---------------------------------------------------------------------------

/**
 * Calculate the ViewerTransform needed to fit `bbox` (in SVG canvas coords)
 * into a viewport of `viewportW × viewportH` pixels, centered with padding.
 */
export function bboxToViewTransform(
  bbox: CadBoundingBox,
  viewportW: number,
  viewportH: number,
  paddingFraction = 0.1
): ViewerTransform {
  if (bbox.width < 1 || bbox.height < 1 || viewportW < 1 || viewportH < 1) {
    return DEFAULT_TRANSFORM;
  }
  const availW = viewportW * (1 - paddingFraction * 2);
  const availH = viewportH * (1 - paddingFraction * 2);
  const scale = clampScale(Math.min(availW / bbox.width, availH / bbox.height));
  const translateX = (viewportW - bbox.width * scale) / 2 - bbox.minX * scale;
  const translateY = (viewportH - bbox.height * scale) / 2 - bbox.minY * scale;
  return { scale, translateX, translateY };
}
