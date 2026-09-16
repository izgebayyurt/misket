import { invoke } from "./client";
import type { ActivityEntry, ActivityFilter, ActivityPage } from "./types";

export const listActivity = (filter: ActivityFilter = {}) =>
  invoke<ActivityPage>("list_activity", { filter });

export const codeHistory = (id: string) => invoke<ActivityEntry[]>("code_history", { id });

export const excerptHistory = (id: string) => invoke<ActivityEntry[]>("excerpt_history", { id });

/**
 * Record an undo or a redo. The undo stack lives here, so the backend cannot
 * tell an inverse apart from a fresh edit; this entry gives the log the label
 * the user saw ("Undid: Merge codes").
 */
export const logUndo = (redo: boolean, label: string) => invoke<void>("log_undo", { redo, label });
