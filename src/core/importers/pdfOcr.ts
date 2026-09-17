import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";
import { joinPages } from "./pdf";

/** Where the tesseract.js runtime lives — vendored into the app bundle so it
 * never reaches out to a CDN (see `docs/OCR.md`). */
export interface OcrAssetPaths {
  workerPath: string;
  corePath: string;
  /** A directory: tesseract.js fetches `${langPath}/${lang}.traineddata`
   * from it (raw, not gzipped — see `ocrPdf`'s `gzip: false`). */
  langPath: string;
}

export interface OcrProgress {
  /** 1-based, matching how the progress dialog counts pages. */
  page: number;
  pages: number;
}

export interface OcrOptions {
  paths: OcrAssetPaths;
  /** Tesseract language codes to load, e.g. `["eng"]` or `["eng", "tur"]`.
   * Defaults to `["eng"]`, the language bundled with the app. */
  languages?: string[];
  /** Pixels per inch to render each page at before recognition. Tesseract's
   * LSTM engine is tuned for roughly this resolution; much higher is mostly
   * wasted time, much lower loses accuracy on small type. */
  dpi?: number;
  onProgress?: (progress: OcrProgress) => void;
  /** Checked between pages (recognition of the current page still runs to
   * completion — tesseract.js has no way to abort mid-recognise). */
  signal?: AbortSignal;
}

const DEFAULT_DPI = 200;
const PDF_POINTS_PER_INCH = 72;

/** Thrown when `options.signal` is aborted between pages. */
export class OcrCancelledError extends Error {
  constructor() {
    super("OCR cancelled");
    this.name = "OcrCancelledError";
  }
}

/**
 * Render each page of a scanned PDF to a canvas and recognise it with
 * tesseract.js, page by page, then join the results the same way the text
 * importer joins pages (a blank line between pages, see `joinPages`).
 */
export async function ocrPdf(bytes: Uint8Array, options: OcrOptions): Promise<string> {
  const { paths, languages = ["eng"], dpi = DEFAULT_DPI, onProgress, signal } = options;
  const scale = dpi / PDF_POINTS_PER_INCH;

  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const doc = await task.promise;
  const worker = await createWorker(languages, undefined, {
    workerPath: paths.workerPath,
    corePath: paths.corePath,
    langPath: paths.langPath,
    // A plain same-origin Worker rather than a blob-wrapped one: the second,
    // inner `importScripts` that loads the WASM core (see `getCore` in
    // tesseract.js) hangs indefinitely from within a blob: worker under
    // WebKitGTK, presumably a CSP/origin quirk specific to that combination.
    workerBlobURL: false,
    // Traineddata files are shipped raw (bundled `eng`, and whatever the
    // person drops into the tessdata folder) — see docs/OCR.md.
    gzip: false,
  });

  const pageTexts: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      if (signal?.aborted) throw new OcrCancelledError();

      const page = await doc.getPage(p);
      try {
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("This browser cannot render a PDF page to a canvas.");
        }
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const {
          data: { text },
        } = await worker.recognize(canvas);
        pageTexts.push(text.trim());
      } finally {
        page.cleanup();
      }

      onProgress?.({ page: p, pages: doc.numPages });
      if (signal?.aborted) throw new OcrCancelledError();
    }
  } finally {
    await worker.terminate();
    await task.destroy();
  }

  return joinPages(pageTexts);
}
