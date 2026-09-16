import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/memos";
import type { Memo, MemoTarget } from "@/api/types";
import { keys } from "./keys";

/** Id of the memo the editor should focus when it mounts (set on create). */
export const pendingMemoFocus: { id: string | null } = { id: null };

export function normalizeTarget(t: MemoTarget): MemoTarget {
  return {
    documentId: t.documentId ?? null,
    codeId: t.codeId ?? null,
    excerptId: t.excerptId ?? null,
  };
}

export function useMemos(target: MemoTarget | null) {
  const t = target ? normalizeTarget(target) : null;
  return useQuery({
    queryKey: keys.memos(t ?? {}),
    queryFn: () => api.listMemos(t!),
    enabled: !!t,
  });
}

function useInvalidateMemos() {
  const qc = useQueryClient();
  return (target: MemoTarget) => {
    qc.invalidateQueries({ queryKey: keys.memos(normalizeTarget(target)) });
    qc.invalidateQueries({ queryKey: keys.project });
    qc.invalidateQueries({ queryKey: keys.stats });
    if (target.excerptId) {
      qc.invalidateQueries({ queryKey: keys.excerpt(target.excerptId) });
      qc.invalidateQueries({ queryKey: ["excerpts"] });
      qc.invalidateQueries({ queryKey: keys.excerptQueries });
    }
  };
}

export function useCreateMemo() {
  const invalidate = useInvalidateMemos();
  return useMutation({
    mutationFn: async ({
      target,
      title = "",
      body = "",
    }: {
      target: MemoTarget;
      title?: string;
      body?: string;
    }) => {
      const memo = await api.createMemo(normalizeTarget(target), title, body);
      pendingMemoFocus.id = memo.id;
      return memo;
    },
    onSuccess: (_m, { target }) => invalidate(normalizeTarget(target)),
  });
}

/** Debounced saves from the editor; every save is its own history entry. */
export function useUpdateMemo() {
  const invalidate = useInvalidateMemos();
  return useMutation({
    mutationFn: ({
      id,
      title,
      body,
    }: {
      id: string;
      title: string;
      body: string;
      target: MemoTarget;
    }) => api.updateMemo(id, title, body),
    onSuccess: (_m, { target }) => invalidate(target),
  });
}

export function useDeleteMemo() {
  const invalidate = useInvalidateMemos();
  return useMutation({
    mutationFn: ({ memo }: { memo: Memo }) => api.deleteMemo(memo.id),
    onSuccess: (_m, { memo }) =>
      invalidate({
        documentId: memo.documentId,
        codeId: memo.codeId,
        excerptId: memo.excerptId,
      }),
  });
}
