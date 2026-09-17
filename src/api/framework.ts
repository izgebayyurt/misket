import { invoke } from "./client";
import type {
  FrameworkMatrix,
  FrameworkMatrixInput,
  FrameworkMatrixView,
  FrameworkMatrixWithCells,
} from "./types";

export const listFrameworkMatrices = () => invoke<FrameworkMatrix[]>("list_framework_matrices");

/** The grid itself: rows and columns are recomputed on every read. */
export const getFrameworkMatrix = (id: string) =>
  invoke<FrameworkMatrixView>("get_framework_matrix", { id });

/** `id` lets undo recreate a deleted matrix with its original identity. */
export const createFrameworkMatrix = (input: FrameworkMatrixInput, id?: string) =>
  invoke<FrameworkMatrix>("create_framework_matrix", { input, id });

/** Replaces the whole configuration; undo is the same call with the previous one. */
export const updateFrameworkMatrix = (id: string, input: FrameworkMatrixInput) =>
  invoke<FrameworkMatrix>("update_framework_matrix", { id, input });

export const deleteFrameworkMatrix = (id: string) =>
  invoke<FrameworkMatrixWithCells>("delete_framework_matrix", { id });

/** Write one cell's summary; resolves to the text that was there before. */
export const setFrameworkCell = (
  matrixId: string,
  rowKey: string,
  codeId: string,
  summary: string,
) => invoke<string>("set_framework_cell", { matrixId, rowKey, codeId, summary });

export const exportFrameworkCsv = (id: string) => invoke<string>("export_framework_csv", { id });
