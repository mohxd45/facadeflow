"use client";

/**
 * DXF Visual Review Modal — Phase 15A + 15B
 *
 * THREE COORDINATE SYSTEMS (see viewer-adapter.ts for full docs):
 *
 *  1. DXF world coords   — original CAD units, Y-up
 *  2. SVG canvas coords  — renderer output, Y-down, scaled to ~1400×900
 *  3. Screen/viewer coords — browser pixels after ViewerTransform (CSS transform)
 *
 * Performance:
 *  - InnerSvgContent is React.memo → never re-renders during pan/zoom.
 *  - ViewerTransform applied via g.style.transform (direct DOM, zero React renders).
 *  - Only displayZoom, layerSvgBbox, and diagnostics trigger React state updates.
 */

import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  memo,
} from "react";
import type { CadBoundingBox, ParsedDxfDrawing } from "@/types/cad";
import type { DrawingFile } from "@/types/drawing";
import { useLayerMappingStore } from "@/stores/layer-mapping-store";
import { TAKEOFF_CATEGORY_LABELS } from "@/lib/constants";
import {
  renderDxfToSvg,
  buildLayerStyleCSS,
} from "@/services/dxf/dxf-svg-renderer.service";
import {
  getLayerBoundingBox,
  expandBoundingBox,
  dxfBboxToSvgBbox,
  bboxToViewTransform,
  clampScale,
  MIN_ZOOM,
  MAX_ZOOM,
} from "@/services/dxf/dxf-viewer-utils";
import type { ViewerTransform } from "@/services/dxf/dxf-viewer-utils";
import { openDrawingExternally } from "@/services/dxf/viewer-adapter";
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
  Eye,
  EyeOff,
  Layers,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Crosshair,
  RotateCcw,
  X,
  Download,
  Activity,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DxfVisualReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parsed: ParsedDxfDrawing;
  drawing: DrawingFile;
  projectId: string;
  /** Layers to highlight and zoom-to when the modal first opens */
  initialHighlightedLayers?: string[];
}

// ---------------------------------------------------------------------------
// ACI colour swatch
// ---------------------------------------------------------------------------

const ACI_HEX: Record<number, string> = {
  1: "#ff6b6b",
  2: "#ffd93d",
  3: "#6bcb77",
  4: "#4ecdc4",
  5: "#4d96ff",
  6: "#c77dff",
  7: "#d0d0d0",
};
function aciHex(ci: number): string {
  return ACI_HEX[ci] ?? "#888888";
}

// ---------------------------------------------------------------------------
// Memoised SVG body — never re-renders during pan/zoom
// ---------------------------------------------------------------------------

const InnerSvgContent = memo(function InnerSvgContent({
  html,
}: {
  html: string;
}) {
  return <g dangerouslySetInnerHTML={{ __html: html }} />;
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZOOM_FACTOR = 1.25;

/**
 * Return true if the layer bbox is suspiciously large relative to the drawing.
 * Indicates stray geometry, bad blocks, or incorrectly merged layers.
 */
function isBboxAbnormal(
  layerBbox: CadBoundingBox,
  drawingBbox: CadBoundingBox | null | undefined
): boolean {
  // Absolute: > 1,000,000 drawing units in any dimension
  if (layerBbox.width > 1_000_000 || layerBbox.height > 1_000_000) return true;
  if (!drawingBbox) return false;
  const dSize = Math.max(drawingBbox.width, drawingBbox.height, 1);
  const lSize = Math.max(layerBbox.width, layerBbox.height);
  // Relative: > 5× the full drawing extent
  return lSize > dSize * 5;
}

// ---------------------------------------------------------------------------
// Helper: format a bounding box for display
// ---------------------------------------------------------------------------

function fmtBbox(b: CadBoundingBox | null | undefined): string {
  if (!b) return "—";
  return `${b.width.toFixed(0)} × ${b.height.toFixed(0)}  (${b.minX.toFixed(0)}, ${b.minY.toFixed(0)})`;
}

function fmtN(n: number, dp = 2): string {
  return isFinite(n) ? n.toFixed(dp) : "—";
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DxfVisualReviewModal({
  open,
  onOpenChange,
  parsed,
  drawing,
  projectId,
  initialHighlightedLayers = [],
}: DxfVisualReviewModalProps) {
  // ── Store ────────────────────────────────────────────────────────────────
  const allMappings = useLayerMappingStore((s) => s.mappings);
  const mappingByLayer = useMemo(
    () =>
      new Map(
        allMappings
          .filter((m) => m.projectId === projectId)
          .map((m) => [m.layerName, m])
      ),
    [allMappings, projectId]
  );

  // ── Layer visibility / selection ─────────────────────────────────────────
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [highlightedLayers, setHighlightedLayers] = useState<string[]>(
    initialHighlightedLayers
  );
  const [selectedLayer, setSelectedLayer] = useState<string | null>(
    initialHighlightedLayers[0] ?? null
  );
  const [showText, setShowText] = useState(false);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [displayZoom, setDisplayZoom] = useState(100);
  const [isDragging, setIsDragging] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [fitError, setFitError] = useState<string | null>(null);
  const [openingFile, setOpeningFile] = useState(false);
  const [openFileError, setOpenFileError] = useState<string | null>(null);

  // ── Layer bbox state (SVG canvas coords + DXF coords) ───────────────────
  const [layerDxfBbox, setLayerDxfBbox] = useState<CadBoundingBox | null>(null);
  const [layerSvgBbox, setLayerSvgBbox] = useState<CadBoundingBox | null>(null);

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const rootGroupRef = useRef<SVGGElement>(null);

  // ── ViewerTransform stored in a ref — zero React re-renders on drag/zoom ─
  // Screen coords: screenX = svgX * scale + translateX
  const transformRef = useRef<ViewerTransform>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const dragBaseRef = useRef<ViewerTransform>({ scale: 1, translateX: 0, translateY: 0 });

  // ── Stable refs so callbacks don't need deps on mutable values ───────────
  const renderResultRef = useRef<ReturnType<typeof renderDxfToSvg> | null>(null);
  const parsedRef = useRef<ParsedDxfDrawing>(parsed);
  useEffect(() => { parsedRef.current = parsed; }, [parsed]);

  // ── SVG render (only re-computes when parsed / showText changes) ─────────
  const renderResult = useMemo(
    () => renderDxfToSvg(parsed, { showText }),
    [parsed, showText]
  );
  useEffect(() => { renderResultRef.current = renderResult; }, [renderResult]);

  // ── CSS for layer visibility + highlight ─────────────────────────────────
  const cssRules = useMemo(
    () => buildLayerStyleCSS(hiddenLayers, highlightedLayers),
    [hiddenLayers, highlightedLayers]
  );

  // ── Recompute layer bbox whenever selection changes ───────────────────────
  useEffect(() => {
    if (!selectedLayer || !renderResultRef.current) {
      setLayerDxfBbox(null);
      setLayerSvgBbox(null);
      return;
    }
    const dxfBbox = getLayerBoundingBox(parsedRef.current, selectedLayer);
    setLayerDxfBbox(dxfBbox);
    if (dxfBbox) {
      setLayerSvgBbox(
        dxfBboxToSvgBbox(dxfBbox, renderResultRef.current.svgTransform)
      );
    } else {
      setLayerSvgBbox(null);
    }
  }, [selectedLayer]);

  // ── Derived: does selected layer contain INSERT entities? ─────────────────
  const selectedLayerHasInserts = useMemo(() => {
    if (!selectedLayer) return false;
    return parsed.entities.some(
      (e) => e.layer === selectedLayer && e.type === "INSERT"
    );
  }, [selectedLayer, parsed.entities]);

  // ── Derived: is selected layer bbox abnormal? ────────────────────────────
  const abnormalBbox = useMemo(
    () => layerDxfBbox ? isBboxAbnormal(layerDxfBbox, parsed.boundingBox) : false,
    [layerDxfBbox, parsed.boundingBox]
  );

  // ── Apply transform via direct DOM — zero React re-renders ───────────────
  //
  // The CSS transform translates SVG canvas coords to screen coords:
  //   screenX = svgX * scale + translateX
  //   screenY = svgY * scale + translateY
  //
  const applyTransform = useCallback(
    (t: ViewerTransform, animate = false) => {
      transformRef.current = t;
      const g = rootGroupRef.current;
      if (g) {
        if (animate) {
          g.style.transition =
            "transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
          setTimeout(() => {
            if (rootGroupRef.current)
              rootGroupRef.current.style.transition = "none";
          }, 400);
        } else {
          g.style.transition = "none";
        }
        // transformOrigin "0 0" means scale origin is the SVG canvas origin (top-left)
        g.style.transform = `translate(${t.translateX.toFixed(2)}px,${t.translateY.toFixed(2)}px) scale(${t.scale.toFixed(6)})`;
        g.style.transformOrigin = "0 0";
      }
      setDisplayZoom(Math.round(t.scale * 100));
    },
    []
  );

  // ── Fit the full drawing into the viewport ────────────────────────────────
  //
  // Converts SVG canvas dimensions → ViewerTransform so the drawing fills
  // ~92% of the available screen area, centred.
  //
  const fitToDrawing = useCallback(
    (animate = false) => {
      const svg = svgRef.current;
      const result = renderResultRef.current;
      if (!svg || !result) return;
      // Screen viewport dimensions in CSS px
      const vw = svg.clientWidth;
      const vh = svg.clientHeight;
      if (vw < 1 || vh < 1) return;
      // Compute scale so the SVG canvas (result.width × result.height) fits
      const scale = clampScale(
        Math.min(vw / result.width, vh / result.height) * 0.92
      );
      // Centre the scaled canvas in the viewport
      const translateX = (vw - result.width * scale) / 2;
      const translateY = (vh - result.height * scale) / 2;
      applyTransform({ scale, translateX, translateY }, animate);
    },
    [applyTransform]
  );

  // ── Zoom to a specific DXF layer ─────────────────────────────────────────
  //
  // Coordinate chain:
  //   DXF bbox → expand → SVG canvas bbox → ViewerTransform
  //
  const fitToLayer = useCallback(
    (layerName: string) => {
      setFitError(null);
      try {
        const svg = svgRef.current;
        const result = renderResultRef.current;
        const p = parsedRef.current;
        if (!svg || !result) {
          setFitError("Viewer not ready. Try again in a moment.");
          return;
        }
        // 1. DXF world coords → DXF layer bbox
        const dxfBbox = getLayerBoundingBox(p, layerName);
        if (!dxfBbox) {
          setFitError(
            `No geometry found on layer "${layerName}". Keeping current view.`
          );
          return;
        }
        // 2. Expand with 15% padding in DXF space
        const expanded = expandBoundingBox(dxfBbox, 0.15);
        // 3. Convert DXF bbox → SVG canvas bbox (accounts for Y-flip + scale + padding)
        const svgBbox = dxfBboxToSvgBbox(expanded, result.svgTransform);
        // 4. Convert SVG canvas bbox → ViewerTransform (screen pixels)
        const vw = svg.clientWidth;
        const vh = svg.clientHeight;
        if (vw < 1 || vh < 1) {
          setFitError("Viewport has zero size. Try resizing the window.");
          return;
        }
        applyTransform(bboxToViewTransform(svgBbox, vw, vh), true);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown error during fit.";
        setFitError(`Zoom to layer failed: ${msg}. Current view preserved.`);
      }
    },
    [applyTransform]
  );

  // ── Initial fit when modal opens ─────────────────────────────────────────
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const timer = setTimeout(() => {
        if (initialHighlightedLayers.length > 0) {
          fitToLayer(initialHighlightedLayers[0]);
        } else {
          fitToDrawing(false);
        }
      }, 120);
      return () => clearTimeout(timer);
    }
    prevOpenRef.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refit when renderResult changes (e.g. showText toggled)
  useEffect(() => {
    if (!open) return;
    fitToDrawing(true);
  }, [renderResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Non-passive wheel → zoom centred on cursor ───────────────────────────
  //
  // Zoom formula (centred on mouse):
  //   newTranslateX = mouseX - (mouseX - translateX) * (newScale / scale)
  //
  // Derivation: the SVG point under the mouse must remain at the same screen
  // position after scaling. svgPoint = (mouseX - translateX) / scale.
  // After: newTranslateX = mouseX - svgPoint * newScale
  //
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      // Screen coords of mouse relative to SVG element top-left
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const { scale, translateX, translateY } = transformRef.current;
      const newScale = clampScale(scale * factor);
      const ratio = newScale / scale;
      applyTransform({
        scale: newScale,
        translateX: mouseX - (mouseX - translateX) * ratio,
        translateY: mouseY - (mouseY - translateY) * ratio,
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [applyTransform]);

  // ── Keyboard: Escape clears selection ────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedLayer(null);
        setHighlightedLayers([]);
        setFitError(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // ── Pan via left-drag ─────────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      dragBaseRef.current = { ...transformRef.current };
      setIsDragging(true);
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      applyTransform({
        scale: dragBaseRef.current.scale,
        translateX: dragBaseRef.current.translateX + dx,
        translateY: dragBaseRef.current.translateY + dy,
      });
    },
    [applyTransform]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  // ── Click on SVG geometry → select/deselect layer ───────────────────────
  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      // Ignore if this was the end of a pan (moved > 4px)
      const dx = Math.abs(e.clientX - dragStartRef.current.x);
      const dy = Math.abs(e.clientY - dragStartRef.current.y);
      if (dx > 4 || dy > 4) return;

      const g = (e.target as Element).closest("[data-layer]");
      if (g) {
        const name = g.getAttribute("data-layer") ?? null;
        if (name) {
          setSelectedLayer((prev) => {
            const next = prev === name ? null : name;
            setHighlightedLayers(next ? [next] : []);
            return next;
          });
        }
      } else {
        setSelectedLayer(null);
        setHighlightedLayers([]);
      }
    },
    []
  );

  // ── Layer sidebar actions ─────────────────────────────────────────────────
  const toggleHidden = useCallback((name: string) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleLayerClick = useCallback((name: string) => {
    setFitError(null);
    setSelectedLayer((prev) => {
      const next = prev === name ? null : name;
      setHighlightedLayers(next ? [next] : []);
      return next;
    });
  }, []);

  const handleLayerDoubleClick = useCallback(
    (name: string) => {
      setFitError(null);
      setSelectedLayer(name);
      setHighlightedLayers([name]);
      fitToLayer(name);
    },
    [fitToLayer]
  );

  // ── Toolbar zoom helpers ──────────────────────────────────────────────────
  const zoomStep = useCallback(
    (direction: 1 | -1) => {
      const svg = svgRef.current;
      if (!svg) return;
      const { scale, translateX, translateY } = transformRef.current;
      const newScale = clampScale(
        direction > 0 ? scale * ZOOM_FACTOR : scale / ZOOM_FACTOR
      );
      const cx = svg.clientWidth / 2;
      const cy = svg.clientHeight / 2;
      const ratio = newScale / scale;
      applyTransform({
        scale: newScale,
        translateX: cx - (cx - translateX) * ratio,
        translateY: cy - (cy - translateY) * ratio,
      });
    },
    [applyTransform]
  );

  const clearHighlight = useCallback(() => {
    setSelectedLayer(null);
    setHighlightedLayers([]);
    setFitError(null);
  }, []);

  // ── Open original file in external CAD viewer ─────────────────────────────
  const handleOpenExternally = useCallback(async () => {
    setOpeningFile(true);
    setOpenFileError(null);
    try {
      await openDrawingExternally(drawing);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not retrieve file.";
      setOpenFileError(msg);
    } finally {
      setOpeningFile(false);
    }
  }, [drawing]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const selectedLayerInfo = selectedLayer
    ? parsed.layers.find((l) => l.name === selectedLayer)
    : null;
  const selectedMapping = selectedLayer
    ? mappingByLayer.get(selectedLayer)
    : null;

  const sortedLayers = useMemo(
    () => [...parsed.layers].sort((a, b) => b.entityCount - a.entityCount),
    [parsed.layers]
  );

  const zoomLabel =
    displayZoom >= 1000
      ? `${(displayZoom / 100).toFixed(0)}×`
      : `${displayZoom}%`;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[98vw] w-[98vw] h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-[var(--border)] shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4 text-blue-600" />
            Visual Review — {drawing.fileName}
            <Badge variant="secondary" className="text-[10px] ml-1">
              Custom SVG
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs flex items-start gap-1.5">
            <Info className="h-3 w-3 shrink-0 mt-0.5 text-amber-500" />
            Quick verification only. For full CAD fidelity, use{" "}
            <strong>Open in CAD</strong> to view in AutoCAD, DWG TrueView, or
            LibreCAD.
            {" · "}Drag to pan · Scroll to zoom · Double-click layer to fit · Esc to clear.
          </DialogDescription>
        </DialogHeader>

        {/* ── Body ────────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── Layer sidebar ─────────────────────────────────────────── */}
          <div className="w-56 shrink-0 border-r border-[var(--border)] flex flex-col bg-white">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-slate-50 shrink-0">
              <span className="text-xs font-semibold text-slate-600">
                Layers ({parsed.layerCount})
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="text-[10px] text-blue-600 hover:underline"
                  onClick={() => setHiddenLayers(new Set())}
                >
                  All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  className="text-[10px] text-blue-600 hover:underline"
                  onClick={() =>
                    setHiddenLayers(new Set(parsed.layers.map((l) => l.name)))
                  }
                >
                  None
                </button>
              </div>
            </div>

            {/* Layer list */}
            <div className="flex-1 overflow-y-auto text-[11px]">
              {sortedLayers.map((layer) => {
                const isHidden = hiddenLayers.has(layer.name);
                const isSelected = selectedLayer === layer.name;
                const mapping = mappingByLayer.get(layer.name);
                const color = aciHex(layer.colorIndex);

                return (
                  <div
                    key={layer.name}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1 cursor-pointer border-b border-slate-100 hover:bg-slate-50 select-none",
                      isSelected && "bg-blue-50 border-l-2 border-l-blue-500"
                    )}
                    onClick={() => handleLayerClick(layer.name)}
                    onDoubleClick={() => handleLayerDoubleClick(layer.name)}
                    title={`${layer.name} · ${layer.entityCount} entities\nDouble-click to zoom to this layer`}
                  >
                    <button
                      type="button"
                      className="shrink-0 text-slate-400 hover:text-slate-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleHidden(layer.name);
                      }}
                    >
                      {isHidden ? (
                        <EyeOff className="h-3 w-3" />
                      ) : (
                        <Eye className="h-3 w-3 text-slate-500" />
                      )}
                    </button>
                    <span
                      className="h-2 w-2 rounded-full shrink-0 border border-white/20"
                      style={{ backgroundColor: color }}
                    />
                    <span
                      className={cn(
                        "flex-1 font-mono truncate",
                        isHidden && "text-slate-400 line-through",
                        isSelected && "font-semibold text-blue-700"
                      )}
                    >
                      {layer.name}
                    </span>
                    <span className="text-[9px] text-slate-400 shrink-0 tabular-nums">
                      {layer.entityCount}
                    </span>
                    {mapping && (
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          mapping.enabled ? "bg-green-500" : "bg-slate-300"
                        )}
                        title={
                          mapping.enabled
                            ? `Mapped: ${TAKEOFF_CATEGORY_LABELS[mapping.category]}`
                            : "Mapping disabled"
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Selected layer info panel */}
            {selectedLayerInfo && (
              <div className="border-t border-[var(--border)] bg-slate-50 p-2.5 shrink-0 text-xs space-y-1.5">
                <p
                  className="font-semibold font-mono truncate text-[11px]"
                  title={selectedLayerInfo.name}
                >
                  {selectedLayerInfo.name}
                </p>
                <p className="text-[var(--muted)]">
                  {selectedLayerInfo.entityCount} entities
                  {selectedLayerInfo.frozen && " · frozen"}
                  {!selectedLayerInfo.visible && " · hidden in DXF"}
                </p>

                {/* Layer bbox values */}
                {layerDxfBbox && (
                  <p className="text-[9px] font-mono text-slate-500 leading-snug">
                    BBox: {layerDxfBbox.width.toFixed(0)} ×{" "}
                    {layerDxfBbox.height.toFixed(0)} DU
                  </p>
                )}

                {/* Warnings */}
                {abnormalBbox && (
                  <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1 text-[10px] text-amber-800 leading-snug">
                    <AlertTriangle className="inline h-3 w-3 mr-0.5" />
                    Bbox looks abnormal — may include distant geometry or bad blocks.
                  </div>
                )}
                {selectedLayerHasInserts && (
                  <div className="rounded bg-blue-50 border border-blue-200 px-2 py-1 text-[10px] text-blue-800 leading-snug">
                    <Info className="inline h-3 w-3 mr-0.5" />
                    Layer has INSERT entities — custom viewer shows markers only.
                  </div>
                )}

                {selectedMapping ? (
                  <>
                    <p>
                      <span className="text-[var(--muted)]">Category: </span>
                      {TAKEOFF_CATEGORY_LABELS[selectedMapping.category]}
                    </p>
                    <Badge
                      variant={selectedMapping.enabled ? "success" : "secondary"}
                      className="text-[9px]"
                    >
                      {selectedMapping.enabled ? "Mapping active" : "Mapping disabled"}
                    </Badge>
                  </>
                ) : (
                  <p className="text-[var(--muted)] italic">No mapping.</p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 w-full text-[10px]"
                  onClick={() => fitToLayer(selectedLayerInfo.name)}
                >
                  <Crosshair className="h-3 w-3 mr-1" />
                  Zoom to layer
                </Button>
              </div>
            )}
          </div>

          {/* ── Main viewer ───────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Large-drawing warning */}
            {renderResult.isSimplified && (
              <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-xs text-amber-800 shrink-0">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                Large drawing — simplified (up to 3 000 entities/layer shown).
              </div>
            )}

            {/* Fit error toast */}
            {fitError && (
              <div className="flex items-center justify-between gap-2 bg-red-50 border-b border-red-200 px-4 py-1.5 text-xs text-red-800 shrink-0">
                <span>{fitError}</span>
                <button
                  type="button"
                  className="shrink-0 hover:underline"
                  onClick={() => setFitError(null)}
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Toolbar */}
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--border)] bg-slate-50 shrink-0 flex-wrap">
              {/* Zoom controls */}
              <button
                type="button"
                onClick={() => zoomStep(-1)}
                title={`Zoom out (min ${MIN_ZOOM * 100}%)`}
                className="rounded p-1 hover:bg-slate-200 text-slate-600"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-xs font-mono w-14 text-center tabular-nums select-none">
                {zoomLabel}
              </span>
              <button
                type="button"
                onClick={() => zoomStep(1)}
                title={`Zoom in (max ${MAX_ZOOM}×)`}
                className="rounded p-1 hover:bg-slate-200 text-slate-600"
              >
                <ZoomIn className="h-4 w-4" />
              </button>

              <div className="w-px h-4 bg-slate-200 mx-0.5" />

              <button
                type="button"
                onClick={() => fitToDrawing(true)}
                title="Fit drawing to window"
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-slate-200 text-slate-600"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Fit
              </button>

              {selectedLayer && (
                <button
                  type="button"
                  onClick={() => fitToLayer(selectedLayer)}
                  title="Zoom to selected layer"
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-blue-100 text-blue-700"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  Fit selected
                </button>
              )}

              <button
                type="button"
                onClick={() => fitToDrawing(false)}
                title="Reset view"
                className="rounded p-1 hover:bg-slate-200 text-slate-600"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>

              <div className="w-px h-4 bg-slate-200 mx-0.5" />

              <button
                type="button"
                className={cn(
                  "rounded px-1.5 py-1 text-[11px] transition-colors",
                  showText ? "bg-blue-100 text-blue-700" : "text-slate-600 hover:bg-slate-200"
                )}
                onClick={() => setShowText((v) => !v)}
              >
                {showText ? "Hide text" : "Show text"}
              </button>

              {highlightedLayers.length > 0 && (
                <button
                  type="button"
                  className="flex items-center gap-0.5 rounded px-1.5 py-1 text-[11px] text-amber-700 hover:bg-amber-50"
                  onClick={clearHighlight}
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}

              {/* Diagnostics toggle */}
              <button
                type="button"
                className={cn(
                  "flex items-center gap-0.5 rounded px-1.5 py-1 text-[11px] ml-1",
                  showDiagnostics
                    ? "bg-violet-100 text-violet-700"
                    : "text-slate-500 hover:bg-slate-200"
                )}
                title="Toggle diagnostics panel"
                onClick={() => setShowDiagnostics((v) => !v)}
              >
                <Activity className="h-3.5 w-3.5" />
                Diag
              </button>

              <span className="ml-auto text-[11px] text-[var(--muted)] truncate max-w-[25ch]">
                {selectedLayer
                  ? `● ${selectedLayer}`
                  : "Click layer or geometry to highlight"}
              </span>
            </div>

            {/* Diagnostics panel */}
            {showDiagnostics && (
              <div className="shrink-0 border-b border-violet-200 bg-violet-50 px-4 py-2 text-[10px] font-mono text-violet-900 grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-3 lg:grid-cols-4">
                <div>
                  <span className="text-violet-500">DXF bbox: </span>
                  {fmtBbox(parsed.boundingBox)}
                </div>
                <div>
                  <span className="text-violet-500">SVG canvas: </span>
                  {renderResult.width.toFixed(0)} × {renderResult.height.toFixed(0)} px
                </div>
                <div>
                  <span className="text-violet-500">Render scale: </span>
                  {fmtN(renderResult.scale, 6)} px/DU
                </div>
                <div>
                  <span className="text-violet-500">Y-flip: </span>yes (DXF Y↑ → SVG Y↓)
                </div>
                <div>
                  <span className="text-violet-500">Viewer zoom: </span>
                  {zoomLabel}
                </div>
                <div>
                  <span className="text-violet-500">TranslateX/Y: </span>
                  {fmtN(transformRef.current.translateX, 1)}, {fmtN(transformRef.current.translateY, 1)}
                </div>
                <div>
                  <span className="text-violet-500">Layer DXF bbox: </span>
                  {fmtBbox(layerDxfBbox)}
                </div>
                <div>
                  <span className="text-violet-500">Layer SVG bbox: </span>
                  {fmtBbox(layerSvgBbox)}
                </div>
                {selectedLayer && (
                  <div className="col-span-full">
                    <span className="text-violet-500">Selected layer entities: </span>
                    {selectedLayerInfo?.entityCount ?? "—"}
                    {selectedLayerHasInserts && " (has INSERTs)"}
                    {abnormalBbox && " ⚠ ABNORMAL BBOX"}
                  </div>
                )}
              </div>
            )}

            {/* SVG canvas */}
            <div className="flex-1 overflow-hidden bg-slate-900 relative select-none">
              <svg
                ref={svgRef}
                width="100%"
                height="100%"
                style={{ display: "block" }}
                cursor={isDragging ? "grabbing" : "crosshair"}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onClick={handleSvgClick}
              >
                {/* Dynamic CSS: layer visibility + highlight styles */}
                {cssRules && <style>{cssRules}</style>}

                {/*
                 * Root transform group.
                 * Pan/zoom applied via g.style.transform (direct DOM, zero React renders).
                 * transformOrigin "0 0" → scale origin is SVG canvas top-left corner.
                 * All child coords are in SVG canvas space.
                 */}
                <g
                  ref={rootGroupRef}
                  style={{ transformOrigin: "0 0", willChange: "transform" }}
                >
                  {/* Memoised entity geometry — never re-renders on pan/zoom */}
                  <InnerSvgContent html={renderResult.svgContent} />

                  {/* Layer bounding-box overlay (SVG canvas coords) */}
                  {layerSvgBbox && (
                    <rect
                      x={layerSvgBbox.minX}
                      y={layerSvgBbox.minY}
                      width={layerSvgBbox.width}
                      height={layerSvgBbox.height}
                      fill={
                        abnormalBbox
                          ? "rgba(239,68,68,0.06)"
                          : "rgba(255,149,0,0.06)"
                      }
                      stroke={abnormalBbox ? "#ef4444" : "#FF9500"}
                      strokeWidth={2}
                      strokeDasharray="8 4"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  )}
                </g>
              </svg>

              {/* Selected layer chip overlay */}
              {selectedLayer && !isDragging && (
                <div className="absolute bottom-3 left-3 pointer-events-none">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium shadow-lg backdrop-blur",
                      abnormalBbox
                        ? "bg-red-500/90 text-white"
                        : "bg-amber-500/90 text-white"
                    )}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: aciHex(
                          parsed.layers.find((l) => l.name === selectedLayer)
                            ?.colorIndex ?? 7
                        ),
                      }}
                    />
                    {selectedLayer}
                    {selectedLayerInfo && (
                      <span className="opacity-75">
                        {" · "}
                        {selectedLayerInfo.entityCount}
                      </span>
                    )}
                    {abnormalBbox && (
                      <span className="opacity-90"> ⚠ abnormal bbox</span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-t border-[var(--border)] shrink-0 bg-slate-50">
          <span className="text-xs text-[var(--muted)]">
            {parsed.layerCount} layers · {parsed.units}
            {hiddenLayers.size > 0 && ` · ${hiddenLayers.size} hidden`}
            {" · "}renderer {renderResult.scale < 1
              ? `1:${(1 / renderResult.scale).toFixed(0)}`
              : `${renderResult.scale.toFixed(3)}×`}
          </span>

          <div className="flex gap-2 items-center">
            {/* Open file error */}
            {openFileError && (
              <span className="text-xs text-red-600 max-w-[30ch] truncate">
                {openFileError}
              </span>
            )}

            {/* Open in external CAD viewer */}
            {drawing.fileType === "dxf" && (
              <Button
                variant="outline"
                size="sm"
                disabled={openingFile}
                onClick={handleOpenExternally}
                title="Download original DXF to open in AutoCAD, DWG TrueView, LibreCAD, etc."
              >
                <Download className="h-4 w-4" />
                {openingFile ? "Preparing…" : "Open in CAD"}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
