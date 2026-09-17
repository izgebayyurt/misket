import { convertFileSrc } from "@tauri-apps/api/core";
import { ensureTessdataFile, listTessdataLanguages } from "@/api/ocr";
import type { OcrAssetPaths } from "@/core/importers/pdfOcr";

/**
 * Everything tesseract.js needs is vendored under `public/tesseract/` so it
 * never reaches out to a CDN — see `docs/OCR.md`. These are root-relative
 * static paths (not bundler imports): Vite copies `public/` verbatim, so
 * they resolve the same way in dev and in the built app.
 */
const WORKER_PATH = "/tesseract/worker.min.js";
const CORE_PATH = "/tesseract/tesseract-core-simd-lstm.wasm.js";
const BUNDLED_ENG_URL = "/tesseract/tessdata/eng.traineddata";

let seededEngDir: Promise<string> | null = null;

/**
 * Copy the bundled `eng.traineddata` into the same folder a dropped-in
 * language file lives in (the app data dir's `tessdata` folder), so both can
 * be served to tesseract.js through one `langPath`. A no-op after the first
 * run, on either side: the backend skips the write if the file is already
 * there, and this module caches the promise for the life of the session.
 */
function ensureEngSeeded(): Promise<string> {
  seededEngDir ??= (async () => {
    const res = await fetch(BUNDLED_ENG_URL);
    if (!res.ok) {
      throw new Error(`Could not load the bundled OCR language data (HTTP ${res.status}).`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return ensureTessdataFile("eng.traineddata", bytes);
  })();
  return seededEngDir;
}

/**
 * The asset paths and resolved language list `ocrPdf` needs: `eng` is
 * always included (and seeded into the tessdata folder on first use);
 * `wantedLanguages` (from Settings) are included only for the ones that
 * actually have a `<code>.traineddata` file sitting in that folder.
 */
export async function prepareOcrRuntime(
  wantedLanguages: string[],
): Promise<{ paths: OcrAssetPaths; languages: string[] }> {
  const [dir, info] = await Promise.all([ensureEngSeeded(), listTessdataLanguages()]);
  const available = new Set(info.languages);
  const languages = ["eng", ...wantedLanguages.filter((lang) => available.has(lang))];
  return {
    paths: {
      workerPath: WORKER_PATH,
      corePath: CORE_PATH,
      langPath: convertFileSrc(dir),
    },
    languages,
  };
}
