import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

/** Where the pdf.js worker lives; set once by the host (browser or tests). */
export function configurePdfWorker(workerSrc: string) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}

/**
 * Text-only PDF import: one paragraph per text line, pages separated by a
 * blank line. Layout, tables and images are dropped (milestone 1 limit).
 */
export async function importPdf(bytes: Uint8Array): Promise<string> {
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const doc = await task.promise;
  const pages: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(linesFromItems(content.items.filter((i): i is TextItem => "str" in i)));
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return pages
    .filter((t) => t.trim().length > 0)
    .join("\n\n")
    .replace(/\n+$/, "")
    .concat("\n");
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
