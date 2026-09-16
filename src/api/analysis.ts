import { invoke } from "./client";
import type { CodeByDocument, CodeFrequency, CoOccurrence } from "./types";

/** `documentIds` null or empty means "every document". */
export const codeFrequencies = (documentIds?: string[] | null) =>
  invoke<CodeFrequency[]>("code_frequencies", { documentIds: documentIds ?? null });
export const coOccurrence = (documentIds?: string[] | null) =>
  invoke<CoOccurrence>("co_occurrence", { documentIds: documentIds ?? null });
export const codeByDocument = () => invoke<CodeByDocument>("code_by_document");
