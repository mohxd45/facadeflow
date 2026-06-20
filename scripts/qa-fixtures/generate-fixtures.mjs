/**
 * Generate controlled Phase 3.5 QA fixtures (text-layer PDFs + ZIP).
 * Run: node scripts/qa-fixtures/generate-fixtures.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "output");

function escapePdfText(text) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Minimal single-page PDF with Helvetica text (pdf.js text layer). */
function createTextPdf(lines) {
  const yStart = 720;
  const lineHeight = 16;
  const ops = lines
    .map((line, i) => {
      const y = yStart - i * lineHeight;
      return `BT /F1 11 Tf 72 ${y} Td (${escapePdfText(line)}) Tj ET`;
    })
    .join("\n");

  const stream = ops + "\n";
  const streamLen = Buffer.byteLength(stream, "utf8");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${streamLen} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((body, idx) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefPos = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefPos}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}

const MANUAL_NAME =
  "PJA-SIE-ST1-FRN-ZZZ-DWG-ARC-BB4401 Wall Sections Sheet 2.pdf";
const ZIP_PDF_NAME = "PJA-SIE-ST1-FRN-ZZZ-DWG-ARC-BB4401.pdf";
const QTY_PDF_NAME = "PJA-SIE-ST1-FRN-ZZZ-DWG-ARC-BB4100 Window Schedule.pdf";

const manualPdfLines = [
  "WALL SECTIONS SHEET 2",
  "Drawing PJA-SIE-ST1-FRN-ZZZ-DWG-ARC-BB4401",
  "Reference only — manual upload fixture.",
];

const zipPdfLines = [
  "WALL SECTION",
  "PJA-SIE-ST1-FRN-ZZZ-DWG-ARC-BB4401",
  "ZIP package duplicate fixture.",
];

const qtyPdfLines = [
  "WINDOW SCHEDULE",
  "W-01 Window",
  "W-13 Window",
  "CW-06 Curtain Wall",
  "SD Sliding Door",
  "20.00 x 5.00",
  "CW",
  "SD",
  "W-21 W-21 W-21",
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manualPath = path.join(OUT_DIR, MANUAL_NAME);
  const zipPdfPath = path.join(OUT_DIR, ZIP_PDF_NAME);
  const qtyPath = path.join(OUT_DIR, QTY_PDF_NAME);
  const zipPath = path.join(OUT_DIR, "phase35-duplicate-package.zip");

  fs.writeFileSync(manualPath, createTextPdf(manualPdfLines));
  fs.writeFileSync(zipPdfPath, createTextPdf(zipPdfLines));
  fs.writeFileSync(qtyPath, createTextPdf(qtyPdfLines));

  const zip = new JSZip();
  zip.file(`drawings/${ZIP_PDF_NAME}`, fs.readFileSync(zipPdfPath));
  zip.file(`drawings/${QTY_PDF_NAME}`, fs.readFileSync(qtyPath));
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));

  const manifest = {
    manualPdf: manualPath,
    zipPdf: zipPdfPath,
    qtyPdf: qtyPath,
    zipPackage: zipPath,
    drawingIdentity: "BB4401",
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  console.log("QA fixtures written to:", OUT_DIR);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
