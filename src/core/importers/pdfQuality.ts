/**
 * Classify a PDF's text layer from per-page character counts, so the import
 * flow can tell a normal PDF from a scanned one and offer OCR instead of
 * silently importing an empty or near-empty document.
 */

export type PdfQualityClass = "text" | "empty" | "sparse";

export interface PdfQualityStats {
  classification: PdfQualityClass;
  totalPages: number;
  /** Pages with zero extracted characters. */
  emptyPages: number;
  totalChars: number;
  /** `totalChars / totalPages`, 0 when there are no pages. */
  avgCharsPerPage: number;
}

/** Below this average, a PDF reads as "sparse" even if no single page is empty. */
export const SPARSE_AVG_CHARS_PER_PAGE = 20;

/** Above this fraction of empty pages, a PDF reads as "sparse". */
export const SPARSE_EMPTY_PAGE_FRACTION = 0.5;

/**
 * `pageCharCounts[i]` is the number of non-whitespace characters extracted
 * from page `i + 1`. An empty array (a PDF with no pages at all) classifies
 * as `"empty"`.
 */
export function classifyPdfQuality(pageCharCounts: number[]): PdfQualityStats {
  const totalPages = pageCharCounts.length;
  const totalChars = pageCharCounts.reduce((sum, c) => sum + c, 0);
  const emptyPages = pageCharCounts.filter((c) => c === 0).length;
  const avgCharsPerPage = totalPages === 0 ? 0 : totalChars / totalPages;

  let classification: PdfQualityClass;
  if (totalPages === 0 || totalChars === 0) {
    classification = "empty";
  } else if (
    avgCharsPerPage < SPARSE_AVG_CHARS_PER_PAGE ||
    emptyPages / totalPages > SPARSE_EMPTY_PAGE_FRACTION
  ) {
    classification = "sparse";
  } else {
    classification = "text";
  }

  return { classification, totalPages, emptyPages, totalChars, avgCharsPerPage };
}

/** Whether a PDF is worth offering OCR for. */
export function looksScanned(stats: PdfQualityStats): boolean {
  return stats.classification === "empty" || stats.classification === "sparse";
}

/**
 * The sentence shown in the import dialog for a scanned-looking PDF. Most
 * scanned PDFs have literally empty pages, which is the wording the brief
 * asks for; the rare case where every page has a sliver of text (embedded
 * captions, a watermark) but not enough to be useful gets its own phrasing.
 */
export function scannedPdfMessage(stats: PdfQualityStats): string {
  if (stats.emptyPages > 0) {
    return `This PDF looks scanned: ${stats.emptyPages} of ${stats.totalPages} pages have no text layer.`;
  }
  return `This PDF looks scanned: its ${stats.totalPages} page${
    stats.totalPages === 1 ? "" : "s"
  } have only about ${Math.round(stats.avgCharsPerPage)} characters of text each.`;
}
