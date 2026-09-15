import { invoke } from "./client";
import type {
  ChildrenStrategy,
  Code,
  CodeImpact,
  CodePatch,
  DeleteCodeReport,
  NewCode,
} from "./types";

export const listCodes = () => invoke<Code[]>("list_codes");
export const createCode = (input: NewCode) => invoke<Code>("create_code", { input });
export const updateCode = (id: string, patch: CodePatch) =>
  invoke<Code>("update_code", { id, patch });
export const moveCode = (id: string, newParentId: string | null, index: number) =>
  invoke<Code>("move_code", { id, newParentId, index });
export const deleteCode = (id: string, children: ChildrenStrategy) =>
  invoke<DeleteCodeReport>("delete_code", { id, children });
export const mergeCode = (sourceId: string, targetId: string) =>
  invoke<Code>("merge_code", { sourceId, targetId });
export const countCodeImpact = (id: string) => invoke<CodeImpact>("count_code_impact", { id });
