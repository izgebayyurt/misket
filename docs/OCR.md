# OCR for scanned PDFs

Misket extracts text from PDFs with `pdfjs-dist` (`src/core/importers/pdf.ts`).
A PDF that is really a scan — a stack of page images with no text layer — has
nothing for that extractor to find, which used to mean importing a silently
empty document. Misket now detects that case and offers to recognise the text
with on-device OCR instead.

## Detection

After extraction, `src/core/importers/pdfQuality.ts` classifies the PDF from
its per-page character counts:

- **text** — a normal PDF; imported as before.
- **empty** — no page has any extracted text at all.
- **sparse** — either more than half the pages are empty, or the average is
  under ~20 characters per page (a PDF where every page has a stray caption
  or watermark but nothing substantive).

`empty` and `sparse` both count as "looks scanned" (`looksScanned()`).

## The import dialog

For each PDF that looks scanned, the import flow shows a dialog:

> This PDF looks scanned: N of M pages have no text layer.

with three choices:

- **Recognise text (OCR)** — render every page and read it with Tesseract.
- **Import what was found** — keep whatever (possibly empty) text
  `pdfjs-dist` extracted.
- **Skip** — don't import this file at all.

Importing several scanned PDFs at once shows the dialog once per file, but
"Apply to the rest of this import" carries the choice through the rest of
that batch (a folder full of scans is one decision, not one per page). This
is remembered only for the current import — not saved across sessions, the
way the whitespace-tidy prompt's choice is.

Choosing OCR shows a progress dialog ("Page x of N") with a Cancel button. A
page in flight always finishes recognising (tesseract.js has no way to abort
mid-page); cancelling stops before the next page starts and imports whatever
text was recognised so far.

## Recognition

`src/core/importers/pdfOcr.ts` renders each page to an in-memory `<canvas>`
at 200 DPI with `pdfjs-dist` and recognises it page by page with
[tesseract.js](https://github.com/naptha/tesseract.js), then joins the pages
the same way the text importer does: a blank line between pages, no
form-feed characters (`joinPages` in `pdf.ts`, shared by both paths).

The resulting document is created with `sourceFormat: "pdf-ocr"`, which the
document list shows as an **OCR** badge (as opposed to plain **PDF** for a
normal text-layer import).

## Fully offline: nothing is vendored from a CDN

tesseract.js normally pulls its worker script, WebAssembly core and language
data from `cdn.jsdelivr.net` unless told otherwise. Misket vendors all three
into the app bundle instead, under `public/tesseract/` (see
`src/components/documents/ocrRuntime.ts`):

| File                               | What it is                                  | Size    |
| ---------------------------------- | ------------------------------------------- | ------- |
| `worker.min.js`                    | tesseract.js's worker script                | ~110 KB |
| `tesseract-core-simd-lstm.wasm.js` | the Tesseract WASM core (LSTM engine, SIMD) | ~3.9 MB |
| `tessdata/eng.traineddata`         | the bundled English language data           | ~4.0 MB |

That's about 8 MB, comfortably inside the ~15 MB budget for this feature —
see "Bundle size" below for the measured before/after.

`ocrPdf()` always passes explicit `workerPath`, `corePath` and `langPath`
pointing at these local files, so tesseract.js's own CDN fallback (used only
when a path is left unset) is never reached. Verifying this:

- **Grepping the built bundle** for `cdn.jsdelivr.net` or `unpkg.com` _will_
  find hits — inside `dist/tesseract/worker.min.js` (tesseract.js's own
  fallback default) and inside `dist/assets/index-*.js` (a string pulled in
  from tesseract.js's `package.json` `jsdelivr`/`unpkg` fields via its
  `defaultOptions` module). Both are inert: dead default values that are
  always overridden by the explicit paths above, never executed.
- **The real check** is watching the network while OCR runs. Done for this
  change in a headless Xvfb run of the debug build (`ss -tnp` polled for
  non-loopback connections through the whole OCR pass, plus the app's own
  stdout/stderr): zero outbound connections. There is no automated CI check
  for this yet, since Misket has no browser-mode test runner that could watch
  network traffic other than a live app.

## Additional languages

Only `eng` ships with the app, to keep the bundle small. For another
language:

1. Download its `<code>.traineddata` file from
   [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) (the
   integer/fast models — a few MB each, not the ~15 MB "best" ones).
2. Drop it into Misket's tessdata folder. **Settings → OCR languages** shows
   the exact path for your machine (Misket resolves it through Tauri's
   `app_data_dir`, so it varies by OS and by build); it typically looks like:
   - Linux: `~/.local/share/<app id>/tessdata`
   - macOS: `~/Library/Application Support/<app id>/tessdata`
   - Windows: `%APPDATA%\<app id>\tessdata`
3. Reopen Settings (or press its Refresh button) and check the language on.

Checked languages are used together with `eng` on every OCR run from then
on (Tesseract can recognise mixed-language pages, though accuracy is best
when a document is mostly one language). Unchecked files stay on disk and
are just ignored.

Internally, the bundled `eng.traineddata` is copied once into that same
tessdata folder (`ensure_tessdata_file` in
`src-tauri/src/commands/ocr.rs`) so every language — bundled or dropped in —
is served to tesseract.js through one `langPath`, exposed to the webview via
Tauri's asset protocol (`app.security.assetProtocol`, scoped to
`$APPDATA/tessdata/*` in `tauri.conf.json`). Traineddata files are read raw
(`gzip: false`); that's the format tessdata_fast ships them in.

## Bundle size

Measured with `pnpm build` (`dist/`), before this feature and after:

|                                                        | Size   |
| ------------------------------------------------------ | ------ |
| Before (no OCR)                                        | 3.0 MB |
| After (with vendored tesseract.js + `eng.traineddata`) | 11 MB  |
| Increase                                               | ~8 MB  |

Well under the ~15 MB budget. `public/tesseract/` is excluded from
`prettier` (it's vendored, pre-minified) — see `.prettierignore`.

## Tests

- `pdfQuality.test.ts` — classification from synthetic per-page character
  counts, plus the dialog message wording.
- `pdf.test.ts` — `joinPages`, shared by the text and OCR import paths.
- `importers.test.ts` — a real (tiny, ~2 KB) scanned-PDF fixture
  (`fixtures/scanned.pdf`) classifies as `empty` through the actual pdf.js
  extraction path, and keeps its bytes for a possible OCR pass.
- `pdfOcr.test.ts` — an integration test of the vendored OCR runtime itself:
  it points tesseract.js's Node worker at the exact `eng.traineddata` and
  `tesseract-core-simd-lstm.wasm.js` files this app bundles and checks they
  recognise a known short string from a tiny fixture (`fixtures/ocr-sample.png`).
  Runs in under 2 seconds as a real `node` subprocess (not in-process:
  tesseract.js's Node worker resolves its own worker-thread script from
  `import.meta.url`, which Vitest's transform would otherwise rewrite into an
  unusable virtual URL). It does not exercise `ocrPdf()` itself — jsdom has
  neither a real `Worker` nor a real `<canvas>` 2D context, so the pdf.js
  page-to-canvas rendering step can't run here. That step, and the dialog and
  progress UI around it, were instead checked by hand against the debug
  build under Xvfb (see this branch's hand-back notes for screenshots).

## A WebKitGTK quirk

`ocrPdf()` passes `workerBlobURL: false` to `createWorker`. tesseract.js's
default (`true`) wraps its worker script in a `Blob` and spawns the worker
from a `blob:` URL; under WebKitGTK (the Linux Tauri webview) the _second_,
inner `importScripts` call that loads the WASM core from inside that
blob-URL worker hung indefinitely — no error, no progress, no network
activity — every time it was tried, even though the same call succeeds fine
from a worker spawned directly from the same-origin `workerPath`. Since
`workerPath` is already same-origin, there is no upside to the blob
indirection here, so it is turned off rather than chased further.

## Known limitations

- OCR runs on the main thread's behalf but inside tesseract.js's own worker;
  a very long scanned PDF can still take minutes (Tesseract's LSTM engine
  processes roughly one page per second on typical hardware at 200 DPI).
- Rotated or skewed scans, handwriting and non-Latin scripts without their
  traineddata installed will recognise poorly or not at all — this is a
  limitation of Tesseract itself, not something Misket layers on top of it.
- There is no per-language accuracy tuning (PSM mode, DPI) exposed yet; 200
  DPI and Tesseract's default page segmentation are used for every page.
