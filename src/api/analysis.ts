import { invoke } from "./client";
import type { CodeByDocument, CodeFrequency, CoOccurrence } from "./types";

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
