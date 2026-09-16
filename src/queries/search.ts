import { useQuery } from "@tanstack/react-query";
import * as api from "@/api/search";
import { keys } from "./keys";

/** Project-wide search. Pass an already-debounced query; an empty/whitespace
 * query resolves to no results without a round trip. */
export function useProjectSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: keys.search(q),
    queryFn: () => api.searchProject(q),
    enabled: q.length > 0,
    placeholderData: (prev) => prev,
  });
}
