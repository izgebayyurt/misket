import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import * as api from "@/api/codes";
import type { ChildrenStrategy, Code, CodePatch, NewCode } from "@/api/types";
import { historyBeginGroup, historyEndGroup } from "@/api/history";
import { buildCodeTree } from "@/core/codeTree";
import { keys } from "./keys";

export function useCodes() {
  return useQuery({ queryKey: keys.codes, queryFn: api.listCodes, staleTime: 60_000 });
}

export function useCodeTree() {
  const { data } = useCodes();
  return useMemo(() => buildCodeTree(data ?? []), [data]);
}

export function useInvalidateCodes() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: keys.codes });
    qc.invalidateQueries({ queryKey: keys.analysis });
    qc.invalidateQueries({ queryKey: keys.project });
    qc.invalidateQueries({ queryKey: keys.stats });
    qc.invalidateQueries({ queryKey: keys.history });
  };
}

/**
 * Nothing here registers an inverse any more: the backend records one as it
 * writes, into the history tree in the project file. A mutation is the call
 * plus the invalidation, and the undo is still there tomorrow.
 */
export function useCreateCode() {
  const invalidate = useInvalidateCodes();
  return useMutation({
    mutationFn: (input: NewCode) => api.createCode(input),
    onSuccess: invalidate,
  });
}

export function useUpdateCode() {
  const invalidate = useInvalidateCodes();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CodePatch }) => api.updateCode(id, patch),
    onSuccess: invalidate,
  });
}

/**
 * Point a code at one excerpt as its canonical example (or clear it, with
 * `excerptId: null`). Its own mutation rather than a `useUpdateCode` call so
 * the history entry reads as what the user did.
 */
export function useSetCodeExample() {
  const invalidate = useInvalidateCodes();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ codeId, excerptId }: { codeId: string; excerptId: string | null }) => {
      const before = qc
        .getQueryData<Awaited<ReturnType<typeof api.listCodes>>>(keys.codes)
        ?.find((c) => c.id === codeId);
      // Saving the example it already has would be an empty history entry.
      if ((before?.exampleExcerptId ?? null) === excerptId) return;
      await api.updateCode(codeId, { exampleExcerptId: excerptId });
    },
    onSuccess: invalidate,
  });
}

export function useMoveCode() {
  const invalidate = useInvalidateCodes();
  return useMutation({
    mutationFn: ({
      id,
      newParentId,
      index,
    }: {
      id: string;
      newParentId: string | null;
      index: number;
    }) => api.moveCode(id, newParentId, index),
    onSuccess: invalidate,
  });
}

/** Undoable: the backend snapshots the whole branch before it goes. */
export function useDeleteCode() {
  const invalidate = useInvalidateCodes();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, children }: { id: string; children: ChildrenStrategy }) =>
      api.deleteCode(id, children),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["excerpts"] });
      qc.invalidateQueries({ queryKey: keys.excerptQueries });
      qc.invalidateQueries({ queryKey: keys.allMemos });
    },
  });
}

/**
 * From the code clustering view: create a new top-level code and move a
 * cluster's member codes under it, as one undoable step (create, then one
 * move per member — bracketed exactly like `useRollUpCodes`, so a single
 * undo puts every member back where it was and drops the new parent).
 */
export function useCreateParentFromCluster() {
  const invalidate = useInvalidateCodes();
  return useMutation({
    mutationFn: async ({
      name,
      color,
      memberIds,
      label,
    }: {
      name: string;
      color: string;
      memberIds: string[];
      label: string;
    }): Promise<Code> => {
      await historyBeginGroup(label);
      try {
        const parent = await api.createCode({ name, color, parentId: null });
        for (let index = 0; index < memberIds.length; index++) {
          await api.moveCode(memberIds[index]!, parent.id, index);
        }
        return parent;
      } finally {
        await historyEndGroup();
      }
    },
    onSuccess: invalidate,
  });
}

/** Undoable too: the source comes back with its excerpts, sub-codes and memos. */
export function useMergeCode() {
  const invalidate = useInvalidateCodes();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: string; targetId: string }) =>
      api.mergeCode(sourceId, targetId),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["excerpts"] });
      qc.invalidateQueries({ queryKey: keys.excerptQueries });
      qc.invalidateQueries({ queryKey: keys.allMemos });
    },
  });
}
