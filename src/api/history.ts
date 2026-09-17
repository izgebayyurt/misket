import { invoke } from "./client";
import type { CompactReport, HistoryNode, HistoryNodeSummary } from "./types";

/**
 * The undo tree lives in the project file, so undo and redo are ordinary
 * commands rather than replays of closures the window happens to still hold.
 */

/** Take back the step at the head. `null` means there was nothing to undo. */
export const historyUndo = () => invoke<HistoryNode | null>("history_undo");

/** Step forward again, onto `child` if one is named. */
export const historyRedo = (child?: number) =>
  invoke<HistoryNode | null>("history_redo", { child: child ?? null });

/** Move the project to any node in the tree. */
export const historyCheckout = (id: number) => invoke<HistoryNode>("history_checkout", { id });

export const historyTree = () => invoke<HistoryNodeSummary[]>("history_tree");

/** Name the current node, so the branch growing from it can be found again. */
export const historyFork = (name: string) => invoke<HistoryNode>("history_fork", { name });

export const historyRenameBranch = (id: number, name: string | null) =>
  invoke<HistoryNode>("history_rename_branch", { id, name });

/** Throw away everything before `id`, making it the new root. */
export const historyCompact = (id: number) => invoke<CompactReport>("history_compact", { id });

/**
 * Bracket several calls into one step in the history, for what the user did
 * once but the frontend has to make several commands for (importing a batch
 * of files). Always end in a `finally`: leaving a group open would swallow
 * the next edit into it.
 */
export const historyBeginGroup = (summary: string) =>
  invoke<void>("history_begin_group", { summary });

export const historyEndGroup = () => invoke<void>("history_end_group");
