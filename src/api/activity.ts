import { invoke } from "./client";
import type { ActivityEntry, ActivityFilter, ActivityPage } from "./types";

export const listActivity = (filter: ActivityFilter = {}) =>
  invoke<ActivityPage>("list_activity", { filter });

export const codeHistory = (id: string) => invoke<ActivityEntry[]>("code_history", { id });

export const excerptHistory = (id: string) => invoke<ActivityEntry[]>("excerpt_history", { id });
