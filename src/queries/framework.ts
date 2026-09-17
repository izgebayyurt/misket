import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/framework";
import type { FrameworkMatrix, FrameworkMatrixInput, FrameworkMatrixView } from "@/api/types";
import { keys } from "./keys";

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
  };
}

/**
 * Create a matrix. Undoable rather than confirm-first, like sets: redo reuses
 * the same id so an open grid keeps working.
 */
export function useCreateFrameworkMatrix() {
  const invalidate = useInvalidateFramework();
  return useMutation({
    mutationFn: (input: FrameworkMatrixInput) => api.createFrameworkMatrix(input),
    onSuccess: (created) => invalidate(created.id),
  });
}

/** Replace a matrix's configuration. Undo is the same call the other way. */
export function useUpdateFrameworkMatrix() {
  const invalidate = useInvalidateFramework();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: FrameworkMatrixInput;
      previous?: FrameworkMatrixInput;
      label?: string;
    }) => api.updateFrameworkMatrix(id, input),
    onSuccess: (_r, { id }) => invalidate(id),
  });
}

/** Delete a matrix; undo brings it back with its id and every summary. */
export function useDeleteFrameworkMatrix() {
  const invalidate = useInvalidateFramework();
  return useMutation({
    mutationFn: (matrix: FrameworkMatrix) => api.deleteFrameworkMatrix(matrix.id),
    onSuccess: (_r, matrix) => invalidate(matrix.id),
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
 * Save one cell's summary. The backend records the previous text, so undo
 * takes the edit back; the cache is patched in place rather than invalidated
 * so typing in one cell never re-renders the rest of the grid.
 */
export function useSetFrameworkCell() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      matrixId,
      rowKey,
      codeId,
      summary,
    }: {
      matrixId: string;
      rowKey: string;
      codeId: string;
      summary: string;
      label?: string;
    }) => api.setFrameworkCell(matrixId, rowKey, codeId, summary),
    onSuccess: (_r, { matrixId, rowKey, codeId, summary }) => {
      qc.setQueryData<FrameworkMatrixView>(keys.frameworkMatrix(matrixId), (view) =>
        view ? patchCell(view, rowKey, codeId, summary) : view,
      );
    },
  });
}
