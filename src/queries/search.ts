import { useQuery } from "@tanstack/react-query";
import * as api from "@/api/search";
import { keys } from "./keys";

/**
 * Project-wide search. Pass an already-debounced query; an empty/whitespace
 * query resolves to no results without a round trip. With `regex` true,
 * `query` is a regular expression rather than a plain substring (and `stem`
 * is ignored — see `search_project`). With `stem` true, matching is by
 * stemmed whole word instead of a literal substring ("Match word forms").
 */
export function useProjectSearch(query: string, regex = false, stem = false) {
  const q = query.trim();
  return useQuery({
    queryKey: keys.search(q, regex, stem),
    queryFn: () => api.searchProject(q, 200, regex, stem),
    enabled: q.length > 0,
    placeholderData: (prev) => prev,
  });
}
