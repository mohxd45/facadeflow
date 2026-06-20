/**
 * Professional quantity takeoff Excel export — Phase 8 / 11
 *
 * Workbook sheets:
 *  1. Quantity Takeoff — item-level detail with company + project header
 *  2. Summary by Category — totals grouped by category + unit
 *  3. Drawing Register — project drawing inventory
 */

import type { Fill, Font, Row, Worksheet } from "exceljs";
import type { Project } from "@/types/project";
import type { CompanyProfile } from "@/types/company";
import type { DrawingFile, DrawingFileStatus } from "@/types/drawing";
import type { QuantityTakeoffItem } from "@/types/takeoff";
import type { CodeTakeoffItem } from "@/types/code-takeoff";
import type { DrawingTakeoffItem } from "@/types/drawing-takeoff";
import { DRAWING_ITEM_CATEGORY_LABELS } from "@/types/drawing-takeoff";
import {
  DRAWING_CATEGORY_LABELS,
  DRAWING_VIEW_TYPE_LABELS,
  TAKEOFF_CATEGORY_LABELS,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { formatFileSize } from "@/lib/file-size";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface QuantityExcelExportParams {
  project: Project;
  drawings: DrawingFile[];
  items: QuantityTakeoffItem[];
  companyProfile?: CompanyProfile | null;
  /** Code-based takeoff items — exported to a separate sheet if provided */
  codeTakeoffItems?: CodeTakeoffItem[];
  /** Drawing takeoff items — exported to a separate sheet if provided */
  drawingTakeoffItems?: DrawingTakeoffItem[];
}

export function exportQuantityTakeoffToExcel(
  params: QuantityExcelExportParams
): void {
  if (
    params.items.length === 0 &&
    !params.codeTakeoffItems?.length &&
    !params.drawingTakeoffItems?.length
  )
    return;
  void buildAndDownload(params);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const APP_NAME = "Facade Takeoff";

const DRAWING_STATUS_LABELS: Record<DrawingFileStatus, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  ready: "Ready",
  queued: "Queued",
  error: "Error",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  manual: "Manual",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const HEADER_FILL: Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE2E8F0" },
};

const TITLE_FONT: Partial<Font> = { bold: true, size: 14 };
const COMPANY_FONT: Partial<Font> = { bold: true, size: 16 };
const HEADER_FONT: Partial<Font> = { bold: true };
const META_FONT: Partial<Font> = { size: 11 };

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 180) || "quantity-takeoff"
  );
}

function formatExportDate(): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function applyHeaderStyle(row: Row) {
  row.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });
  row.height = 22;
}

function autoFitColumns(worksheet: Worksheet, minWidth = 10, maxWidth = 48) {
  worksheet.columns.forEach((column) => {
    if (!column || !column.eachCell) return;
    let maxLen = minWidth;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const value = cell.value;
      const text =
        value === null || value === undefined
          ? ""
          : typeof value === "object" && value !== null && "richText" in value
            ? String(
                (value as { richText: { text: string }[] }).richText
                  .map((r) => r.text)
                  .join("")
              )
            : String(value);
      maxLen = Math.max(maxLen, Math.min(text.length + 2, maxWidth));
    });
    column.width = maxLen;
  });
}

function addMetaRow(worksheet: Worksheet, label: string, value: string) {
  const row = worksheet.addRow([label, value]);
  row.getCell(1).font = { ...META_FONT, bold: true };
  row.getCell(2).font = META_FONT;
}

function parseLogoDataUrl(
  dataUrl: string
): { base64: string; extension: "png" | "jpeg" } | null {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) return null;
  const type = match[1].toLowerCase();
  // ExcelJS supports png and jpeg; treat webp as png attempt may fail — skip webp
  if (type === "webp") return null;
  const extension = type === "jpg" || type === "jpeg" ? "jpeg" : "png";
  return { base64: match[2], extension };
}

interface ReportHeaderContext {
  workbook: import("exceljs").Workbook;
  worksheet: Worksheet;
  project: Project;
  companyProfile?: CompanyProfile | null;
  sheetTitle: string;
}

/**
 * Adds company branding + project meta block to a worksheet.
 * Returns the row number of the column-header row (for freeze panes).
 */
function addReportHeaderBlock(ctx: ReportHeaderContext): number {
  const { workbook, worksheet, project, companyProfile, sheetTitle } = ctx;
  const companyName = companyProfile?.companyName?.trim() || APP_NAME;

  // Company name
  const companyRow = worksheet.addRow([companyName]);
  companyRow.font = COMPANY_FONT;
  companyRow.height = 24;

  // Optional logo (top-right area)
  if (companyProfile?.logoDataUrl) {
    const parsed = parseLogoDataUrl(companyProfile.logoDataUrl);
    if (parsed) {
      try {
        const imageId = workbook.addImage({
          base64: parsed.base64,
          extension: parsed.extension,
        });
        worksheet.addImage(imageId, {
          tl: { col: 7, row: 0 },
          ext: { width: 80, height: 50 },
        });
      } catch {
        // Logo embed failed — continue without image
      }
    }
  }

  // Company contact lines
  if (companyProfile?.address) {
    addMetaRow(worksheet, "Address:", companyProfile.address);
  }
  const contactParts = [
    companyProfile?.phone,
    companyProfile?.email,
    companyProfile?.website,
  ].filter(Boolean);
  if (contactParts.length > 0) {
    addMetaRow(worksheet, "Contact:", contactParts.join("  |  "));
  }
  if (companyProfile?.trn) {
    addMetaRow(worksheet, "TRN / VAT:", companyProfile.trn);
  }

  worksheet.addRow([]);

  // Sheet title
  const titleRow = worksheet.addRow([sheetTitle]);
  titleRow.font = TITLE_FONT;

  // Project meta
  addMetaRow(worksheet, "Project:", project.name);
  if (project.clientName) {
    addMetaRow(worksheet, "Client:", project.clientName);
  }
  if (project.location) {
    addMetaRow(worksheet, "Location:", project.location);
  }
  addMetaRow(worksheet, "Export Date:", formatExportDate());
  if (companyProfile?.preparedBy) {
    addMetaRow(worksheet, "Prepared by:", companyProfile.preparedBy);
  }
  if (companyProfile?.checkedBy) {
    addMetaRow(worksheet, "Checked by:", companyProfile.checkedBy);
  }
  if (companyProfile?.defaultNotes) {
    addMetaRow(worksheet, "Notes:", companyProfile.defaultNotes);
  }

  worksheet.addRow([]);
  return worksheet.rowCount + 1;
}

interface CategorySummaryRow {
  category: string;
  totalQuantity: number;
  unit: string;
  itemCount: number;
}

function buildCategorySummary(items: QuantityTakeoffItem[]): CategorySummaryRow[] {
  const map = new Map<string, CategorySummaryRow>();

  for (const item of items) {
    const category = TAKEOFF_CATEGORY_LABELS[item.category];
    const unit = item.unit || "—";
    const key = `${category}::${unit}`;

    const existing = map.get(key);
    if (existing) {
      existing.totalQuantity += item.quantity;
      existing.itemCount += 1;
    } else {
      map.set(key, {
        category,
        totalQuantity: item.quantity,
        unit,
        itemCount: 1,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const cat = a.category.localeCompare(b.category);
    return cat !== 0 ? cat : a.unit.localeCompare(b.unit);
  });
}

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

function buildQuantitySheet(
  workbook: import("exceljs").Workbook,
  project: Project,
  items: QuantityTakeoffItem[],
  drawingMap: Map<string, DrawingFile>,
  companyProfile?: CompanyProfile | null
) {
  const sheet = workbook.addWorksheet("Quantity Takeoff");

  const headerRowNum = addReportHeaderBlock({
    workbook,
    worksheet: sheet,
    project,
    companyProfile,
    sheetTitle: "Quantity Takeoff Report",
  });

  const headers = [
    "Item Code",
    "Element Name",
    "Category",
    "Drawing View Type",
    "Location / Floor",
    "Quantity",
    "Unit",
    "Source Drawing",
    "Confidence",
    "Notes",
  ];

  const headerRow = sheet.addRow(headers);
  applyHeaderStyle(headerRow);
  sheet.views = [{ state: "frozen", ySplit: headerRowNum }];

  for (const item of items) {
    const row = sheet.addRow([
      item.itemCode,
      item.elementName,
      TAKEOFF_CATEGORY_LABELS[item.category],
      DRAWING_VIEW_TYPE_LABELS[item.drawingViewType ?? "plan"],
      item.locationFloor || "—",
      item.quantity,
      item.unit,
      drawingMap.get(item.sourceDrawingId)?.fileName ?? "—",
      CONFIDENCE_LABELS[item.confidence] ?? item.confidence,
      item.notes ?? "",
    ]);

    const qtyCell = row.getCell(6);
    qtyCell.numFmt = "#,##0.##";
    qtyCell.alignment = { horizontal: "right" };
  }

  autoFitColumns(sheet);
}

function buildSummarySheet(
  workbook: import("exceljs").Workbook,
  project: Project,
  items: QuantityTakeoffItem[],
  companyProfile?: CompanyProfile | null
) {
  const sheet = workbook.addWorksheet("Summary by Category");

  const headerRowNum = addReportHeaderBlock({
    workbook,
    worksheet: sheet,
    project,
    companyProfile,
    sheetTitle: "Summary by Category",
  });

  const headers = ["Category", "Total Quantity", "Unit", "Item Count"];
  const headerRow = sheet.addRow(headers);
  applyHeaderStyle(headerRow);
  sheet.views = [{ state: "frozen", ySplit: headerRowNum }];

  const summaries = buildCategorySummary(items);
  for (const row of summaries) {
    const dataRow = sheet.addRow([
      row.category,
      row.totalQuantity,
      row.unit,
      row.itemCount,
    ]);
    dataRow.getCell(2).numFmt = "#,##0.##";
    dataRow.getCell(2).alignment = { horizontal: "right" };
    dataRow.getCell(4).alignment = { horizontal: "right" };
  }

  autoFitColumns(sheet);
}

function buildDrawingRegisterSheet(
  workbook: import("exceljs").Workbook,
  project: Project,
  drawings: DrawingFile[],
  companyProfile?: CompanyProfile | null
) {
  const sheet = workbook.addWorksheet("Drawing Register");

  const headerRowNum = addReportHeaderBlock({
    workbook,
    worksheet: sheet,
    project,
    companyProfile,
    sheetTitle: "Drawing Register",
  });

  const headers = [
    "File Name",
    "File Type",
    "Drawing View Type",
    "Category",
    "File Size",
    "Status",
    "Uploaded Date",
    "Notes",
  ];

  const headerRow = sheet.addRow(headers);
  applyHeaderStyle(headerRow);
  sheet.views = [{ state: "frozen", ySplit: headerRowNum }];

  const sorted = [...drawings].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );

  for (const drawing of sorted) {
    sheet.addRow([
      drawing.fileName,
      drawing.fileType.toUpperCase(),
      DRAWING_VIEW_TYPE_LABELS[drawing.drawingViewType ?? "plan"],
      DRAWING_CATEGORY_LABELS[drawing.category],
      formatFileSize(drawing.fileSize),
      DRAWING_STATUS_LABELS[drawing.status],
      formatDateTime(drawing.uploadedAt),
      drawing.notes ?? "",
    ]);
  }

  autoFitColumns(sheet);
}

// ---------------------------------------------------------------------------
// Code-Based Takeoff sheet
// ---------------------------------------------------------------------------

const CODE_CONFIDENCE_LABELS: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const CODE_SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  boq: "BOQ",
  quotation: "Quotation",
  schedule: "Schedule",
  drawing: "Drawing",
};

function buildCodeTakeoffSheet(
  workbook: import("exceljs").Workbook,
  project: Project,
  items: CodeTakeoffItem[],
  companyProfile?: CompanyProfile | null
) {
  const sheet = workbook.addWorksheet("Code-Based Takeoff");

  const headerRowNum = addReportHeaderBlock({
    workbook,
    worksheet: sheet,
    project,
    companyProfile,
    sheetTitle: "Code-Based Takeoff",
  });

  const headers = [
    "Item Code",
    "Description",
    "Category",
    "Width (m)",
    "Height (m)",
    "Count",
    "Quantity",
    "Unit",
    "Calculation",
    "Source",
    "Confidence",
    "Notes",
  ];

  const headerRow = sheet.addRow(headers);
  applyHeaderStyle(headerRow);
  sheet.views = [{ state: "frozen", ySplit: headerRowNum }];

  // Number formatting
  sheet.getColumn(4).numFmt = "#,##0.000";
  sheet.getColumn(5).numFmt = "#,##0.000";
  sheet.getColumn(7).numFmt = "#,##0.000";

  const calcMethodLabels: Record<string, string> = {
    width_height_qty: "W × H × Qty",
    entered_area: "Enter area",
    entered_length: "Enter length",
    manual_quantity: "Manual qty",
  };

  for (const item of items) {
    const row = sheet.addRow([
      item.itemCode,
      item.description ?? "",
      TAKEOFF_CATEGORY_LABELS[item.category] ?? item.category,
      item.width ?? null,
      item.height ?? null,
      item.count ?? item.manualQuantity ?? null,
      item.calculatedQuantity,
      item.unit,
      calcMethodLabels[item.calculationMethod] ?? item.calculationMethod,
      CODE_SOURCE_LABELS[item.sourceType] ?? item.sourceType,
      CODE_CONFIDENCE_LABELS[item.confidence] ?? item.confidence,
      item.notes ?? "",
    ]);

    // Confidence colour coding
    const confCell = row.getCell(11);
    if (item.confidence === "high") {
      confCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
    } else if (item.confidence === "medium") {
      confCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    } else {
      confCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
    }
  }

  // Summary rows at bottom
  const totals = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.unit] = (acc[i.unit] ?? 0) + i.calculatedQuantity;
    return acc;
  }, {});

  sheet.addRow([]);
  const summaryHeaderRow = sheet.addRow(["TOTALS", "", "", "", "", "", "Quantity", "Unit", "", "", "", ""]);
  summaryHeaderRow.getCell(1).font = HEADER_FONT;
  summaryHeaderRow.getCell(7).font = HEADER_FONT;
  summaryHeaderRow.getCell(8).font = HEADER_FONT;

  for (const [unit, qty] of Object.entries(totals)) {
    const row = sheet.addRow(["", "", "", "", "", "", qty, unit, "", "", "", ""]);
    row.getCell(7).numFmt = "#,##0.000";
    row.getCell(7).font = { bold: true };
  }

  autoFitColumns(sheet);
}

// ---------------------------------------------------------------------------
// Drawing Takeoff sheet
// ---------------------------------------------------------------------------

const DT_SOURCE_LABELS: Record<string, string> = {
  drawing_annotation: "Drawing annotation",
  drawing_schedule:   "Drawing schedule",
  dxf_geometry:       "DXF geometry",
  manual_verify:      "Manual (verified)",
};

function buildDrawingTakeoffSheet(
  workbook: import("exceljs").Workbook,
  project: Project,
  items: DrawingTakeoffItem[],
  drawingsMap: Map<string, DrawingFile>,
  companyProfile?: CompanyProfile | null
) {
  const sheet = workbook.addWorksheet("Drawing Takeoff");

  const headerRowNum = addReportHeaderBlock({
    workbook,
    worksheet: sheet,
    project,
    companyProfile,
    sheetTitle: "Drawing Takeoff",
  });

  const headers = [
    "Item Code",
    "Description",
    "Category",
    "Count",
    "Width (m)",
    "Height (m)",
    "Thickness (m)",
    "Area Each (sqm)",
    "Total Area (sqm)",
    "Length (lm)",
    "Unit",
    "Material",
    "Source Drawing",
    "Source Page",
    "Source Type",
    "Item Source",
    "Width Source",
    "Height Source",
    "Status",
    "Confidence",
    "Warnings",
    "Notes",
  ];

  const headerRow = sheet.addRow(headers);
  applyHeaderStyle(headerRow);
  sheet.views = [{ state: "frozen", ySplit: headerRowNum }];

  // Number formatting for numeric columns
  [5, 6, 7, 8, 9, 10].forEach((col) => {
    sheet.getColumn(col).numFmt = "#,##0.00";
  });

  for (const item of items) {
    const drawingName = item.sourceDrawingName
      ?? (item.drawingId ? (drawingsMap.get(item.drawingId)?.fileName ?? "") : "");
    const row = sheet.addRow([
      item.itemCode ?? "",
      item.description,
      DRAWING_ITEM_CATEGORY_LABELS[item.category] ?? item.category,
      item.count ?? null,
      item.width ?? null,
      item.height ?? null,
      item.thickness ?? null,
      item.areaEach ?? null,
      item.totalArea ?? null,
      item.length ?? null,
      item.unit,
      item.material ?? "",
      drawingName,
      item.sourcePage ?? null,
      DT_SOURCE_LABELS[item.sourceType] ?? item.sourceType,
      item.itemSource ?? "",
      item.widthSource ?? "",
      item.heightSource ?? "",
      item.status ?? "draft",
      item.confidence.charAt(0).toUpperCase() + item.confidence.slice(1),
      item.warnings?.join("; ") ?? "",
      item.notes ?? "",
    ]);

    // Status colour (column 19)
    const statusCell = row.getCell(19);
    if (item.status === "final" || item.status === "verified") {
      statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
    } else if (item.status === "needs_verification") {
      statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    } else if (item.status === "rejected") {
      statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
    }

    // Confidence colour coding (column 20)
    const confCell = row.getCell(20);
    if (item.confidence === "high") {
      confCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
    } else if (item.confidence === "medium") {
      confCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    } else {
      confCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
    }
  }

  // Totals row
  const totalSqm = items
    .filter((i) => i.unit === "sqm")
    .reduce((s, i) => s + (i.totalArea ?? i.areaEach ?? 0), 0);
  const totalLm = items
    .filter((i) => i.unit === "lm")
    .reduce((s, i) => s + (i.length ?? 0), 0);

  sheet.addRow([]);
  if (totalSqm > 0) {
    // columns: Code,Desc,Cat,Count,W,H,Thick,AreaEa,TotalArea,Length,Unit,...
    const r = sheet.addRow(["TOTAL", "", "", "", "", "", "", "", totalSqm, "", "sqm", "", "", "", "", "", "", "", "", "", "", ""]);
    r.getCell(1).font = HEADER_FONT;
    r.getCell(9).font = { bold: true };
    r.getCell(9).numFmt = "#,##0.00";
  }
  if (totalLm > 0) {
    const r = sheet.addRow(["TOTAL", "", "", "", "", "", "", "", "", totalLm, "lm", "", "", "", "", "", "", "", "", "", "", ""]);
    r.getCell(1).font = HEADER_FONT;
    r.getCell(10).font = { bold: true };
    r.getCell(10).numFmt = "#,##0.00";
  }

  autoFitColumns(sheet);
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

async function buildAndDownload(params: QuantityExcelExportParams) {
  const ExcelJS = (await import("exceljs")).default;
  const { project, drawings, items, companyProfile } = params;
  const drawingMap = new Map(drawings.map((d) => [d.id, d]));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = companyProfile?.companyName?.trim() || APP_NAME;
  workbook.created = new Date();
  workbook.modified = new Date();

  if (items.length > 0) {
    buildQuantitySheet(workbook, project, items, drawingMap, companyProfile);
    buildSummarySheet(workbook, project, items, companyProfile);
  }
  if (params.drawingTakeoffItems && params.drawingTakeoffItems.length > 0) {
    buildDrawingTakeoffSheet(workbook, project, params.drawingTakeoffItems, drawingMap, companyProfile);
  }
  if (params.codeTakeoffItems && params.codeTakeoffItems.length > 0) {
    buildCodeTakeoffSheet(workbook, project, params.codeTakeoffItems, companyProfile);
  }
  buildDrawingRegisterSheet(workbook, project, drawings, companyProfile);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(project.name)}-quantity-takeoff.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
