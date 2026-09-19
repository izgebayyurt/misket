import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { readSourceFile } from "@/api/project";
import { listDocuments, stageMediaProbe } from "@/api/documents";
import { loadMediaServer, probeUrl } from "@/api/media";
import {
  baseName,
  extensionOf,
  imageMimeForPath,
  IMAGE_EXTENSIONS,
  importFile,
  mediaMimeForPath,
  MEDIA_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  TEXT_EXTENSIONS,
  type ImportedDocument,
} from "@/core/importers";
import { isVideoMime, unsupportedHint } from "@/core/media";
import type { MediaInfo } from "@/api/types";
import { configurePdfWorker } from "@/core/importers/pdf";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

configurePdfWorker(pdfWorkerUrl);
import {
  useCreateDocument,
  useCreateImageDocument,
  useCreateMediaDocument,
} from "@/queries/documents";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";
import { isAppError } from "@/api/client";
import { historyBeginGroup, historyEndGroup } from "@/api/history";
import { analyzeWhitespace, tidyText } from "@/core/importers/tidy";
import { useMediaImportPrompt, type MediaImportFile } from "@/state/mediaImportPrompt";
import { useSettings } from "@/state/settings";
import { loadRememberedTidyChoice, useTidyPromptStore, type TidyChoice } from "@/state/tidyPrompt";
import { looksScanned, scannedPdfMessage } from "@/core/importers/pdfQuality";
import { OcrCancelledError, ocrPdf } from "@/core/importers/pdfOcr";
import { useOcrPromptStore, type OcrDecision } from "@/state/ocrPrompt";
import { useOcrProgressStore } from "@/state/ocrProgress";
import { prepareOcrRuntime } from "./ocrRuntime";

/** `sourceFormat` for a PDF whose text came from OCR rather than a text
 * layer — the DocumentList format badge shows this as "OCR". */
const OCR_SOURCE_FORMAT = "pdf-ocr";

/** A file that has been read and is ready to become a document. */
type Planned =
  | { kind: "text"; path: string; parsed: ImportedDocument }
  | { kind: "image"; path: string; name: string; mime: string; width: number; height: number }
  | { kind: "media"; path: string; name: string; mime: string; media: MediaInfo };

/** Import files by path: read bytes, parse or measure, and create documents. */
export function useImportFiles() {
  const { t } = useTranslation();
  const create = useCreateDocument();
  const createImage = useCreateImageDocument();
  const createMedia = useCreateMediaDocument();
  const openDocument = useWorkspace((s) => s.openDocument);

  /**
   * Import files by path. Returns the ids of the documents that were
   * created, in order, so a caller can do something with them — "Link
   * recording…" imports a recording and links it to the open transcript in
   * one step, and does not want the view to jump to the recording.
   */
  const importPaths = useCallback(
    async (paths: string[], { openAfter = true }: { openAfter?: boolean } = {}) => {
      const createdIds: string[] = [];
      let lastId: string | null = null;
      let imported = 0;
      const taken = new Set((await listDocuments()).map((d) => d.name));
      let planned: Planned[] = [];
      for (const path of paths) {
        try {
          // A recording is never read into the page: it is measured where it
          // lies and imported by reference, so a 2 GB interview never
          // crosses the IPC bridge.
          const mediaMime = mediaMimeForPath(path);
          if (mediaMime) {
            const name = uniqueName(baseName(path), taken);
            const media = await measureMedia(path);
            if (!media) {
              toast.error(new Error(unsupportedHint(name, extensionOf(path), t)));
              continue;
            }
            taken.add(name);
            planned.push({ kind: "media", path, name, mime: media.mime, media });
            continue;
          }
          const bytes = await readSourceFile(path);
          const mime = imageMimeForPath(path);
          if (mime) {
            const { width, height } = await readImageSize(bytes, mime, t);
            const name = uniqueName(baseName(path), taken);
            taken.add(name);
            if (bytes.length > 20_000_000) {
              toast.info(
                t("documents.importLargeImage", { name, mb: Math.round(bytes.length / 1_000_000) }),
              );
            }
            planned.push({ kind: "image", path, name, mime, width, height });
          } else {
            const parsed = await importFile(path, bytes);
            parsed.name = uniqueName(parsed.name, taken);
            taken.add(parsed.name);
            planned.push({ kind: "text", path, parsed });
          }
        } catch (e) {
          toast.error(e);
        }
      }

      const { kept: withOcrDecided, ocrCount, skipped } = await resolveScannedPdfs(planned, t);
      planned = withOcrDecided;
      for (const name of skipped) toast.info(t("documents.skippedNoText", { name }));

      await maybeTidy(
        planned
          .filter((f): f is Extract<Planned, { kind: "text" }> => f.kind === "text")
          .map((f) => f.parsed),
      );

      // How recordings are stored is asked once for the whole batch.
      const recordings = planned.filter(
        (f): f is Extract<Planned, { kind: "media" }> => f.kind === "media",
      );
      let copyIntoProject = false;
      if (recordings.length) {
        const choice = await useMediaImportPrompt.getState().prompt({
          copyIntoProject: useSettings.getState().settings.copyMediaIntoProject,
          files: recordings.map((f): MediaImportFile => ({
            path: f.path,
            name: f.name,
            mime: f.mime,
            durationMs: f.media.durationMs ?? 0,
            sizeBytes: f.media.sizeBytes ?? 0,
          })),
        });
        if (!choice.import) return createdIds;
        copyIntoProject = choice.copyIntoProject;
      }

      // A batch of files is one thing the user did, so it is one step to
      // undo — however many documents it creates. Always closed, or the next
      // edit would be swallowed into the import.
      if (planned.length) {
        const what =
          planned.length === 1
            ? t("documents.importedOne", { name: nameOf(planned[0]!) })
            : t("documents.importedMany", { count: planned.length });
        await historyBeginGroup(what);
      }
      try {
        for (const file of planned) {
          try {
            if (file.kind === "media") {
              const doc = await createMedia.mutateAsync({
                name: file.name,
                sourcePath: file.path,
                mime: file.mime,
                media: file.media,
                copyIntoProject,
              });
              lastId = doc.id;
              createdIds.push(doc.id);
            } else if (file.kind === "image") {
              // The bytes stay out of the IPC bridge: the backend reads them
              // from `sourcePath` and copies them into the project file.
              const doc = await createImage.mutateAsync({
                name: file.name,
                sourcePath: file.path,
                mime: file.mime,
                width: file.width,
                height: file.height,
              });
              lastId = doc.id;
              createdIds.push(doc.id);
            } else {
              if (file.parsed.text.length > 2_000_000) {
                toast.info(t("documents.veryLargeDocument", { name: file.parsed.name }));
              }
              const doc = await create.mutateAsync({
                name: file.parsed.name,
                sourcePath: file.path,
                sourceFormat: file.parsed.sourceFormat,
                text: file.parsed.text,
                // SRT and VTT arrive with one anchor per cue, so the
                // transcript is aligned the moment it is linked.
                anchors: file.parsed.anchors,
              });
              lastId = doc.id;
              createdIds.push(doc.id);
            }
            imported++;
          } catch (e) {
            if (isAppError(e, "Conflict")) {
              toast.info(t("documents.skippedDuplicate", { name: file.path.split(/[\\/]/).pop() }));
            } else {
              toast.error(e);
            }
          }
        }
      } finally {
        if (planned.length) await historyEndGroup();
      }
      if (ocrCount > 0) {
        toast.info(t("documents.recognisedOcr", { count: ocrCount }));
      }
      if (imported > 0 && lastId && openAfter) openDocument(lastId);
      return createdIds;
    },
    [create, createImage, createMedia, openDocument, t],
  );

  const pickAndImport = useCallback(async () => {
    const picked = await open({
      multiple: true,
      directory: false,
      filters: [
        { name: t("documents.filterEverything"), extensions: [...SUPPORTED_EXTENSIONS] },
        { name: t("documents.filterDocuments"), extensions: [...TEXT_EXTENSIONS] },
        { name: t("documents.filterImages"), extensions: [...IMAGE_EXTENSIONS] },
        { name: t("documents.filterMedia"), extensions: [...MEDIA_EXTENSIONS] },
      ],
    });
    if (!picked) return;
    await importPaths(Array.isArray(picked) ? picked : [picked]);
  }, [importPaths, t]);

  /** Ask for a folder; the caller then lists and imports what is inside it. */
  const pickFolder = useCallback(async () => {
    const picked = await open({ multiple: false, directory: true });
    return typeof picked === "string" ? picked : null;
  }, []);

  return {
    importPaths,
    pickAndImport,
    pickFolder,
    isPending: create.isPending || createImage.isPending || createMedia.isPending,
  };
}

/**
 * The pixel size of an image, decoded in the webview: `createImageBitmap`
 * where it exists, otherwise an `<img>` with an object URL. The backend needs
 * it because it stores the bytes without decoding them.
 */
async function readImageSize(
  bytes: Uint8Array,
  mime: string,
  t: (key: string) => string,
): Promise<{ width: number; height: number }> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      if (size.width > 0 && size.height > 0) return size;
    } catch {
      // Fall through to the <img> path (older webviews, exotic WebP).
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () =>
        img.naturalWidth > 0
          ? resolve({ width: img.naturalWidth, height: img.naturalHeight })
          : reject(new Error(t("documents.imageNoSize")));
      img.onerror = () => reject(new Error(t("documents.imageUnreadable")));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** What `measureElement` reads off a media element once its headers arrive. */
interface Measured {
  durationMs: number;
  width: number;
  height: number;
}

/**
 * Load `url` in a detached media element and read its metadata.
 *
 * The promise settles exactly once, whatever the element does: a media
 * element that cannot load fires `error`, and letting go of the source fires
 * another — so the listeners come off and the result is handed back *before*
 * the source is cleared, or the two would chase each other.
 */
function measureElement(mime: string, url: string): Promise<Measured | null> {
  const element = isVideoMime(mime)
    ? document.createElement("video")
    : document.createElement("audio");
  element.preload = "metadata";
  return new Promise<Measured | null>((resolve) => {
    let settled = false;
    const onMetadata = () => {
      const seconds = element.duration;
      finish(
        Number.isFinite(seconds) && seconds > 0
          ? {
              durationMs: Math.round(seconds * 1000),
              width: (element as HTMLVideoElement).videoWidth ?? 0,
              height: (element as HTMLVideoElement).videoHeight ?? 0,
            }
          : null,
      );
    };
    const onError = () => finish(null);
    // A container the decoder chews on forever is a failure too.
    const timer = setTimeout(() => finish(null), MEASURE_TIMEOUT_MS);
    function finish(value: Measured | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      element.removeEventListener("loadedmetadata", onMetadata);
      element.removeEventListener("error", onError);
      resolve(value);
      try {
        element.removeAttribute("src");
        element.load();
      } catch {
        // Letting go of the file is best effort; the answer is already out.
      }
    }
    element.addEventListener("loadedmetadata", onMetadata);
    element.addEventListener("error", onError);
    element.src = url;
  });
}

/** How long to wait for a decoder to report a file's duration. */
const MEASURE_TIMEOUT_MS = 20_000;

/**
 * What a recording is: its MIME, size, duration and (for video) pixel size.
 *
 * Only a decoder knows a duration, so the file is staged with the backend
 * and loaded through the media protocol — which streams ranges, so the
 * element reads the container's headers and nothing more. `null` means the
 * webview could not decode it: many `.mkv` and `.avi` containers hold codecs
 * WebKit has no business with, and saying so at import is much better than a
 * document that shows a black rectangle.
 */
async function measureMedia(path: string): Promise<MediaInfo | null> {
  let probe;
  try {
    probe = await stageMediaProbe(path);
  } catch {
    return null;
  }
  // A recording is measured through the loopback server, for the same reason
  // it is played through it (`src/api/media.ts`).
  if (!(await loadMediaServer())) return null;
  const url = probeUrl(probe.token);
  if (!url) return null;
  const measured = await measureElement(probe.mime, url);
  if (!measured) return null;
  return {
    mime: probe.mime,
    sizeBytes: probe.sizeBytes,
    durationMs: measured.durationMs,
    ...(measured.width > 0 && measured.height > 0
      ? { width: measured.width, height: measured.height }
      : {}),
  };
}

/**
 * For every PDF in the batch that looks scanned (see `pdfQuality.ts`), ask
 * what to do: recognise it with OCR, import the (empty or sparse) text that
 * was found, or skip it. Asked once per file, but a choice can be applied to
 * the rest of the batch so a folder full of scanned PDFs doesn't mean a
 * dialog per page. Runs before `maybeTidy` so tidy sees the final text,
 * including whatever OCR produced.
 */
async function resolveScannedPdfs(
  planned: Planned[],
  t: (key: string, params?: Record<string, unknown>) => string,
): Promise<{ kept: Planned[]; ocrCount: number; skipped: string[] }> {
  const scanned = planned.filter(
    (f): f is Extract<Planned, { kind: "text" }> =>
      f.kind === "text" && !!f.parsed.pdfQuality && looksScanned(f.parsed.pdfQuality),
  );
  if (scanned.length === 0) return { kept: planned, ocrCount: 0, skipped: [] };

  const toDrop = new Set<Planned>();
  const skipped: string[] = [];
  let ocrCount = 0;
  let remembered: OcrDecision | null = null;

  for (let i = 0; i < scanned.length; i++) {
    const file = scanned[i]!;
    const stats = file.parsed.pdfQuality!;

    let decision: OcrDecision;
    if (remembered) {
      decision = remembered;
    } else {
      const choice = await useOcrPromptStore.getState().prompt({
        file: { name: file.parsed.name, stats, message: scannedPdfMessage(stats) },
        // `message` is structured data (ScannedPdfMessage), not a sentence —
        // OcrPromptDialog turns it into text with `t()`.
        moreInBatch: i < scanned.length - 1,
      });
      decision = choice.decision;
      if (choice.applyToRest) remembered = choice.decision;
    }

    if (decision === "skip") {
      toDrop.add(file);
      skipped.push(file.parsed.name);
      continue;
    }
    if (decision === "as-is") {
      delete file.parsed.pdfBytes;
      continue;
    }

    // decision === "ocr"
    const bytes = file.parsed.pdfBytes;
    if (!bytes) continue; // shouldn't happen: pdfBytes is set alongside pdfQuality
    const controller = new AbortController();
    useOcrProgressStore.getState().start(file.parsed.name, () => controller.abort());
    try {
      const wanted = useSettings.getState().settings.ocrLanguages;
      const { paths, languages } = await prepareOcrRuntime(wanted);
      const text = await ocrPdf(bytes, {
        paths,
        languages,
        onProgress: ({ page, pages }) => useOcrProgressStore.getState().update(page, pages),
        signal: controller.signal,
      });
      file.parsed.text = text;
      file.parsed.sourceFormat = OCR_SOURCE_FORMAT;
      ocrCount++;
    } catch (e) {
      if (e instanceof OcrCancelledError) {
        toast.info(t("documents.ocrCancelled", { name: file.parsed.name }));
      } else {
        toast.error(e);
      }
    } finally {
      delete file.parsed.pdfBytes;
      useOcrProgressStore.getState().finish();
    }
  }

  return { kept: planned.filter((f) => !toDrop.has(f)), ocrCount, skipped };
}

/**
 * If any parsed file has whitespace worth cleaning up, ask once for the
 * whole batch (or use the remembered choice) and tidy every file that needs
 * it in place. Document text is immutable after import, so this must
 * happen before `create_document` is called.
 */
async function maybeTidy(parsed: ImportedDocument[]): Promise<void> {
  const withReports = parsed.map((p) => ({ parsed: p, report: analyzeWhitespace(p.text) }));
  const needing = withReports.filter((f) => f.report.needsTidy);
  if (needing.length === 0) return;

  let choice: TidyChoice | null = loadRememberedTidyChoice();
  if (!choice) {
    choice = await useTidyPromptStore.getState().prompt({
      files: needing.map((f) => ({ name: f.parsed.name, text: f.parsed.text, report: f.report })),
    });
  }
  if (choice.apply) {
    for (const f of needing) {
      f.parsed.text = tidyText(f.parsed.text, choice.options);
    }
  }
}

/** What a planned file will be called once imported. */
function nameOf(file: Planned): string {
  return file.kind === "text" ? file.parsed.name : file.name;
}

/** "name", then "name (2)", "name (3)"… until unused. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
}
