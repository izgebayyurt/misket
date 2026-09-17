import { invoke } from "./client";
import type { RefiExportReport, RefiImportMode, RefiImportReport, RefiPreview } from "./types";

/** Write the whole project as a REFI-QDA `.qdpx`. */
export const exportRefi = (path: string) => invoke<RefiExportReport>("export_refi", { path });

/** What importing `path` would bring in. Reads the file, writes nothing. */
export const refiPreview = (path: string) => invoke<RefiPreview>("refi_preview", { path });

/** Import it, as one undoable step. */
export const importRefi = (path: string, mode: RefiImportMode) =>
  invoke<RefiImportReport>("import_refi", { path, mode });
