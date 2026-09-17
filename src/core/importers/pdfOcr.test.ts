import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

// jsdom has no Worker and no real <canvas> 2D context, so `ocrPdf` itself
// (which renders a PDF page to a canvas with pdf.js before recognising it)
// can't run here — that path is exercised by hand against the debug build
// under Xvfb instead (see docs/OCR.md and this branch's hand-back notes for
// screenshots). What *can* run in plain Node, using tesseract.js's own Node
// worker rather than the browser one, is the actual OCR engine: this test
// points it at the exact files Misket vendors and bundles — the same
// `tesseract-core-simd-lstm.wasm.js` and `eng.traineddata` shipped under
// `public/tesseract/` — and checks they recognise a known short string
// correctly. That is the part most likely to silently break (a bad vendor
// copy, a corrupted traineddata file, a version mismatch) and the part this
// project has no other automated coverage for.
//
// It runs as a real `node` subprocess rather than in-process: tesseract.js's
// Node worker resolves its own worker-thread script from `import.meta.url`,
// which Vitest's module transform rewrites into a virtual dev-server URL
// that `node:worker_threads` can't load. A plain subprocess sidesteps that
// entirely and is also closer to how the shipped app actually spawns it.
//
// `cacheMethod: "none"` matters here beyond speed: tesseract.js's Node
// adapter otherwise writes a `<lang>.traineddata` cache file into the
// current working directory, which would leave a stray multi-megabyte file
// in the repo root on every run.
describe("the vendored OCR runtime", () => {
  it("recognises text from the bundled eng.traineddata and WASM core", () => {
    const require = createRequire(import.meta.url);
    const root = path.resolve(__dirname, "../../..");
    const coreDir = path.dirname(
      require.resolve("tesseract.js-core/tesseract-core-simd-lstm.wasm.js"),
    );
    const langPath = path.join(root, "public/tesseract/tessdata");
    const corePath = path.join(coreDir, "tesseract-core-simd-lstm.wasm.js");
    const fixture = path.join(root, "fixtures/ocr-sample.png");

    const script = `
        const { createWorker } = require(${JSON.stringify(require.resolve("tesseract.js"))});
        (async () => {
          const worker = await createWorker(["eng"], undefined, {
            langPath: ${JSON.stringify(langPath)},
            corePath: ${JSON.stringify(corePath)},
            gzip: false,
            cacheMethod: "none",
          });
          try {
            const { data } = await worker.recognize(${JSON.stringify(fixture)});
            process.stdout.write(JSON.stringify(data.text));
          } finally {
            await worker.terminate();
          }
        })().catch((e) => { console.error(e); process.exit(1); });
      `;

    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
    });

    expect(result.status, result.stderr).toBe(0);
    const text = JSON.parse(result.stdout.trim()) as string;
    expect(text.trim()).toBe("Misket OCR test");
  }, 25_000);
});
