/**
 * DXF → SVG Renderer Service — Phase 7
 *
 * Converts a ParsedDxfDrawing into an SVG string that can be injected into
 * a React component via dangerouslySetInnerHTML.
 *
 * Design decisions:
 * - Y-axis is flipped (DXF Y-up → SVG Y-down).
 * - Coordinates are scaled to fit a MAX_W × MAX_H viewport.
 * - Arc entities are approximated with polyline segments (avoids SVG arc flag
 *   complexity after Y-flip).
 * - Text entities are rendered only when showText = true (can be slow for
 *   dense annotation layers).
 * - INSERT entities render as cross markers (block geometry is not inlined).
 * - Layers are wrapped in <g class="l-{id}" data-layer="{name}"> so the
 *   parent component can toggle visibility / highlight via CSS injection.
 * - If total entities > ENTITY_WARNING_THRESHOLD, per-layer count is capped
 *   at ENTITY_CAP_PER_LAYER to prevent browser hangs.
 */

import type {
  ParsedDxfDrawing,
  CadEntity,
  CadLine,
  CadPolyline,
  CadCircle,
  CadArc,
  CadText,
  CadInsert,
} from "@/types/cad";
import type { SvgRenderTransform } from "@/services/dxf/dxf-viewer-utils";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DxfRenderOptions {
  highlightedLayers?: string[];
  highlightedEntityIds?: string[];
  hiddenLayers?: string[];
  showText?: boolean;
  showBoundingBox?: boolean;
}

export interface RenderedSvgElement {
  id: string;
  entityId: string;
  layer: string;
  type: string;
  /** Serialised SVG snippet for this element */
  svgPathOrElement: string;
  isHighlighted: boolean;
}

export interface DxfSvgRenderResult {
  svgViewBox: string;
  /** Inner SVG content — inject via dangerouslySetInnerHTML */
  svgContent: string;
  /** Flat element list (for programmatic access) */
  elements: RenderedSvgElement[];
  width: number;
  height: number;
  scale: number;
  /** true when entity count exceeded threshold and some entities were omitted */
  isSimplified: boolean;
  entityCount: number;
  /**
   * The transform parameters the renderer used to convert DXF coords → SVG
   * canvas coords. Needed by the viewer to implement fit-to-layer.
   */
  svgTransform: SvgRenderTransform;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_W = 1400;
const MAX_H = 900;
const PADDING = 30;
const ENTITY_WARNING_THRESHOLD = 10_000;
const ENTITY_CAP_PER_LAYER = 3_000;

// ---------------------------------------------------------------------------
// ACI (AutoCAD Color Index) → hex  (palette for dark background)
// ---------------------------------------------------------------------------

const ACI_COLORS: Record<number, string> = {
  1: "#ff6b6b", // red
  2: "#ffd93d", // yellow
  3: "#6bcb77", // green
  4: "#4ecdc4", // cyan
  5: "#4d96ff", // blue
  6: "#c77dff", // magenta
  7: "#d0d0d0", // white → light grey
};

function aciColor(colorIndex: number): string {
  return ACI_COLORS[colorIndex] ?? "#888888";
}

// ---------------------------------------------------------------------------
// CSS-safe identifier for layer names
// ---------------------------------------------------------------------------

export function layerCssId(layerName: string): string {
  // Prefix with 'L' so names starting with digits are still valid CSS identifiers
  return "L" + layerName.replace(/[^a-zA-Z0-9]/g, "_");
}

// ---------------------------------------------------------------------------
// Coordinate transform (DXF → SVG with Y-flip)
// ---------------------------------------------------------------------------

interface Transform {
  minX: number;
  maxY: number;
  scale: number;
  padding: number;
}

function tx(x: number, y: number, t: Transform): [number, number] {
  return [
    (x - t.minX) * t.scale + t.padding,
    (t.maxY - y) * t.scale + t.padding,
  ];
}

function fmt(n: number): string {
  return n.toFixed(2);
}

// ---------------------------------------------------------------------------
// Per-entity SVG renderers
// ---------------------------------------------------------------------------

function renderLine(e: CadLine, t: Transform): string {
  const [x1, y1] = tx(e.start.x, e.start.y, t);
  const [x2, y2] = tx(e.end.x, e.end.y, t);
  return `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"/>`;
}

function renderPolyline(e: CadPolyline, t: Transform): string {
  if (e.vertices.length < 2) return "";
  const pts = e.vertices
    .map((v) => {
      const [sx, sy] = tx(v.x, v.y, t);
      return `${fmt(sx)},${fmt(sy)}`;
    })
    .join(" ");
  return e.closed
    ? `<polygon points="${pts}"/>`
    : `<polyline points="${pts}"/>`;
}

function renderCircle(e: CadCircle, t: Transform): string {
  const [cx, cy] = tx(e.center.x, e.center.y, t);
  const r = e.radius * t.scale;
  return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}"/>`;
}

function renderArc(e: CadArc, t: Transform): string {
  // Approximate with polyline — avoids complex SVG arc flags after Y-flip
  let span = e.endAngle - e.startAngle;
  if (span <= 0) span += 360;
  const steps = Math.max(8, Math.ceil(Math.abs(span) / 5));
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const angleDeg = e.startAngle + (i / steps) * span;
    const angleRad = (angleDeg * Math.PI) / 180;
    const px = e.center.x + e.radius * Math.cos(angleRad);
    const py = e.center.y + e.radius * Math.sin(angleRad);
    const [sx, sy] = tx(px, py, t);
    pts.push(`${fmt(sx)},${fmt(sy)}`);
  }
  return `<polyline points="${pts.join(" ")}"/>`;
}

const UNSAFE_XML = /[&<>"']/g;
const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escXml(s: string): string {
  return s.replace(UNSAFE_XML, (c) => XML_ESCAPES[c] ?? c);
}

function renderText(e: CadText, t: Transform): string {
  if (!e.text?.trim()) return "";
  const [x, y] = tx(e.position.x, e.position.y, t);
  const fs = Math.max(2, Math.min((e.height ?? 10) * t.scale * 0.8, 18));
  return `<text x="${fmt(x)}" y="${fmt(y)}" font-size="${fmt(fs)}" font-family="monospace">${escXml(e.text)}</text>`;
}

function renderInsert(e: CadInsert, t: Transform): string {
  const [cx, cy] = tx(e.position.x, e.position.y, t);
  const s = Math.max(3, Math.min(6 * t.scale, 8));
  // Small cross marker
  return (
    `<line x1="${fmt(cx - s)}" y1="${fmt(cy)}" x2="${fmt(cx + s)}" y2="${fmt(cy)}"/>` +
    `<line x1="${fmt(cx)}" y1="${fmt(cy - s)}" x2="${fmt(cx)}" y2="${fmt(cy + s)}"/>`
  );
}

function entityToSvg(e: CadEntity, t: Transform, showText: boolean): string {
  switch (e.type) {
    case "LINE":
      return renderLine(e as CadLine, t);
    case "LWPOLYLINE":
    case "POLYLINE":
      return renderPolyline(e as CadPolyline, t);
    case "CIRCLE":
      return renderCircle(e as CadCircle, t);
    case "ARC":
      return renderArc(e as CadArc, t);
    case "TEXT":
    case "MTEXT":
      return showText ? renderText(e as CadText, t) : "";
    case "INSERT":
      return renderInsert(e as CadInsert, t);
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export function renderDxfToSvg(
  parsed: ParsedDxfDrawing,
  options: DxfRenderOptions = {}
): DxfSvgRenderResult {
  const { showText = false, showBoundingBox = false } = options;

  const bb = parsed.boundingBox;
  const minX = bb?.minX ?? 0;
  const minY = bb?.minY ?? 0;
  const maxX = bb?.maxX ?? 100;
  const maxY = bb?.maxY ?? 100;
  const dxfW = Math.max(maxX - minX, 1);
  const dxfH = Math.max(maxY - minY, 1);

  const scale = Math.min(
    (MAX_W - 2 * PADDING) / dxfW,
    (MAX_H - 2 * PADDING) / dxfH
  );

  const svgW = dxfW * scale + 2 * PADDING;
  const svgH = dxfH * scale + 2 * PADDING;

  const t: Transform = { minX, maxY, scale, padding: PADDING };

  // Group by layer
  const byLayer = new Map<string, CadEntity[]>();
  for (const e of parsed.entities) {
    const a = byLayer.get(e.layer);
    if (a) a.push(e);
    else byLayer.set(e.layer, [e]);
  }

  const isSimplified = parsed.totalEntityCount > ENTITY_WARNING_THRESHOLD;
  const allElements: RenderedSvgElement[] = [];
  let svgContent = "";

  for (const [layerName, entities] of byLayer) {
    const layer = parsed.layers.find((l) => l.name === layerName);
    const color = layer ? aciColor(layer.colorIndex) : "#888888";
    const cssId = layerCssId(layerName);

    const batch = isSimplified
      ? entities.slice(0, ENTITY_CAP_PER_LAYER)
      : entities;

    let groupBody = "";
    for (const e of batch) {
      const svg = entityToSvg(e, t, showText);
      if (!svg) continue;
      groupBody += svg + "\n";
      allElements.push({
        id: `el-${e.id}`,
        entityId: e.id,
        layer: layerName,
        type: e.type,
        svgPathOrElement: svg,
        isHighlighted: (options.highlightedLayers ?? []).includes(layerName),
      });
    }

    if (groupBody) {
      svgContent +=
        `<g class="${cssId}" data-layer="${escXml(layerName)}" ` +
        `stroke="${color}" stroke-width="1" fill="none" ` +
        `vector-effect="non-scaling-stroke">\n` +
        groupBody +
        `</g>\n`;
    }
  }

  // Optional bounding-box outline
  if (showBoundingBox && bb) {
    const [bx1, by1] = tx(bb.minX, bb.minY, t);
    const [bx2, by2] = tx(bb.maxX, bb.maxY, t);
    const bxMin = Math.min(bx1, bx2);
    const byMin = Math.min(by1, by2);
    svgContent +=
      `<rect x="${fmt(bxMin)}" y="${fmt(byMin)}" ` +
      `width="${fmt(Math.abs(bx2 - bx1))}" height="${fmt(Math.abs(by2 - by1))}" ` +
      `fill="none" stroke="#555" stroke-width="0.5" stroke-dasharray="6,4"/>`;
  }

  return {
    svgViewBox: `0 0 ${fmt(svgW)} ${fmt(svgH)}`,
    svgContent,
    elements: allElements,
    width: svgW,
    height: svgH,
    scale,
    isSimplified,
    entityCount: parsed.totalEntityCount,
    svgTransform: { minX, maxY, scale, padding: PADDING },
  };
}

// ---------------------------------------------------------------------------
// CSS helpers for dynamic layer control
// (called by the modal to build the injected <style> block)
// ---------------------------------------------------------------------------

/**
 * Returns a CSS string (no `<style>` wrapper) for:
 * - Hiding layers in `hiddenLayers`
 * - Dimming all layers when `highlightedLayers` is non-empty
 * - Restoring highlighted layers with thicker, brighter strokes
 *
 * Use this with a React `<style>` element inside the SVG for the zoom/pan viewer.
 */
export function buildLayerStyleCSS(
  hiddenLayers: Set<string>,
  highlightedLayers: string[]
): string {
  const rules: string[] = [];

  for (const name of hiddenLayers) {
    rules.push(`.${layerCssId(name)} { display: none !important; }`);
  }

  if (highlightedLayers.length > 0) {
    // Dim everything
    rules.push(`g[data-layer] { opacity: 0.12; }`);
    for (const name of highlightedLayers) {
      const id = layerCssId(name);
      rules.push(
        `.${id} { opacity: 1 !important; }`,
        `.${id} line, .${id} polyline, .${id} polygon, .${id} circle, .${id} text {`,
        `  stroke: #FF9500 !important;`,
        `  stroke-width: 2.5px !important;`,
        `  filter: drop-shadow(0 0 3px rgba(255,149,0,0.7));`,
        `}`
      );
    }
  }

  return rules.join("\n");
}

/**
 * Legacy wrapper — builds a `<style>` snippet injected via dangerouslySetInnerHTML.
 * @deprecated Use buildLayerStyleCSS with a React <style> element instead.
 */
export function buildLayerStyle(
  hiddenLayers: Set<string>,
  highlightedLayers: string[]
): string {
  const css = buildLayerStyleCSS(hiddenLayers, highlightedLayers);
  return css ? `<style>\n${css}\n</style>\n` : "";
}
