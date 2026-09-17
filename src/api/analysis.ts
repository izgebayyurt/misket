import { invoke } from "./client";
import type {
  CodeByDescriptor,
  CodeByDocument,
  CodeFrequency,
  CoOccurrence,
  CrosstabRequest,
  ExcerptFilter,
  TimelineBucket,
  WeightSummary,
  WordFrequency,
  WordFrequencyOptions,
  WordFrequencyScope,
} from "./types";

/**
 * `documentIds` null or empty means "every document". `documentSetIds` is
 * unioned into `documentIds` on the Rust side, exactly like the excerpt
 * browser: a set that is picked but empty (or unknown) matches nothing.
 * `coderIds` null or empty means "everyone".
 *
 * Every count is over distinct (excerpt, code) pairs, so a passage two people
 * coded the same way counts once whoever is included.
 */
export const codeFrequencies = (
  documentIds?: string[] | null,
  documentSetIds?: string[] | null,
  coderIds?: string[] | null,
) =>
  invoke<CodeFrequency[]>("code_frequencies", {
    documentIds: documentIds ?? null,
    documentSetIds: documentSetIds ?? null,
    coderIds: coderIds ?? null,
  });
export const coOccurrence = (
  documentIds?: string[] | null,
  documentSetIds?: string[] | null,
  coderIds?: string[] | null,
) =>
  invoke<CoOccurrence>("co_occurrence", {
    documentIds: documentIds ?? null,
    documentSetIds: documentSetIds ?? null,
    coderIds: coderIds ?? null,
  });
export const codeByDocument = (coderIds?: string[] | null) =>
  invoke<CodeByDocument>("code_by_document", { coderIds: coderIds ?? null });

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

/** Summary statistics for one weighted code's codings, scoped like the
 * excerpt browser. */
export const weightSummary = (codeId: string, filter: ExcerptFilter) =>
  invoke<WeightSummary>("weight_summary", { codeId, filter });
