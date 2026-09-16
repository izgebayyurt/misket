import { useQuery } from "@tanstack/react-query";
import * as api from "@/api/analysis";
import { keys } from "./keys";

/** Code frequency table, optionally restricted to a set of documents. */
export function useCodeFrequencies(documentIds: string[]) {
  return useQuery({
    queryKey: keys.codeFrequencies(documentIds),
    queryFn: () => api.codeFrequencies(documentIds),
    placeholderData: (prev) => prev,
  });
}

/** Co-occurrence matrix, optionally restricted to a set of documents. */
export function useCoOccurrence(documentIds: string[]) {
  return useQuery({
    queryKey: keys.coOccurrence(documentIds),
    queryFn: () => api.coOccurrence(documentIds),
    placeholderData: (prev) => prev,
  });
}

/** Excerpt counts per document and code (direct tags only). */
export function useCodeByDocument() {
  return useQuery({ queryKey: keys.codeByDocument, queryFn: api.codeByDocument });
}
