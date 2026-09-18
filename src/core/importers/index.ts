import { MEDIA_EXTENSIONS, mediaMimeForExtension } from "../media";
import { importText } from "./text";
import { importMarkdown } from "./markdown";
import { importDocx } from "./docx";
import { extractPdfText } from "./pdf";
import { classifyPdfQuality, type PdfQualityStats } from "./pdfQuality";
import { importSrt } from "./srt";
import { importVtt } from "./vtt";
import type { Anchor } from "../align";

export interface ImportedDocument {
  name: string;
  sourceFormat: string;
  text: string;
  /** Set for PDFs only: whether the text layer looks complete, empty or
   * scanned-and-sparse, and the per-page counts behind that call. Absent for
   * every other format. */
  pdfQuality?: PdfQualityStats;
  /** The original PDF bytes, kept only so a scanned PDF can be re-rendered
   * for OCR if the person chooses "Recognise text". Unused (and dropped)
   * once that decision is made either way. */
  pdfBytes?: Uint8Array;
  /** Set for SRT and VTT only: one alignment anchor per cue, handed to
   * `create_document` so the transcript lines up with its recording the
   * moment the two are linked (`src/core/align.ts`). */
  anchors?: Anchor[];
}

/** Extensions parsed into document text. */
export const TEXT_EXTENSIONS = ["txt", "md", "markdown", "docx", "pdf", "srt", "vtt"] as const;

/** Extensions imported as image documents (coded with rectangle regions). */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

/** Extensions imported as recordings and coded with time ranges, by
 * reference: see `src/core/media.ts`. */
export { MEDIA_EXTENSIONS } from "../media";

export const SUPPORTED_EXTENSIONS = [
  ...TEXT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...MEDIA_EXTENSIONS,
] as const;

const IMAGE_MIMES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** The MIME type for an image extension, or null for anything else. */
export function imageMimeForExtension(ext: string): string | null {
  return IMAGE_MIMES[ext.toLowerCase()] ?? null;
}

/** Whether this path is imported as an image rather than parsed into text. */
export function imageMimeForPath(path: string): string | null {
  return imageMimeForExtension(extensionOf(path));
}

/** Whether this path is imported as a recording, held by reference. */
export function mediaMimeForPath(path: string): string | null {
  return mediaMimeForExtension(extensionOf(path));
}

export function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

export function baseName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot);
}

/**
 * Parse a file's bytes into plain text according to its extension. Images do
 * not go through here (they keep their bytes, see `imageMimeForPath`), and
 * neither do recordings (their bytes are never read at all, see
 * `mediaMimeForPath`).
 */
export async function importFile(path: string, bytes: Uint8Array): Promise<ImportedDocument> {
  const ext = extensionOf(path);
  const name = baseName(path);
  switch (ext) {
    case "txt":
    case "":
      return { name, sourceFormat: "txt", text: importText(bytes) };
    case "md":
    case "markdown":
      return { name, sourceFormat: "md", text: importMarkdown(bytes) };
    case "docx":
      return { name, sourceFormat: "docx", text: await importDocx(bytes) };
    case "srt":
    case "vtt": {
      // Subtitles arrive as a timestamped transcript plus the cue anchors:
      // one paragraph per cue, `[mm:ss] Speaker: text`.
      const parsed = ext === "srt" ? importSrt(bytes) : importVtt(bytes);
      if (parsed.cueCount === 0) {
        throw new Error(
          `No subtitle cues were found in ${name}.${ext}. A cue needs a timing line like "00:00:04,000 --> 00:00:08,200" with its text under it.`,
        );
      }
      return { name, sourceFormat: ext, text: parsed.text, anchors: parsed.anchors };
    }
    case "pdf": {
      // pdf.js hands `data` off to its worker (a real one in the browser, a
      // fake in-thread one in Node/tests) as a transferable, which detaches
      // the original buffer — so a copy is taken first, kept only for a
      // possible later OCR pass.
      const pdfBytes = bytes.slice();
      const { text, pageCharCounts } = await extractPdfText(bytes);
      return {
        name,
        sourceFormat: "pdf",
        text,
        pdfQuality: classifyPdfQuality(pageCharCounts),
        pdfBytes,
      };
    }
    default:
      throw new Error(
        `Unsupported file type ".${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}.`,
      );
  }
}
