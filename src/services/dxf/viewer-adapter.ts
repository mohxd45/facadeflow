/**
 * DXF Viewer Adapter — Phase 15B
 *
 * Abstracts the viewer strategy behind a common interface so the UI can
 * switch between the built-in custom SVG renderer and an external CAD
 * viewer without rewriting components.
 *
 * Currently only "custom-svg" is fully implemented.  "external-cad" is
 * represented by downloading the original file and letting the OS open
 * it in AutoCAD, DWG TrueView, LibreCAD, etc.
 */

import type { DrawingFile } from "@/types/drawing";

// ---------------------------------------------------------------------------
// Provider types
// ---------------------------------------------------------------------------

/**
 * Which viewer strategy is active.
 * - `custom-svg`  — built-in browser SVG renderer (always available)
 * - `external-cad` — open/download the original file in a native CAD app
 */
export type ViewerProvider = "custom-svg" | "external-cad";

/**
 * What a given viewer provider can do.
 * Used by the UI to show/hide capability-dependent controls.
 */
export interface ViewerCapabilities {
  /** Interactive zoom */
  zoom: boolean;
  /** Interactive pan */
  pan: boolean;
  /** Toggle individual layer visibility */
  layerToggle: boolean;
  /** Render full block/INSERT geometry (not just markers) */
  blockExpansion: boolean;
  /** Overlay measurement dimensions */
  measurementOverlay: boolean;
  /** Show diagnostics panel */
  diagnostics: boolean;
}

export const VIEWER_CAPABILITIES: Record<ViewerProvider, ViewerCapabilities> = {
  "custom-svg": {
    zoom: true,
    pan: true,
    layerToggle: true,
    blockExpansion: false, // INSERTs shown as cross markers only
    measurementOverlay: false,
    diagnostics: true,
  },
  "external-cad": {
    zoom: true,
    pan: true,
    layerToggle: true,
    blockExpansion: true,
    measurementOverlay: true,
    diagnostics: false,
  },
};

// ---------------------------------------------------------------------------
// External viewer action — open/download original file
// ---------------------------------------------------------------------------

/**
 * Resolves the drawing blob and triggers a browser download so the user
 * can open the original DXF in AutoCAD, DWG TrueView, LibreCAD, etc.
 *
 * Local mode  : creates a temporary object URL from the IndexedDB blob.
 * Supabase mode: falls back through the same resolveDrawingBlob chain
 *                (signed URL → previewUrl → IndexedDB).
 *
 * Throws a user-readable error if no blob source is available.
 */
export async function openDrawingExternally(
  drawing: DrawingFile
): Promise<void> {
  const { resolveDrawingBlob } = await import(
    "@/services/file/drawing-blob-resolver"
  );
  const file = await resolveDrawingBlob(drawing);

  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = drawing.fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoke after 60 s to allow the download to start
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

// ---------------------------------------------------------------------------
// Coordinate-system documentation
// ---------------------------------------------------------------------------

/**
 * There are THREE coordinate systems in the DXF viewer:
 *
 * 1. DXF world coordinates  (dxfX, dxfY)
 *    - Origin and scale defined by the CAD author.
 *    - Y-axis points UP (standard mathematical convention).
 *    - Example: a wall at dxfX=10000, dxfY=5000 mm from project origin.
 *
 * 2. SVG canvas coordinates  (svgX, svgY)
 *    - Produced by the renderer (dxf-svg-renderer.service.ts).
 *    - Y-axis points DOWN (SVG convention).
 *    - Scaled to fit MAX_W × MAX_H (1400 × 900 px).
 *    - Formula:
 *        svgX = (dxfX - renderTransform.minX) * renderTransform.scale + renderTransform.padding
 *        svgY = (renderTransform.maxY - dxfY)  * renderTransform.scale + renderTransform.padding
 *    - The SVG canvas always starts at (0,0) top-left.
 *
 * 3. Screen / viewport coordinates  (screenX, screenY)
 *    - Browser pixel coordinates within the SVG element's bounding rect.
 *    - Produced by applying the current ViewerTransform to SVG canvas coords:
 *        screenX = svgX * viewerTransform.scale + viewerTransform.translateX
 *        screenY = svgY * viewerTransform.scale + viewerTransform.translateY
 *    - Used for mouse events (e.clientX - rect.left, etc.).
 *
 * Conversions used in the viewer:
 *   DXF bbox → SVG bbox  : dxfBboxToSvgBbox()   in dxf-viewer-utils.ts
 *   SVG bbox → ViewerTransform : bboxToViewTransform() in dxf-viewer-utils.ts
 */
export const _COORD_SYSTEM_DOCS = null; // export forces TS to include the comment in .d.ts
