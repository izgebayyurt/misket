import { invoke } from "./client";
import type { CodebookImportMode, ImportReport } from "./types";

/** Reads `path` (JSON or CSV, sniffed on the Rust side) and imports it. */
export const importCodebook = (path: string, mode: CodebookImportMode, parentId?: string | null) =>
  invoke<ImportReport>("import_codebook", { path, mode, parentId: parentId ?? null });
