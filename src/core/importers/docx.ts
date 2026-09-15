import mammoth from "mammoth";

/** Word documents: paragraph text only (tables and footnotes are dropped in M1). */
export async function importDocx(bytes: Uint8Array): Promise<string> {
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  // mammoth's browser build reads `arrayBuffer`; its Node build (used by
  // Vitest) reads `buffer` and accepts an ArrayBuffer there too.
  const input = { arrayBuffer, buffer: arrayBuffer } as unknown as { arrayBuffer: ArrayBuffer };
  const result = await mammoth.extractRawText(input);
  // mammoth separates paragraphs with two newlines; collapse to one so the
  // document view's one-paragraph-per-line model holds.
  return result.value.replace(/\n\n/g, "\n").replace(/\n+$/, "\n");
}
