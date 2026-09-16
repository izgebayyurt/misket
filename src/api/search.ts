import { invoke } from "./client";
import type { SearchHit } from "./types";

/**
 * `regex`: treat `query` as a regular expression (case-sensitive; use an
 * inline `(?i)` for case-insensitive) instead of a plain substring.
 * `stem`: match whole words by stem (see `crates/misket-core/src/text/stem.rs`
 * and `src/core/stem.ts`) instead of a literal substring. Ignored when
 * `regex` is also true — a regex matches the raw text verbatim.
 */
export const searchProject = (query: string, limit = 200, regex = false, stem = false) =>
  invoke<SearchHit[]>("search_project", { query, limit, regex, stem });
