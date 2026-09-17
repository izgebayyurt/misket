import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

/** Where the pdf.js worker lives; set once by the host (browser or tests). */
export function configurePdfWorker(workerSrc: string) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}

/** The extracted text of a PDF, plus how many characters came from each page. */
export interface PdfTextExtraction {
  text: string;
  /** Non-whitespace character count per page, in page order — the raw
   * material for `classifyPdfQuality` (see `pdfQuality.ts`). */
  pageCharCounts: number[];
}

/** Join non-empty page texts the same way for both the text and OCR import
 * paths: a blank line between pages, no page-break characters. */
export function joinPages(pages: string[]): string {
  return pages
    .filter((t) => t.trim().length > 0)
    .join("\n\n")
    .replace(/\n+$/, "")
    .concat("\n");
}

/**
 * Text-only PDF import: one paragraph per text line, pages separated by a
 * blank line. Layout, tables and images are dropped (milestone 1 limit).
 * Also reports each page's character count, so the caller can tell a normal
 * PDF from a scanned one with no text layer (see `pdfQuality.ts`).
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextExtraction> {
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const doc = await task.promise;
  const pages: string[] = [];
  const pageCharCounts: number[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const pageText = linesFromItems(content.items.filter((i): i is TextItem => "str" in i));
      pages.push(pageText);
      pageCharCounts.push(pageText.replace(/\s+/g, "").length);
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return { text: joinPages(pages), pageCharCounts };
}

/** Back-compat wrapper for callers that only need the text. */
export async function importPdf(bytes: Uint8Array): Promise<string> {
  return (await extractPdfText(bytes)).text;
}

/** Group positioned text runs into lines by their baseline, in reading order. */
export function linesFromItems(items: TextItem[]): string {
  type Line = { y: number; runs: { x: number; str: string; width: number }[] };
  const lines: Line[] = [];
  for (const item of items) {
    if (!item.str) continue;
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const tol = Math.max(2, (item.height || 10) * 0.5);
    let line = lines.find((l) => Math.abs(l.y - y) <= tol);
    if (!line) {
      line = { y, runs: [] };
      lines.push(line);
    }
    line.runs.push({ x, str: item.str, width: item.width });
  }
  lines.sort((a, b) => b.y - a.y); // PDF y grows upwards: top of page first
  return lines
    .map((l) => {
      l.runs.sort((a, b) => a.x - b.x);
      let out = "";
      let cursor: number | null = null;
      for (const r of l.runs) {
        if (cursor !== null && r.x - cursor > 1 && !out.endsWith(" ") && !r.str.startsWith(" ")) {
          out += " ";
        }
        out += r.str;
        cursor = r.x + r.width;
      }
      return out.replace(/\s+/g, " ").trim();
    })
    .filter((s) => s.length > 0)
    .join("\n");
}
