import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readSourceFile } from "@/api/project";
import { listDocuments, stageMediaProbe } from "@/api/documents";
import { probeUrl } from "@/api/media";
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

/** A file that has been read and is ready to become a document. */
type Planned =
  | { kind: "text"; path: string; parsed: ImportedDocument }
  | { kind: "image"; path: string; name: string; mime: string; width: number; height: number }
  | { kind: "media"; path: string; name: string; mime: string; media: MediaInfo };

/** Import files by path: read bytes, parse or measure, and create documents. */
export function useImportFiles() {
  const create = useCreateDocument();
  const createImage = useCreateImageDocument();
  const createMedia = useCreateMediaDocument();
  const openDocument = useWorkspace((s) => s.openDocument);

  const importPaths = useCallback(
    async (paths: string[]) => {
      let lastId: string | null = null;
      let imported = 0;
      const taken = new Set((await listDocuments()).map((d) => d.name));
      const planned: Planned[] = [];
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
              toast.error(new Error(unsupportedHint(name, extensionOf(path))));
              continue;
            }
            taken.add(name);
            planned.push({ kind: "media", path, name, mime: media.mime, media });
            continue;
          }
          const bytes = await readSourceFile(path);
          const mime = imageMimeForPath(path);
          if (mime) {
            const { width, height } = await readImageSize(bytes, mime);
            const name = uniqueName(baseName(path), taken);
            taken.add(name);
            if (bytes.length > 20_000_000) {
              toast.info(
                `${name} is ${Math.round(bytes.length / 1_000_000)} MB; it is copied into the project file.`,
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
        if (!choice.import) return;
        copyIntoProject = choice.copyIntoProject;
      }

      // A batch of files is one thing the user did, so it is one step to
      // undo — however many documents it creates. Always closed, or the next
      // edit would be swallowed into the import.
      if (planned.length) {
        const what =
          planned.length === 1
            ? `Imported "${nameOf(planned[0]!)}"`
            : `Imported ${planned.length} documents`;
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
            } else {
              if (file.parsed.text.length > 2_000_000) {
                toast.info(`${file.parsed.name} is very large; the document view may be slow.`);
              }
              const doc = await create.mutateAsync({
                name: file.parsed.name,
                sourcePath: file.path,
                sourceFormat: file.parsed.sourceFormat,
                text: file.parsed.text,
              });
              lastId = doc.id;
            }
            imported++;
          } catch (e) {
            if (isAppError(e, "Conflict")) {
              toast.info(
                `Skipped ${file.path.split(/[\\/]/).pop()}: identical document already imported.`,
              );
            } else {
              toast.error(e);
            }
          }
        }
      } finally {
        if (planned.length) await historyEndGroup();
      }
      if (imported > 0 && lastId) openDocument(lastId);
    },
    [create, createImage, createMedia, openDocument],
  );

  const pickAndImport = useCallback(async () => {
    const picked = await open({
      multiple: true,
      directory: false,
      filters: [
        { name: "Everything Misket reads", extensions: [...SUPPORTED_EXTENSIONS] },
        { name: "Documents", extensions: [...TEXT_EXTENSIONS] },
        { name: "Images", extensions: [...IMAGE_EXTENSIONS] },
        { name: "Audio and video", extensions: [...MEDIA_EXTENSIONS] },
      ],
    });
    if (!picked) return;
    await importPaths(Array.isArray(picked) ? picked : [picked]);
  }, [importPaths]);

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
          : reject(new Error("The image has no size."));
      img.onerror = () => reject(new Error("This image could not be read."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
  const element = isVideoMime(probe.mime)
    ? document.createElement("video")
    : document.createElement("audio");
  element.preload = "metadata";
  element.src = probeUrl(probe.token);
  const measured = await new Promise<{ durationMs: number; width: number; height: number } | null>(
    (resolve) => {
      const done = (value: { durationMs: number; width: number; height: number } | null) => {
        element.removeAttribute("src");
        element.load();
        resolve(value);
      };
      element.addEventListener("loadedmetadata", () => {
        const seconds = element.duration;
        if (!Number.isFinite(seconds) || seconds <= 0) {
          done(null);
          return;
        }
        done({
          durationMs: Math.round(seconds * 1000),
          width: (element as HTMLVideoElement).videoWidth ?? 0,
          height: (element as HTMLVideoElement).videoHeight ?? 0,
        });
      });
      element.addEventListener("error", () => done(null));
      // A container the decoder chews on forever is a failure too.
      setTimeout(() => done(null), 20_000);
    },
  );
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
