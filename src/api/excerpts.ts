import { invoke } from "./client";
import type {
  ApplyCodesInput,
  ApplyResult,
  ExcerptDetail,
  ExcerptFilter,
  ExcerptPage,
  ExcerptSnapshot,
  ExcerptWithCodes,
} from "./types";

export const applyCodes = (input: ApplyCodesInput) => invoke<ApplyResult>("apply_codes", { input });
export const listDocumentExcerpts = (documentId: string) =>
  invoke<ExcerptWithCodes[]>("list_document_excerpts", { documentId });
export const getExcerpt = (id: string) => invoke<ExcerptDetail>("get_excerpt", { id });
export const addExcerptCodes = (id: string, codeIds: string[]) =>
  invoke<ExcerptWithCodes>("add_excerpt_codes", { id, codeIds });
export const removeExcerptCode = (id: string, codeId: string) =>
  invoke<ExcerptWithCodes>("remove_excerpt_code", { id, codeId });
export const deleteExcerpt = (id: string) => invoke<ExcerptSnapshot>("delete_excerpt", { id });
export const restoreExcerpt = (snapshot: ExcerptSnapshot) =>
  invoke<ExcerptWithCodes>("restore_excerpt", { snapshot });
export const queryExcerpts = (filter: ExcerptFilter) =>
  invoke<ExcerptPage>("query_excerpts", { filter });
