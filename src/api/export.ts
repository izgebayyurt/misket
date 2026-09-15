import { invoke } from "./client";
import type { ExcerptFilter } from "./types";

export const exportCodebookCsv = (path: string) => invoke<void>("export_codebook_csv", { path });
export const exportExcerptsCsv = (path: string, filter: ExcerptFilter) =>
  invoke<void>("export_excerpts_csv", { path, filter });
export const exportProjectJson = (path: string) => invoke<void>("export_project_json", { path });
