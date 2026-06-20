/**
 * PDF Text Extraction Service
 *
 * Uses pdfjs-dist (v6, fully client-side) to extract raw text from every page
 * of a PDF drawing file. The result is concatenated plain text suitable for
 * rule-based keyword/quantity matching.
 *
 * Constraints:
 * - Browser-only (uses File / ArrayBuffer / canvas APIs).
 * - Only works for PDFs with embedded text layers. Scanned raster PDFs yield
 *   no text — the caller should handle empty results gracefully.
 * - No server round-trip; no paid AI API.
 *
 * Future:
 * - Server-side OCR (Tesseract.js worker or cloud OCR) for scanned drawings.
 */

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  /** True when the PDF appears to have no embedded text layer */
  isLikelyScanned: boolean;
  error?: string;
}

let pdfjsInitialised = false;

async function getPdfjs() {
  // Dynamic import keeps pdfjs out of the SSR bundle entirely.
  const pdfjs = await import("pdfjs-dist");

  if (!pdfjsInitialised) {
    // Serve worker from /public to avoid fake-worker runtime fallback issues.
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    pdfjsInitialised = true;
  }

  return pdfjs;
}

export async function extractPdfText(
  file: File
): Promise<PdfExtractionResult> {
  if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
    return {
      text: "",
      pageCount: 0,
      isLikelyScanned: false,
      error: "Not a PDF file.",
    };
  }

  try {
    const pdfjs = await getPdfjs();
    const arrayBuffer = await file.arrayBuffer();

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(arrayBuffer),
      // Disable range requests — we already have the whole buffer.
      disableRange: true,
      disableStream: true,
    });

    const pdf = await loadingTask.promise;
    const pageCount = pdf.numPages;
    const pageTexts: string[] = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map((item) => {
          // pdfjs text items have a `str` property
          if ("str" in item) return (item as { str: string }).str;
          return "";
        })
        .join(" ");

      pageTexts.push(pageText);
      page.cleanup();
    }

    // Free resources — destroy() is on the loading task, not the proxy.
    await loadingTask.destroy();

    const fullText = pageTexts.join("\n\n--- PAGE BREAK ---\n\n").trim();
    const isLikelyScanned = fullText.length < 50;

    return { text: fullText, pageCount, isLikelyScanned };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error during PDF parsing.";
    return { text: "", pageCount: 0, isLikelyScanned: false, error: message };
  }
}
