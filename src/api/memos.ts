import { invoke } from "./client";
import type { Memo, MemoTarget } from "./types";

export const listMemos = (target: MemoTarget) => invoke<Memo[]>("list_memos", { target });
export const createMemo = (target: MemoTarget, title: string, body: string) =>
  invoke<Memo>("create_memo", { target, title, body });
export const updateMemo = (id: string, title: string, body: string) =>
  invoke<Memo>("update_memo", { id, title, body });
export const deleteMemo = (id: string) => invoke<Memo>("delete_memo", { id });
export const restoreMemo = (memo: Memo) => invoke<Memo>("restore_memo", { memo });
