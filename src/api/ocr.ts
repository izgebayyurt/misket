import { invoke } from "./client";

export interface TessdataInfo {
  /** Absolute path to the tessdata folder, for display in Settings. */
  dir: string;
  /** Extra language codes found there (never includes "eng", which is
   * bundled with the app and always available). */
  languages: string[];
}

/** The extra OCR languages a person has dropped into the tessdata folder. */
export const listTessdataLanguages = () => invoke<TessdataInfo>("list_tessdata_languages");

/**
 * Seed `<tessdata dir>/<filename>` with `bytes` if it isn't already there.
 * Used once to copy the bundled `eng.traineddata` into the same folder a
 * dropped-in language lives in, so OCR can serve every language through one
 * asset-protocol URL. Returns the tessdata directory path.
 */
export const ensureTessdataFile = (filename: string, bytes: Uint8Array) =>
  invoke<string>("ensure_tessdata_file", { filename, dataBase64: bytesToBase64(bytes) });

/** `btoa` chokes on very large arguments passed via the spread operator, so
 * encode in chunks. */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
