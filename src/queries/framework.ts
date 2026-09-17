import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/framework";
import type {
  FrameworkMatrix,
  FrameworkMatrixInput,
  FrameworkMatrixView,
  FrameworkMatrixWithCells,
} from "@/api/types";
import { keys } from "./keys";
import { useUndoStore } from "@/state/undoStore";

/** The saved matrix configurations (the picker). */
export function useFrameworkMatrices() {
  return useQuery({
    queryKey: keys.frameworkMatrices,
    queryFn: api.listFrameworkMatrices,
    staleTime: 60_000,
  });
}

/** One rendered grid: rows, columns, summaries and excerpt counts. */
export function useFrameworkMatrix(id: string | null) {
  return useQuery({
    queryKey: keys.frameworkMatrix(id ?? ""),
    queryFn: () => api.getFrameworkMatrix(id!),
    enabled: !!id,
    placeholderData: (prev) => prev,
  });
}

function useInvalidateFramework() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: keys.frameworkMatrices });
    if (id) qc.invalidateQueries({ queryKey: keys.frameworkMatrix(id) });
    qc.invalidateQueries({ queryKey: keys.history });
  };
}

/**
 * Create a matrix. Undoable rather than confirm-first, like sets: redo reuses
 * the same id so an open grid keeps working.
 */
export function useCreateFrameworkMatrix() {
  const invalidate = useInvalidateFramework();
  return useMutation({
    mutationFn: async (input: FrameworkMatrixInput) => {
      let created: FrameworkMatrix | null = null;
      await useUndoStore.getState().run({
        label: `Create matrix "${input.name.trim()}"`,
        redo: async () => {
          created = await api.createFrameworkMatrix(input, created?.id);
          invalidate(created.id);
        },
        undo: async () => {
          if (created) await api.deleteFrameworkMatrix(created.id);
          invalidate(created?.id);
        },
      });
      return created as FrameworkMatrix | null;
    },
  });
}

/**
 * Replace a matrix's configuration. `previous` is the whole configuration as
 * it was, so undo is the same call the other way round.
 */
export function useUpdateFrameworkMatrix() {
  const invalidate = useInvalidateFramework();
  return useMutation({
    mutationFn: async ({
      id,
      input,
      previous,
      label,
    }: {
      id: string;
      input: FrameworkMatrixInput;
      previous: FrameworkMatrixInput;
      label?: string;
    }) => {
      await useUndoStore.getState().run({
        label: label ?? `Edit matrix "${previous.name}"`,
        redo: async () => {
          await api.updateFrameworkMatrix(id, input);
          invalidate(id);
        },
        undo: async () => {
          await api.updateFrameworkMatrix(id, previous);
          invalidate(id);
        },
      });
    },
  });
}

/** Delete a matrix; undo brings it back with its id and every summary. */
export function useDeleteFrameworkMatrix() {
  const invalidate = useInvalidateFramework();
  return useMutation({
    mutationFn: async (matrix: FrameworkMatrix) => {
      let saved: FrameworkMatrixWithCells | null = null;
      await useUndoStore.getState().run({
        label: `Delete matrix "${matrix.name}"`,
        redo: async () => {
          saved = await api.deleteFrameworkMatrix(matrix.id);
          invalidate(matrix.id);
        },
        undo: async () => {
          if (saved) await api.restoreFrameworkMatrix(saved);
          invalidate(matrix.id);
        },
      });
    },
  });
}

/** Rewrite the cached grid's cell without refetching it (summary edits). */
function patchCell(view: FrameworkMatrixView, rowKey: string, codeId: string, summary: string) {
  return {
    ...view,
    cells: view.cells.map((c) =>
      c.rowKey === rowKey && c.codeId === codeId ? { ...c, summary } : c,
    ),
  };
}

/**
 * Save one cell's summary, undoably. The command is recorded once per
 * committed edit (the editor debounces keystrokes, like `MemoEditor`), and
 * the cache is patched in place rather than invalidated so typing in one cell
 * never re-renders the rest of the grid.
 */
export function useSetFrameworkCell() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      matrixId,
      rowKey,
      codeId,
      summary,
      label,
    }: {
      matrixId: string;
      rowKey: string;
      codeId: string;
      summary: string;
      label?: string;
    }) => {
      const patch = (text: string) =>
        qc.setQueryData<FrameworkMatrixView>(keys.frameworkMatrix(matrixId), (view) =>
          view ? patchCell(view, rowKey, codeId, text) : view,
        );
      let previous = "";
      await useUndoStore.getState().run({
        label: label ?? "Edit summary",
        redo: async () => {
          previous = await api.setFrameworkCell(matrixId, rowKey, codeId, summary);
          patch(summary);
        },
        undo: async () => {
          await api.setFrameworkCell(matrixId, rowKey, codeId, previous);
          patch(previous);
        },
      });
    },
  });
}
