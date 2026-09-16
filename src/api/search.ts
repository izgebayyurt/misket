import { invoke } from "./client";
import type { SearchHit } from "./types";

/** `regex`: treat `query` as a regular expression (case-sensitive; use an
 * inline `(?i)` for case-insensitive) instead of a plain substring. */
export const searchProject = (query: string, limit = 200, regex = false) =>
  invoke<SearchHit[]>("search_project", { query, limit, regex });
