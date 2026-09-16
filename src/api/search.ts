import { invoke } from "./client";
import type { SearchHit } from "./types";

/** `stem`: match whole words by stem (see `crates/misket-core/src/text/stem.rs`
 * and `src/core/stem.ts`) instead of a literal substring. */
export const searchProject = (query: string, limit = 200, stem = false) =>
  invoke<SearchHit[]>("search_project", { query, limit, stem });
