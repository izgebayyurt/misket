import { invoke } from "./client";
import type { MergeDecision, MergePlan, MergeReport } from "./types";

/** What pulling from `path` would do. Reads both files, writes neither. */
export const mergePreview = (path: string) => invoke<MergePlan>("merge_preview", { path });

/**
 * Pull `path` into the open project, one undoable step. `decisions` answers
 * the conflicts the preview listed; anything missing takes its default.
 */
export const mergeApply = (path: string, decisions: MergeDecision[]) =>
  invoke<MergeReport>("merge_apply", { path, decisions });
