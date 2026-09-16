import { importText } from "./text";
import { importMarkdown } from "./markdown";
import { importDocx } from "./docx";
import { importPdf } from "./pdf";

export interface ImportedDocument {
  name: string;
  sourceFormat: string;
  text: string;
}

/** Extensions parsed into document text. */
export const TEXT_EXTENSIONS = ["txt", "md", "markdown", "docx", "pdf"] as const;

/** Extensions imported as image documents (coded with rectangle regions). */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

export const SUPPORTED_EXTENSIONS = [...TEXT_EXTENSIONS, ...IMAGE_EXTENSIONS] as const;

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
 * not go through here: they keep their bytes (see `imageMimeForPath`).
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
    case "pdf":
      return { name, sourceFormat: "pdf", text: await importPdf(bytes) };
    default:
      throw new Error(
        `Unsupported file type ".${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}.`,
      );
  }
}
