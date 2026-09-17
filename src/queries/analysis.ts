import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/analysis";
import type {
  CrosstabRequest,
  TimelineBucket,
  WordFrequencyOptions,
  WordFrequencyScope,
} from "@/api/types";
import { keys } from "./keys";

/**
 * Code frequency table, optionally restricted to a set of documents (by id,
 * by document set, or both — unioned).
 */
export function useCodeFrequencies(
  documentIds: string[],
  documentSetIds: string[] = [],
  coderIds: string[] = [],
) {
  return useQuery({
    queryKey: keys.codeFrequencies(documentIds, documentSetIds, coderIds),
    queryFn: () => api.codeFrequencies(documentIds, documentSetIds, coderIds),
    placeholderData: (prev) => prev,
  });
}

/**
 * Co-occurrence matrix, optionally restricted to a set of documents (by id,
 * by document set, or both — unioned).
 */
export function useCoOccurrence(
  documentIds: string[],
  documentSetIds: string[] = [],
  coderIds: string[] = [],
) {
  return useQuery({
    queryKey: keys.coOccurrence(documentIds, documentSetIds, coderIds),
    queryFn: () => api.coOccurrence(documentIds, documentSetIds, coderIds),
    placeholderData: (prev) => prev,
  });
}

/** Excerpt counts per document and code (direct tags only). */
export function useCodeByDocument(coderIds: string[] = []) {
  return useQuery({
    queryKey: keys.codeByDocument(coderIds),
    queryFn: () => api.codeByDocument(coderIds),
  });
}

/** Word frequency table over a document/set/code scope. */
export function useWordFrequencies(scope: WordFrequencyScope, options: WordFrequencyOptions) {
  return useQuery({
    queryKey: keys.wordFrequencies(scope, options),
    queryFn: () => api.wordFrequencies(scope, options),
    placeholderData: (prev) => prev,
  });
}

/** The project's custom word-frequency stop words. */
export function useStopWords() {
  return useQuery({ queryKey: keys.stopWords, queryFn: api.getStopWords, staleTime: 60_000 });
}

/** Replace the project's custom stop-word list. Not undoable — it's a
 * display setting for the word-frequency view, not a coding action. */
export function useSetStopWords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (words: string[]) => api.setStopWords(words),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.stopWords });
      qc.invalidateQueries({ queryKey: ["analysis", "wordFrequencies"] });
    },
  });
}

/** Coding-over-time for one code, bucketed by day/week/month. */
export function useCodeTimeline(
  codeId: string | null,
  includeDescendants: boolean,
  bucket: TimelineBucket,
) {
  return useQuery({
    queryKey: keys.codeTimeline(codeId ?? "", includeDescendants, bucket),
    queryFn: () => api.codeTimeline(codeId!, includeDescendants, bucket),
    enabled: codeId !== null,
    placeholderData: (prev) => prev,
  });
}

/**
 * The code-by-descriptor cross-tab. Disabled until a field is picked, since
 * there is nothing to cross-tabulate against without one.
 */
export function useCodeByDescriptor(request: CrosstabRequest | null) {
  return useQuery({
    queryKey: keys.codeByDescriptor(request ?? { fieldId: "" }),
    queryFn: () => api.codeByDescriptor(request!),
    enabled: !!request?.fieldId,
    placeholderData: (prev) => prev,
  });
}
