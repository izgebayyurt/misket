const decoder = new TextDecoder("utf-8", { fatal: false });

/** Plain text; the backend normalizes BOM, line endings and NFC. */
export function importText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
