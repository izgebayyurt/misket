import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import * as api from "@/api/codes";
import type { ChildrenStrategy, CodePatch, NewCode } from "@/api/types";
import { buildCodeTree } from "@/core/codeTree";
import { keys } from "./keys";
import { useUndoStore } from "@/state/undoStore";

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
  };
}

/** Create a code; undo deletes it (only while it has no excerpts). */
export function useCreateCode() {
  const invalidate = useInvalidateCodes();
  return useMutation({
    mutationFn: async (input: NewCode) => {
      const created = await api.createCode(input);
      let id = created.id;
      await useUndoStore.getState().run({
        label: `Create code "${created.name}"`,
        redo: async () => {
          // First run is a no-op (already created); later redos recreate it.
          if (!id) {
            const again = await api.createCode(input);
            id = again.id;
          }
          invalidate();
        },
        undo: async () => {
          const impact = await api.countCodeImpact(id);
          if (impact.excerptCount > 0)
            throw new Error("Code is in use; delete it from the codebook instead.");
          await api.deleteCode(id, "delete");
          id = "";
          invalidate();
        },
      });
      return created;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateCode() {
  const invalidate = useInvalidateCodes();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: CodePatch }) => {
      const before = qc
        .getQueryData<Awaited<ReturnType<typeof api.listCodes>>>(keys.codes)
        ?.find((c) => c.id === id);
      const inverse: CodePatch = before
        ? {
            name: before.name,
            color: before.color,
            description: before.description,
            inclusion: before.inclusion,
            exclusion: before.exclusion,
            shortcut: before.shortcut,
            exampleExcerptId: before.exampleExcerptId ?? null,
          }
        : {};
      await useUndoStore.getState().run({
        label: `Edit code${before ? ` "${before.name}"` : ""}`,
        redo: async () => {
          await api.updateCode(id, patch);
          invalidate();
        },
        undo: async () => {
          await api.updateCode(id, inverse);
          invalidate();
        },
      });
    },
  });
}

/**
 * Point a code at one excerpt as its canonical example (or clear it, with
 * `excerptId: null`). Its own mutation rather than a `useUpdateCode` call so
 * the undo entry reads as what the user did, and so the inverse is exactly
 * the previous example rather than a whole-code patch.
 */
export function useSetCodeExample() {
  const invalidate = useInvalidateCodes();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ codeId, excerptId }: { codeId: string; excerptId: string | null }) => {
      const before = qc
        .getQueryData<Awaited<ReturnType<typeof api.listCodes>>>(keys.codes)
        ?.find((c) => c.id === codeId);
      const previous = before?.exampleExcerptId ?? null;
      if (previous === excerptId) return;
      await useUndoStore.getState().run({
        label: excerptId
          ? `Use excerpt as example for "${before?.name ?? "code"}"`
          : `Clear example for "${before?.name ?? "code"}"`,
        redo: async () => {
          await api.updateCode(codeId, { exampleExcerptId: excerptId });
          invalidate();
        },
        undo: async () => {
          await api.updateCode(codeId, { exampleExcerptId: previous });
          invalidate();
        },
      });
    },
  });
}

export function useMoveCode() {
  const invalidate = useInvalidateCodes();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      newParentId,
      index,
    }: {
      id: string;
      newParentId: string | null;
      index: number;
    }) => {
      const codes = qc.getQueryData<Awaited<ReturnType<typeof api.listCodes>>>(keys.codes) ?? [];
      const before = codes.find((c) => c.id === id);
      const prevParent = before?.parentId ?? null;
      const prevIndex = before?.sortOrder ?? 0;
      await useUndoStore.getState().run({
        label: `Move code${before ? ` "${before.name}"` : ""}`,
        redo: async () => {
          await api.moveCode(id, newParentId, index);
          invalidate();
        },
        undo: async () => {
          await api.moveCode(id, prevParent, prevIndex);
          invalidate();
        },
      });
    },
  });
}

/** Not undoable: clears the stack. */
export function useDeleteCode() {
  const invalidate = useInvalidateCodes();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, children }: { id: string; children: ChildrenStrategy }) =>
      api.deleteCode(id, children),
    onSuccess: () => {
      useUndoStore.getState().clear();
      invalidate();
      qc.invalidateQueries({ queryKey: ["excerpts"] });
      qc.invalidateQueries({ queryKey: keys.excerptQueries });
      qc.invalidateQueries({ queryKey: keys.allMemos });
    },
  });
}

/** Not undoable: clears the stack. */
export function useMergeCode() {
  const invalidate = useInvalidateCodes();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: string; targetId: string }) =>
      api.mergeCode(sourceId, targetId),
    onSuccess: () => {
      useUndoStore.getState().clear();
      invalidate();
      qc.invalidateQueries({ queryKey: ["excerpts"] });
      qc.invalidateQueries({ queryKey: keys.excerptQueries });
      qc.invalidateQueries({ queryKey: keys.allMemos });
    },
  });
}
