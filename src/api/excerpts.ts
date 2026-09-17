import { invoke } from "./client";
import type {
  ApplyCodesInput,
  ApplyResult,
  InVivoResult,
  AutoCodeHit,
  AutoCodeReport,
  BulkCodeReport,
  ExcerptDetail,
  ExcerptFilter,
  ExcerptPage,
  ExcerptSnapshot,
  ExcerptWithCodes,
  MergeResult,
  RetagReport,
  SplitResult,
} from "./types";

export const applyCodes = (input: ApplyCodesInput) => invoke<ApplyResult>("apply_codes", { input });

/**
 * Create a code named after the selected text and apply it to that
 * selection. One command, so it is one step to undo.
 */
export const inVivoCode = (args: {
  documentId: string;
  startPos: number;
  endPos: number;
  name: string;
  parentId: string | null;
}) => invoke<InVivoResult>("in_vivo_code", args);
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
export const updateExcerptRange = (id: string, startPos: number, endPos: number) =>
  invoke<ExcerptWithCodes>("update_excerpt_range", { id, startPos, endPos });
export const splitExcerpt = (id: string, at: number) =>
  invoke<SplitResult>("split_excerpt", { id, at });
export const mergeExcerpts = (leftId: string, rightId: string) =>
  invoke<MergeResult>("merge_excerpts", { leftId, rightId });

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
/** Auto-code every hit (a search match, or one already expanded to its
 * sentence/paragraph) with `codeId`. */
export const autoCode = (hits: AutoCodeHit[], codeId: string) =>
  invoke<AutoCodeReport>("auto_code", { hits, codeId });
