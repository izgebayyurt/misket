import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readSourceFile } from "@/api/project";
import { listDocuments } from "@/api/documents";
import {
  baseName,
  imageMimeForPath,
  IMAGE_EXTENSIONS,
  importFile,
  SUPPORTED_EXTENSIONS,
  TEXT_EXTENSIONS,
  type ImportedDocument,
} from "@/core/importers";
import { configurePdfWorker } from "@/core/importers/pdf";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

configurePdfWorker(pdfWorkerUrl);
import { useCreateDocument, useCreateImageDocument } from "@/queries/documents";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";
import { isAppError } from "@/api/client";
import { historyBeginGroup, historyEndGroup } from "@/api/history";
import { analyzeWhitespace, tidyText } from "@/core/importers/tidy";
import { loadRememberedTidyChoice, useTidyPromptStore, type TidyChoice } from "@/state/tidyPrompt";
import { looksScanned, scannedPdfMessage } from "@/core/importers/pdfQuality";
import { OcrCancelledError, ocrPdf } from "@/core/importers/pdfOcr";
import { useOcrPromptStore, type OcrDecision } from "@/state/ocrPrompt";
import { useOcrProgressStore } from "@/state/ocrProgress";
import { prepareOcrRuntime } from "./ocrRuntime";
import { useSettings } from "@/state/settings";

/** `sourceFormat` for a PDF whose text came from OCR rather than a text
 * layer — the DocumentList format badge shows this as "OCR". */
const OCR_SOURCE_FORMAT = "pdf-ocr";

/** A file that has been read and is ready to become a document. */
type Planned =
  | { kind: "text"; path: string; parsed: ImportedDocument }
  | { kind: "image"; path: string; name: string; mime: string; width: number; height: number };

/** Import files by path: read bytes, parse or measure, and create documents. */
export function useImportFiles() {
  const create = useCreateDocument();
  const createImage = useCreateImageDocument();
  const openDocument = useWorkspace((s) => s.openDocument);

  const importPaths = useCallback(
    async (paths: string[]) => {
      let lastId: string | null = null;
      let imported = 0;
      const taken = new Set((await listDocuments()).map((d) => d.name));
      let planned: Planned[] = [];
      for (const path of paths) {
        try {
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

      const { kept: withOcrDecided, ocrCount, skipped } = await resolveScannedPdfs(planned);
      planned = withOcrDecided;
      for (const name of skipped) toast.info(`Skipped ${name}: no text was imported.`);

      await maybeTidy(
        planned
          .filter((f): f is Extract<Planned, { kind: "text" }> => f.kind === "text")
          .map((f) => f.parsed),
      );

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
            if (file.kind === "image") {
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
      if (ocrCount > 0) {
        toast.info(
          ocrCount === 1
            ? "Recognised text in 1 scanned PDF with OCR."
            : `Recognised text in ${ocrCount} scanned PDFs with OCR.`,
        );
      }
      if (imported > 0 && lastId) openDocument(lastId);
    },
    [create, createImage, openDocument],
  );

  const pickAndImport = useCallback(async () => {
    const picked = await open({
      multiple: true,
      directory: false,
      filters: [
        { name: "Documents and images", extensions: [...SUPPORTED_EXTENSIONS] },
        { name: "Documents", extensions: [...TEXT_EXTENSIONS] },
        { name: "Images", extensions: [...IMAGE_EXTENSIONS] },
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
    isPending: create.isPending || createImage.isPending,
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
 * For every PDF in the batch that looks scanned (see `pdfQuality.ts`), ask
 * what to do: recognise it with OCR, import the (empty or sparse) text that
 * was found, or skip it. Asked once per file, but a choice can be applied to
 * the rest of the batch so a folder full of scanned PDFs doesn't mean a
 * dialog per page. Runs before `maybeTidy` so tidy sees the final text,
 * including whatever OCR produced.
 */
async function resolveScannedPdfs(
  planned: Planned[],
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
        toast.info(`OCR cancelled for ${file.parsed.name}; imported the text that was found.`);
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
  return file.kind === "image" ? file.name : file.parsed.name;
}

/** "name", then "name (2)", "name (3)"… until unused. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
}
