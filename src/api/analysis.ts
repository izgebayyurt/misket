import { invoke } from "./client";
import type {
  CodeByDescriptor,
  CodeByDocument,
  CodeFrequency,
  CoOccurrence,
  CrosstabRequest,
  TimelineBucket,
  WordFrequency,
  WordFrequencyOptions,
  WordFrequencyScope,
} from "./types";

/**
 * `documentIds` null or empty means "every document". `documentSetIds` is
 * unioned into `documentIds` on the Rust side, exactly like the excerpt
 * browser: a set that is picked but empty (or unknown) matches nothing.
 */
export const codeFrequencies = (documentIds?: string[] | null, documentSetIds?: string[] | null) =>
  invoke<CodeFrequency[]>("code_frequencies", {
    documentIds: documentIds ?? null,
    documentSetIds: documentSetIds ?? null,
  });
export const coOccurrence = (documentIds?: string[] | null, documentSetIds?: string[] | null) =>
  invoke<CoOccurrence>("co_occurrence", {
    documentIds: documentIds ?? null,
    documentSetIds: documentSetIds ?? null,
  });
export const codeByDocument = () => invoke<CodeByDocument>("code_by_document");

export const wordFrequencies = (scope: WordFrequencyScope, options: WordFrequencyOptions) =>
  invoke<WordFrequency[]>("word_frequencies", { scope, options });

export const getStopWords = () => invoke<string[]>("get_stop_words");
export const setStopWords = (words: string[]) => invoke<void>("set_stop_words", { words });

export const codeTimeline = (codeId: string, includeDescendants: boolean, bucket: TimelineBucket) =>
  invoke<[string, number][]>("code_timeline", {
    codeId,
    includeDescendants,
    bucket,
  });

/** Codes against one descriptor field's values (the mixed-methods cross-tab). */
export const codeByDescriptor = (request: CrosstabRequest) =>
  invoke<CodeByDescriptor>("code_by_descriptor", { request });
