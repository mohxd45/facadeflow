/**
 * PDF Report Service — Phase 1
 *
 * Generates a print-ready HTML report and opens it in a new browser tab.
 * The user can then use "Print → Save as PDF" to export a PDF.
 *
 * No third-party PDF library required.
 *
 * Report sections:
 *   1. Project header (name, date, company)
 *   2. Drawing package summary
 *   3. Final verified quantity table
 *   4. Missing information summary
 *   5. Warnings
 */

import type { Project } from "@/types/project";
import type { DrawingTakeoffItem } from "@/types/drawing-takeoff";
import type { DrawingIssueItem } from "@/types/drawing-takeoff";
import type { ClassifiedDrawing } from "@/types/drawing-package";
import { DRAWING_ITEM_CATEGORY_LABELS } from "@/types/drawing-takeoff";
import { DRAWING_PACKAGE_TYPE_LABELS } from "@/types/drawing-package";
import { DRAWING_ISSUE_TYPE_LABELS } from "@/types/drawing-takeoff";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PdfReportParams {
  project: Project;
  /** Only items with status verified or final are included */
  takeoffItems: DrawingTakeoffItem[];
  issues: DrawingIssueItem[];
  classifiedDrawings?: ClassifiedDrawing[];
  companyName?: string;
}

export function exportDrawingTakeoffToPdf(params: PdfReportParams): void {
  const html = buildReportHtml(params);
  const win = window.open("", "_blank");
  if (!win) {
    alert("Pop-up blocked. Please allow pop-ups for this site to export PDF.");
    return;
  }
  win.document.write(html);
  win.document.close();
  // Auto-trigger print after content loads
  win.onload = () => win.print();
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function buildReportHtml(params: PdfReportParams): string {
  const { project, takeoffItems, issues, classifiedDrawings, companyName } = params;

  const exportDate = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  // Only show verified/final items (or all if no status set)
  const finalItems = takeoffItems.filter(
    (i) => !i.status || i.status === "verified" || i.status === "final"
  );

  const openIssues = issues.filter((i) => i.status === "open" || i.status === "filled");
  const totalSqm = finalItems
    .filter((i) => i.unit === "sqm")
    .reduce((s, i) => s + (i.totalArea ?? i.areaEach ?? 0), 0);
  const totalLm = finalItems
    .filter((i) => i.unit === "lm")
    .reduce((s, i) => s + (i.length ?? 0), 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${esc(project.name)} — Quantity Takeoff Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #1e293b; padding: 20mm; }
  h1 { font-size: 18pt; color: #0f172a; margin-bottom: 4px; }
  h2 { font-size: 12pt; color: #0f172a; margin: 16px 0 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  h3 { font-size: 10pt; color: #334155; margin: 12px 0 4px; }
  .meta { color: #475569; font-size: 9pt; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 8.5pt; }
  th { background: #f1f5f9; font-weight: bold; text-align: left; padding: 5px 6px; border: 1px solid #cbd5e1; }
  td { padding: 4px 6px; border: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) { background: #f8fafc; }
  .high   { color: #166534; font-weight: bold; }
  .medium { color: #92400e; }
  .low    { color: #991b1b; }
  .badge-verified { background: #dcfce7; color: #166534; padding: 1px 5px; border-radius: 3px; font-size: 8pt; }
  .badge-draft    { background: #f1f5f9; color: #475569; padding: 1px 5px; border-radius: 3px; font-size: 8pt; }
  .badge-open     { background: #fef3c7; color: #92400e; padding: 1px 5px; border-radius: 3px; font-size: 8pt; }
  .totals-row { font-weight: bold; background: #e0f2fe; }
  .warning-box { background: #fef3c7; border: 1px solid #fcd34d; padding: 8px 12px; border-radius: 4px; margin-bottom: 8px; font-size: 9pt; }
  .footer { margin-top: 24px; font-size: 8pt; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  @media print {
    body { padding: 10mm; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<h1>${esc(companyName ?? "Facade Takeoff")}</h1>
<div class="meta">
  <strong>Project:</strong> ${esc(project.name)}<br/>
  <strong>Export date:</strong> ${exportDate}<br/>
  ${project.clientName ? `<strong>Client:</strong> ${esc(project.clientName)}<br/>` : ""}
  ${project.location ? `<strong>Location:</strong> ${esc(project.location)}<br/>` : ""}
</div>

${
  openIssues.length > 0
    ? `<div class="warning-box">⚠ This report contains <strong>${openIssues.length} unresolved issue${openIssues.length > 1 ? "s" : ""}</strong>. Quantities may be incomplete. Review before submitting.</div>`
    : ""
}

<!-- Drawing Package Summary -->
${
  classifiedDrawings && classifiedDrawings.length > 0
    ? `<h2>Drawing Package (${classifiedDrawings.length} drawings)</h2>
<table>
  <thead><tr><th>Drawing</th><th>Type</th><th>Sheet Title</th><th>Confidence</th></tr></thead>
  <tbody>
    ${classifiedDrawings
      .map(
        (d) => `<tr>
      <td>${esc(d.drawingName)}</td>
      <td>${esc(DRAWING_PACKAGE_TYPE_LABELS[d.drawingType])}</td>
      <td>${esc(d.sheetTitle ?? "—")}</td>
      <td class="${d.confidence}">${d.confidence}</td>
    </tr>`
      )
      .join("")}
  </tbody>
</table>`
    : ""
}

<!-- Quantity Takeoff -->
<h2>Verified Quantity Takeoff (${finalItems.length} items)</h2>
${
  finalItems.length === 0
    ? `<p class="meta">No verified items yet. Mark items as Verified or Final in the Drawing Takeoff tab.</p>`
    : `<table>
  <thead>
    <tr>
      <th>Code</th><th>Description</th><th>Category</th>
      <th>Count</th><th>W (m)</th><th>H (m)</th>
      <th>Area/ea</th><th>Total Area</th><th>Length (lm)</th>
      <th>Unit</th><th>Source</th><th>Conf.</th><th>Status</th>
    </tr>
  </thead>
  <tbody>
    ${finalItems
      .map(
        (i) => `<tr>
      <td>${esc(i.itemCode ?? "—")}</td>
      <td>${esc(i.description)}</td>
      <td>${esc(DRAWING_ITEM_CATEGORY_LABELS[i.category] ?? i.category)}</td>
      <td>${i.count ?? "—"}</td>
      <td>${i.width?.toFixed(2) ?? "—"}</td>
      <td>${i.height?.toFixed(2) ?? "—"}</td>
      <td>${i.areaEach?.toFixed(2) ?? "—"}</td>
      <td>${i.totalArea?.toFixed(2) ?? (i.areaEach?.toFixed(2) ?? "—")}</td>
      <td>${i.length ?? "—"}</td>
      <td>${i.unit}</td>
      <td>${esc(i.sourceDrawingName ?? "—")}</td>
      <td class="${i.confidence}">${i.confidence}</td>
      <td><span class="${i.status === "final" || i.status === "verified" ? "badge-verified" : "badge-draft"}">${i.status ?? "draft"}</span></td>
    </tr>`
      )
      .join("")}
    ${
      totalSqm > 0 || totalLm > 0
        ? `<tr class="totals-row">
      <td colspan="7">TOTALS</td>
      <td>${totalSqm > 0 ? `${totalSqm.toFixed(2)} sqm` : "—"}</td>
      <td>${totalLm > 0 ? `${totalLm.toFixed(1)} lm` : "—"}</td>
      <td colspan="4"></td>
    </tr>`
        : ""
    }
  </tbody>
</table>`
}

<!-- Missing Information -->
<h2>Missing / Outstanding Information (${openIssues.length} issues)</h2>
${
  openIssues.length === 0
    ? `<p class="meta">No outstanding issues.</p>`
    : `<table>
  <thead>
    <tr>
      <th>Issue</th><th>Possible Item</th><th>Source Drawing</th><th>Page</th>
      <th>Missing Fields</th><th>Recommendation</th><th>Confidence</th><th>Status</th>
    </tr>
  </thead>
  <tbody>
    ${openIssues
      .map(
        (i) => `<tr>
      <td>${esc(DRAWING_ISSUE_TYPE_LABELS[i.issueType] ?? i.issueType)}</td>
      <td>${esc(i.possibleDescription ?? "—")}</td>
      <td>${esc(i.sourceDrawingName ?? "—")}</td>
      <td>${i.sourcePage ?? "—"}</td>
      <td>${esc(i.missingFields.join(", "))}</td>
      <td>${esc(i.recommendation)}</td>
      <td class="${i.confidence}">${i.confidence}</td>
      <td><span class="badge-open">${esc(i.status)}</span></td>
    </tr>`
      )
      .join("")}
  </tbody>
</table>`
}

<div class="footer">
  Generated by Facade Takeoff · ${exportDate} ·
  Note: This report shows deterministic extraction results. All quantities must be verified by a qualified estimator before use in pricing.
</div>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
