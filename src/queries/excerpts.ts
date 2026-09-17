import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/excerpts";
import * as codesApi from "@/api/codes";
import type {
  ApplyCodesInput,
  AutoCodeHit,
  ExcerptFilter,
  ExcerptSnapshot,
  RetagReport,
} from "@/api/types";
import { keys } from "./keys";
import { useInvalidateCodes } from "./codes";
import { useWorkspace } from "@/state/workspace";

export function useDocumentExcerpts(documentId: string | null) {
  return useQuery({
    queryKey: keys.documentExcerpts(documentId ?? ""),
    queryFn: () => api.listDocumentExcerpts(documentId!),
    enabled: !!documentId,
  });
}

export function useExcerptDetail(id: string | null) {
  return useQuery({
    queryKey: keys.excerpt(id ?? ""),
    queryFn: () => api.getExcerpt(id!),
    enabled: !!id,
  });
}

export function useExcerptQuery(filter: ExcerptFilter) {
  return useQuery({
    queryKey: keys.excerptQuery(filter),
    queryFn: () => api.queryExcerpts(filter),
    placeholderData: (prev) => prev,
  });
}

export function useInvalidateExcerpts() {
  const qc = useQueryClient();
  return (documentId?: string, excerptId?: string) => {
    if (documentId) qc.invalidateQueries({ queryKey: keys.documentExcerpts(documentId) });
    else qc.invalidateQueries({ queryKey: ["excerpts"] });
    if (excerptId) qc.invalidateQueries({ queryKey: keys.excerpt(excerptId) });
    qc.invalidateQueries({ queryKey: keys.excerptQueries });
    qc.invalidateQueries({ queryKey: keys.analysis });
    qc.invalidateQueries({ queryKey: keys.codes });
    qc.invalidateQueries({ queryKey: keys.documents });
    qc.invalidateQueries({ queryKey: keys.project });
    qc.invalidateQueries({ queryKey: keys.stats });
    qc.invalidateQueries({ queryKey: keys.history });
  };
}

/**
 * Remember what was just coded, so the quick-code shortcut and the status bar
 * always mean the last code the user actually applied — whichever path they
 * used. Every apply funnels through one of the mutations below, so this is the
 * one place that has to know.
 */
function rememberApplied(codeIds: string[]) {
  const last = codeIds[codeIds.length - 1];
  if (last) useWorkspace.getState().setLastAppliedCodeId(last);
}

/** Forget an excerpt the workspace was pointing at, once it is gone. */
function unfocus(...ids: string[]) {
  const ws = useWorkspace.getState();
  if (ws.focusedExcerptId && ids.includes(ws.focusedExcerptId)) ws.setFocusedExcerptId(null);
}

/**
 * Apply codes to a range, creating the excerpt if needed. Like every mutation
 * below it, the backend records its own inverse, so there is nothing to
 * register here.
 */
export function useApplyCodes() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: async (input: ApplyCodesInput) => {
      const result = await api.applyCodes(input);
      rememberApplied(input.codeIds);
      return result;
    },
    onSuccess: (r, input) => invalidate(input.documentId, r.excerpt.id),
  });
}

/**
 * In vivo coding: create a code named after the selected text and apply it to
 * that selection. Two operations, so two steps in the history — undoing twice
 * takes both back, and neither can leave a stray empty code behind for good.
 */
export function useInVivoCode() {
  const invalidate = useInvalidateExcerpts();
  const invalidateCodes = useInvalidateCodes();
  return useMutation({
    mutationFn: async ({
      documentId,
      startPos,
      endPos,
      name,
      parentId,
    }: {
      documentId: string;
      startPos: number;
      endPos: number;
      /** Already collapsed, capped and made unique among its siblings. */
      name: string;
      parentId: string | null;
    }) => {
      const code = await codesApi.createCode({ name, parentId });
      const r = await api.applyCodes({ documentId, startPos, endPos, codeIds: [code.id] });
      rememberApplied([code.id]);
      invalidate(documentId, r.excerpt.id);
      invalidateCodes();
      return { codeId: code.id, excerptId: r.excerpt.id };
    },
  });
}

export function useAddExcerptCodes() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: async ({ id, codeIds }: { id: string; documentId: string; codeIds: string[] }) => {
      rememberApplied(codeIds);
      await api.addExcerptCodes(id, codeIds);
    },
    onSuccess: (_r, { id, documentId }) => invalidate(documentId, id),
  });
}

export function useRemoveExcerptCode() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: ({ id, codeId }: { id: string; documentId: string; codeId: string }) =>
      api.removeExcerptCode(id, codeId),
    onSuccess: (_r, { id, documentId }) => invalidate(documentId, id),
  });
}

export function useDeleteExcerpt() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: ({ id }: { id: string; documentId: string }) => api.deleteExcerpt(id),
    onSuccess: (_r, { id, documentId }) => {
      unfocus(id);
      invalidate(documentId, id);
    },
  });
}

/** Move a text excerpt's boundaries. */
export function useUpdateExcerptRange() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: async ({
      id,
      startPos,
      endPos,
      previousStartPos,
      previousEndPos,
    }: {
      id: string;
      documentId: string;
      startPos: number;
      endPos: number;
      previousStartPos: number;
      previousEndPos: number;
      label?: string;
    }) => {
      if (startPos === previousStartPos && endPos === previousEndPos) return;
      await api.updateExcerptRange(id, startPos, endPos);
    },
    onSuccess: (_r, { id, documentId }) => invalidate(documentId, id),
  });
}

// ------------------------------------------------------- bulk operations

/** Delete a whole selection at once. */
export function useDeleteExcerpts() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      const snapshots: ExcerptSnapshot[] = await api.deleteExcerpts(ids);
      unfocus(...ids);
      return snapshots.length;
    },
    onSuccess: () => invalidate(),
  });
}

/** Tag many excerpts with many codes. */
export function useAddCodesToExcerpts() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: async ({
      ids,
      codeIds,
    }: {
      ids: string[];
      codeIds: string[];
      /** Unused now that the summary comes from the backend. */
      label?: string;
    }) => {
      rememberApplied(codeIds);
      const report = await api.addCodesToExcerpts(ids, codeIds);
      return report.affected;
    },
    onSuccess: () => invalidate(),
  });
}

/** Split a text excerpt in two at a code point offset. */
export function useSplitExcerpt() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: ({ id, at }: { id: string; documentId: string; at: number }) =>
      api.splitExcerpt(id, at),
    onSuccess: (_r, { id, documentId }) => invalidate(documentId, id),
  });
}

/** Merge two touching or overlapping text excerpts. `leftId` survives. */
export function useMergeExcerpts() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: ({ leftId, rightId }: { leftId: string; rightId: string; documentId: string }) =>
      api.mergeExcerpts(leftId, rightId),
    onSuccess: (_r, { leftId, rightId, documentId }) => {
      const ws = useWorkspace.getState();
      if (ws.focusedExcerptId === rightId) ws.setFocusedExcerptId(leftId);
      invalidate(documentId, leftId);
      invalidate(documentId, rightId);
    },
  });
}

/**
 * Auto-code every hit (a search match, or one already expanded to its
 * sentence/paragraph) with one code, in one server-side transaction.
 */
export function useAutoCode() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: ({
      hits,
      codeId,
    }: {
      hits: AutoCodeHit[];
      codeId: string;
      /** Unused now that the summary comes from the backend. */
      label?: string;
    }) => api.autoCode(hits, codeId),
    onSuccess: () => invalidate(),
  });
}

/** The opposite of {@link useAddCodesToExcerpts}. */
export function useRemoveCodesFromExcerpts() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: async ({ ids, codeIds }: { ids: string[]; codeIds: string[]; label?: string }) =>
      (await api.removeCodesFromExcerpts(ids, codeIds)).affected,
    onSuccess: () => invalidate(),
  });
}

/**
 * Push one excerpt down from a parent code to one of its children: it loses
 * the parent and gains the child. Two steps in the history, so taking it back
 * is two undos — the price of the loop being this cheap to do.
 */
export function usePushDownExcerpt() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: async ({
      excerptId,
      fromCodeId,
      toCodeId,
    }: {
      excerptId: string;
      fromCodeId: string;
      toCodeId: string;
      label: string;
    }) => {
      await api.removeCodesFromExcerpts([excerptId], [fromCodeId]);
      await api.addCodesToExcerpts([excerptId], [toCodeId]);
      rememberApplied([toCodeId]);
    },
    onSuccess: (_r, { excerptId }) => invalidate(undefined, excerptId),
  });
}

/**
 * Roll sub-codes up into their parent: every excerpt tagged with a child gets
 * the parent instead, optionally followed by deleting the emptied children.
 * Both halves are undoable now — a code delete is a step like any other — so
 * this is one `retag_code` per child and, if asked, one delete per child.
 */
export function useRollUpCodes() {
  const invalidate = useInvalidateExcerpts();
  const invalidateCodes = useInvalidateCodes();
  return useMutation({
    mutationFn: async ({
      parentId,
      childIds,
      deleteEmptied,
    }: {
      parentId: string;
      childIds: string[];
      deleteEmptied: boolean;
      label: string;
    }) => {
      const reports: RetagReport[] = [];
      for (const childId of childIds) reports.push(await api.retagCode(childId, parentId));
      if (deleteEmptied) {
        // `promote` so a rolled-up code's own sub-codes survive, moving up to
        // the parent rather than disappearing with it.
        for (const childId of childIds) await codesApi.deleteCode(childId, "promote");
        const ws = useWorkspace.getState();
        if (ws.selectedCodeId && childIds.includes(ws.selectedCodeId))
          ws.setSelectedCodeId(parentId);
        if (ws.lastAppliedCodeId && childIds.includes(ws.lastAppliedCodeId))
          ws.setLastAppliedCodeId(parentId);
      }
      return reports.reduce((n, r) => n + r.moved.length + r.alreadyHad.length, 0);
    },
    onSuccess: () => {
      invalidate();
      invalidateCodes();
    },
  });
}

/** Move every excerpt from one code to another. Both codes survive. */
export function useRetagCode() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: ({
      fromCodeId,
      toCodeId,
    }: {
      fromCodeId: string;
      toCodeId: string;
      label?: string;
    }) => api.retagCode(fromCodeId, toCodeId),
    onSuccess: () => invalidate(),
  });
}
