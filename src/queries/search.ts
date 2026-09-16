import { useQuery } from "@tanstack/react-query";
import * as api from "@/api/search";
import { keys } from "./keys";

/** Project-wide search. Pass an already-debounced query; an empty/whitespace
 * query resolves to no results without a round trip. With `regex` true,
 * `query` is a regular expression rather than a plain substring. */
export function useProjectSearch(query: string, regex = false) {
  const q = query.trim();
  return useQuery({
    queryKey: [...keys.search(q), regex],
    queryFn: () => api.searchProject(q, 200, regex),
    enabled: q.length > 0,
    placeholderData: (prev) => prev,
  });
}
