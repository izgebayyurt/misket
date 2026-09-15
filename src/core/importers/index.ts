import { importText } from "./text";
import { importMarkdown } from "./markdown";
import { importDocx } from "./docx";

export interface ImportedDocument {
  name: string;
  sourceFormat: string;
  text: string;
}

export const SUPPORTED_EXTENSIONS = ["txt", "md", "markdown", "docx"] as const;

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

/** Parse a file's bytes into plain text according to its extension. */
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
    default:
      throw new Error(`Unsupported file type ".${ext}". Supported: txt, md, docx.`);
  }
}
