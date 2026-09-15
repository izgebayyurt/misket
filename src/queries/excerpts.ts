import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/excerpts";
import type { ApplyCodesInput, ExcerptFilter, ExcerptSnapshot } from "@/api/types";
import { keys } from "./keys";
import { useUndoStore } from "@/state/undoStore";
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
    qc.invalidateQueries({ queryKey: keys.codes });
    qc.invalidateQueries({ queryKey: keys.documents });
    qc.invalidateQueries({ queryKey: keys.project });
  };
}

/** Apply codes to a range (creating the excerpt if needed). Undo removes what was added. */
export function useApplyCodes() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: async (input: ApplyCodesInput) => {
      const first = await api.applyCodes(input);
      let excerptId = first.excerpt.id;
      let created = first.created;
      let added = first.addedCodeIds;
      let snapshot: ExcerptSnapshot | null = null;
      invalidate(input.documentId, excerptId);
      await useUndoStore.getState().run({
        label: `Code ${input.codeIds.length === 1 ? "excerpt" : `${input.codeIds.length} codes`}`,
        redo: async () => {
          if (snapshot) {
            // Re-applying after an undo that deleted the excerpt.
            const r = await api.applyCodes(input);
            excerptId = r.excerpt.id;
            created = r.created;
            added = r.addedCodeIds;
            snapshot = null;
            invalidate(input.documentId, excerptId);
          } else if (added.length) {
            await api.addExcerptCodes(excerptId, added);
            invalidate(input.documentId, excerptId);
          }
        },
        undo: async () => {
          if (created) {
            snapshot = await api.deleteExcerpt(excerptId);
            const ws = useWorkspace.getState();
            if (ws.focusedExcerptId === excerptId) ws.setFocusedExcerptId(null);
          } else {
            for (const c of added) await api.removeExcerptCode(excerptId, c);
          }
          invalidate(input.documentId, excerptId);
        },
      });
      // `run` executed redo() once already; the first call must be a no-op for
      // the created case, which it is (snapshot null, added re-added idempotently).
      return first;
    },
  });
}

export function useAddExcerptCodes() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: async ({
      id,
      documentId,
      codeIds,
    }: {
      id: string;
      documentId: string;
      codeIds: string[];
    }) => {
      const before = await api.getExcerpt(id);
      const added = codeIds.filter((c) => !before.codeIds.includes(c));
      if (added.length === 0) return;
      await useUndoStore.getState().run({
        label: "Add code to excerpt",
        redo: async () => {
          await api.addExcerptCodes(id, added);
          invalidate(documentId, id);
        },
        undo: async () => {
          for (const c of added) await api.removeExcerptCode(id, c);
          invalidate(documentId, id);
        },
      });
    },
  });
}

export function useRemoveExcerptCode() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: async ({
      id,
      documentId,
      codeId,
    }: {
      id: string;
      documentId: string;
      codeId: string;
    }) => {
      await useUndoStore.getState().run({
        label: "Remove code from excerpt",
        redo: async () => {
          await api.removeExcerptCode(id, codeId);
          invalidate(documentId, id);
        },
        undo: async () => {
          await api.addExcerptCodes(id, [codeId]);
          invalidate(documentId, id);
        },
      });
    },
  });
}

export function useDeleteExcerpt() {
  const invalidate = useInvalidateExcerpts();
  return useMutation({
    mutationFn: async ({ id, documentId }: { id: string; documentId: string }) => {
      let snapshot: ExcerptSnapshot | null = null;
      await useUndoStore.getState().run({
        label: "Delete excerpt",
        redo: async () => {
          snapshot = await api.deleteExcerpt(id);
          const ws = useWorkspace.getState();
          if (ws.focusedExcerptId === id) ws.setFocusedExcerptId(null);
          invalidate(documentId, id);
        },
        undo: async () => {
          if (snapshot) await api.restoreExcerpt(snapshot);
          invalidate(documentId, id);
        },
      });
    },
  });
}
