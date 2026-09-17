import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/sets";
import type { ExcerptFilter, SetInfo, SetKind } from "@/api/types";
import { keys } from "./keys";

export function useSets(kind: SetKind) {
  return useQuery({
    queryKey: keys.sets(kind),
    queryFn: () => api.listSets(kind),
    staleTime: 60_000,
  });
}

export function useSetMembers(setId: string | null) {
  return useQuery({
    queryKey: keys.setMembers(setId ?? ""),
    queryFn: () => api.listSetMembers(setId!),
    enabled: !!setId,
  });
}

export function useSavedFilters() {
  return useQuery({
    queryKey: keys.savedFilters,
    queryFn: api.listSavedFilters,
    staleTime: 60_000,
  });
}

export function useInvalidateSets() {
  const qc = useQueryClient();
  return (setId?: string) => {
    qc.invalidateQueries({ queryKey: keys.allSets });
    if (setId) qc.invalidateQueries({ queryKey: keys.setMembers(setId) });
    else qc.invalidateQueries({ queryKey: keys.allSetMembers });
    // Sets are filter inputs, so anything filtered by one is now stale.
    qc.invalidateQueries({ queryKey: keys.excerptQueries });
  };
}

/**
 * Create a set. Undoable rather than confirm-first: nothing else in the
 * project depends on it, and redo reuses the same id so a saved filter or an
 * open browser that names the set keeps working.
 */
export function useCreateSet() {
  const invalidate = useInvalidateSets();
  return useMutation({
    mutationFn: ({
      kind,
      name,
      memberIds = [],
    }: {
      kind: SetKind;
      name: string;
      memberIds?: string[];
    }) => api.createSet(kind, name, memberIds),
    onSuccess: (created) => invalidate(created.id),
  });
}

export function useRenameSet() {
  const invalidate = useInvalidateSets();
  return useMutation({
    mutationFn: async ({ id, name, previous }: { id: string; name: string; previous: string }) => {
      if (name.trim() === previous) return;
      await api.renameSet(id, name);
    },
    onSuccess: (_r, { id }) => invalidate(id),
  });
}

/** Delete a set; undo recreates it with the same id and the same members. */
export function useDeleteSet() {
  const invalidate = useInvalidateSets();
  return useMutation({
    mutationFn: (set: SetInfo) => api.deleteSet(set.id),
    onSuccess: (_r, set) => invalidate(set.id),
  });
}

/** Replace a set's members wholesale (the "Edit members…" dialog). */
export function useSetSetMembers() {
  const invalidate = useInvalidateSets();
  return useMutation({
    mutationFn: async ({
      setId,
      memberIds,
    }: {
      setId: string;
      memberIds: string[];
      setName?: string;
    }) => {
      const before = await api.listSetMembers(setId);
      if (sameMembers(before, memberIds)) return;
      await api.setSetMembers(setId, memberIds);
    },
    onSuccess: (_r, { setId }) => invalidate(setId),
  });
}

export function useAddToSet() {
  const invalidate = useInvalidateSets();
  return useMutation({
    mutationFn: async ({
      setId,
      memberId,
    }: {
      setId: string;
      memberId: string;
      label?: string;
    }) => {
      const before = await api.listSetMembers(setId);
      if (before.includes(memberId)) return;
      await api.addToSet(setId, memberId);
    },
    onSuccess: (_r, { setId }) => invalidate(setId),
  });
}

export function useRemoveFromSet() {
  const invalidate = useInvalidateSets();
  return useMutation({
    mutationFn: ({ setId, memberId }: { setId: string; memberId: string; label?: string }) =>
      api.removeFromSet(setId, memberId),
    onSuccess: (_r, { setId }) => invalidate(setId),
  });
}

// ----------------------------------------------------------- saved filters

function useInvalidateSavedFilters() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.savedFilters });
  };
}

/**
 * Save the browser's current filter under a name, replacing whatever was
 * stored under it. Undo puts the previous filter back, or removes the entry
 * if the name was new.
 */
export function useSaveFilter() {
  const invalidate = useInvalidateSavedFilters();
  return useMutation({
    mutationFn: ({ name, filter }: { name: string; filter: ExcerptFilter }) =>
      api.saveFilter(name, filter),
    onSuccess: invalidate,
  });
}

/** Delete a saved filter. Undo re-saves it with the same id. */
export function useDeleteSavedFilter() {
  const invalidate = useInvalidateSavedFilters();
  return useMutation({
    mutationFn: (saved: { id: string }) => api.deleteSavedFilter(saved.id),
    onSuccess: invalidate,
  });
}

function sameMembers(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}
