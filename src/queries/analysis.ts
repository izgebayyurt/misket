import { useQuery } from "@tanstack/react-query";
import * as api from "@/api/analysis";
import { keys } from "./keys";

/**
 * Code frequency table, optionally restricted to a set of documents (by id,
 * by document set, or both — unioned).
 */
export function useCodeFrequencies(documentIds: string[], documentSetIds: string[] = []) {
  return useQuery({
    queryKey: keys.codeFrequencies(documentIds, documentSetIds),
    queryFn: () => api.codeFrequencies(documentIds, documentSetIds),
    placeholderData: (prev) => prev,
  });
}

/**
 * Co-occurrence matrix, optionally restricted to a set of documents (by id,
 * by document set, or both — unioned).
 */
export function useCoOccurrence(documentIds: string[], documentSetIds: string[] = []) {
  return useQuery({
    queryKey: keys.coOccurrence(documentIds, documentSetIds),
    queryFn: () => api.coOccurrence(documentIds, documentSetIds),
    placeholderData: (prev) => prev,
  });
}

/** Excerpt counts per document and code (direct tags only). */
export function useCodeByDocument() {
  return useQuery({ queryKey: keys.codeByDocument, queryFn: api.codeByDocument });
}
