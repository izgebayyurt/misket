import { invoke } from "./client";
import type {
  ApplyCodesInput,
  ApplyResult,
  BulkCodeReport,
  ExcerptDetail,
  ExcerptFilter,
  ExcerptPage,
  ExcerptSnapshot,
  ExcerptWithCodes,
  RetagReport,
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

// ------------------------------------------------------- bulk operations

/** Delete many excerpts at once; the snapshots restore them for undo. */
export const deleteExcerpts = (ids: string[]) =>
  invoke<ExcerptSnapshot[]>("delete_excerpts", { ids });
export const addCodesToExcerpts = (ids: string[], codeIds: string[]) =>
  invoke<BulkCodeReport>("add_codes_to_excerpts", { ids, codeIds });
export const removeCodesFromExcerpts = (ids: string[], codeIds: string[]) =>
  invoke<BulkCodeReport>("remove_codes_from_excerpts", { ids, codeIds });
/** Move every excerpt from one code to another, keeping both codes. */
export const retagCode = (fromCodeId: string, toCodeId: string) =>
  invoke<RetagReport>("retag_code", { fromCodeId, toCodeId });
