import { invoke } from "./client";
import type { SearchHit } from "./types";

export const searchProject = (query: string, limit = 200) =>
  invoke<SearchHit[]>("search_project", { query, limit });
