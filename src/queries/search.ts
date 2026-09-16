import { useQuery } from "@tanstack/react-query";
import * as api from "@/api/search";
import { keys } from "./keys";

/** Project-wide search. Pass an already-debounced query; an empty/whitespace
 * query resolves to no results without a round trip. `stem` matches whole
 * words by stem instead of a literal substring ("Match word forms"). */
export function useProjectSearch(query: string, stem = false) {
  const q = query.trim();
  return useQuery({
    queryKey: keys.search(q, stem),
    queryFn: () => api.searchProject(q, undefined, stem),
    enabled: q.length > 0,
    placeholderData: (prev) => prev,
  });
}
