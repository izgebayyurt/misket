import { invoke } from "./client";
import type { ExcerptFilter, SavedFilter, SetInfo, SetKind, SetWithMembers } from "./types";

export const listSets = (kind: SetKind) => invoke<SetInfo[]>("list_sets", { kind });
/** `id` lets undo recreate a deleted set with its original identity. */
export const createSet = (kind: SetKind, name: string, memberIds?: string[], id?: string) =>
  invoke<SetInfo>("create_set", { kind, name, memberIds, id });
export const renameSet = (id: string, name: string) => invoke<SetInfo>("rename_set", { id, name });
export const deleteSet = (id: string) => invoke<SetWithMembers>("delete_set", { id });

export const listSetMembers = (setId: string) => invoke<string[]>("list_set_members", { setId });
export const setSetMembers = (setId: string, memberIds: string[]) =>
  invoke<string[]>("set_set_members", { setId, memberIds });
export const addToSet = (setId: string, memberId: string) =>
  invoke<string[]>("add_to_set", { setId, memberId });
export const removeFromSet = (setId: string, memberId: string) =>
  invoke<string[]>("remove_from_set", { setId, memberId });

export const listSavedFilters = () => invoke<SavedFilter[]>("list_saved_filters");
/** Upserts by name (case-insensitively). */
export const saveFilter = (name: string, filter: ExcerptFilter) =>
  invoke<SavedFilter>("save_filter", { name, filter });
export const deleteSavedFilter = (id: string) => invoke<SavedFilter>("delete_saved_filter", { id });
