import { importText } from "./text";

/**
 * Markdown is stored and displayed as raw text in milestone 1 so that excerpt
 * offsets map one-to-one onto what the coder sees.
 */
export function importMarkdown(bytes: Uint8Array): string {
  return importText(bytes);
}
