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
import { historyBeginGroup, historyEndGroup } from "@/api/history";
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
    qc.invalidateQueries({ queryKey: keys.coders });
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
 * that selection. One command, so it is one step in the history — undoing it
 * can never leave a stray empty code behind.
 */
export function useInVivoCode() {
  const invalidate = useInvalidateExcerpts();
  const invalidateCodes = useInvalidateCodes();
  return useMutation({
    mutationFn: async (args: {
      documentId: string;
      startPos: number;
      endPos: number;
      /** Already collapsed, capped and made unique among its siblings. */
      name: string;
      parentId: string | null;
    }) => {
      const r = await api.inVivoCode(args);
      rememberApplied([r.code.id]);
      invalidate(args.documentId, r.excerpt.id);
      invalidateCodes();
      return { codeId: r.code.id, excerptId: r.excerpt.id };
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

/**
 * Take a code off an excerpt. `coderId` is undefined for "mine", which is what
 * the inspector's × does; pass an id to remove somebody else's coding.
 */
export function useRemoveExcerptCode() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: ({
      id,
      codeId,
      coderId,
    }: {
      id: string;
      documentId: string;
      codeId: string;
      coderId?: string | null;
    }) => api.removeExcerptCode(id, codeId, coderId ?? null),
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

/** Move an excerpt's boundaries: code points for text, milliseconds for a
 * coded stretch of a recording. */
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
 * the parent and gains the child. Two writes bracketed as one step, so one
 * undo puts the excerpt back where it was.
 */
export function usePushDownExcerpt() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: async ({
      excerptId,
      fromCodeId,
      toCodeId,
      label,
    }: {
      excerptId: string;
      fromCodeId: string;
      toCodeId: string;
      label: string;
    }) => {
      await historyBeginGroup(label);
      try {
        await api.removeCodesFromExcerpts([excerptId], [fromCodeId]);
        await api.addCodesToExcerpts([excerptId], [toCodeId]);
      } finally {
        await historyEndGroup();
      }
      rememberApplied([toCodeId]);
    },
    onSuccess: (_r, { excerptId }) => invalidate(undefined, excerptId),
  });
}

/**
 * Roll sub-codes up into their parent: every excerpt tagged with a child gets
 * the parent instead, optionally followed by deleting the emptied children.
 * One retag per child and, if asked, one delete per child — all bracketed as
 * a single step, so one undo unrolls the lot.
 */
export function useRollUpCodes() {
  const invalidate = useInvalidateExcerpts();
  const invalidateCodes = useInvalidateCodes();
  return useMutation({
    mutationFn: async ({
      parentId,
      childIds,
      deleteEmptied,
      label,
    }: {
      parentId: string;
      childIds: string[];
      deleteEmptied: boolean;
      label: string;
    }) => {
      const reports: RetagReport[] = [];
      await historyBeginGroup(label);
      try {
        for (const childId of childIds) reports.push(await api.retagCode(childId, parentId));
        if (deleteEmptied) {
          // `promote` so a rolled-up code's own sub-codes survive, moving up
          // to the parent rather than disappearing with it.
          for (const childId of childIds) await codesApi.deleteCode(childId, "promote");
        }
      } finally {
        await historyEndGroup();
      }
      if (deleteEmptied) {
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
