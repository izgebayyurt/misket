import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/sets";
import type { ExcerptFilter, SavedFilter, SetInfo, SetKind } from "@/api/types";
import { keys } from "./keys";
import { useUndoStore } from "@/state/undoStore";

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
    qc.invalidateQueries({ queryKey: keys.history });
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
    mutationFn: async ({
      kind,
      name,
      memberIds = [],
    }: {
      kind: SetKind;
      name: string;
      memberIds?: string[];
    }) => {
      let created: SetInfo | null = null;
      await useUndoStore.getState().run({
        label: `Create set "${name.trim()}"`,
        redo: async () => {
          created = await api.createSet(kind, name, memberIds, created?.id);
          invalidate(created.id);
        },
        undo: async () => {
          if (created) await api.deleteSet(created.id);
          invalidate(created?.id);
        },
      });
      return created as SetInfo | null;
    },
  });
}

export function useRenameSet() {
  const invalidate = useInvalidateSets();
  return useMutation({
    mutationFn: async ({ id, name, previous }: { id: string; name: string; previous: string }) => {
      if (name.trim() === previous) return;
      await useUndoStore.getState().run({
        label: `Rename set "${previous}"`,
        redo: async () => {
          await api.renameSet(id, name);
          invalidate(id);
        },
        undo: async () => {
          await api.renameSet(id, previous);
          invalidate(id);
        },
      });
    },
  });
}

/** Delete a set; undo recreates it with the same id and the same members. */
export function useDeleteSet() {
  const invalidate = useInvalidateSets();
  return useMutation({
    mutationFn: async (set: SetInfo) => {
      let memberIds: string[] = [];
      await useUndoStore.getState().run({
        label: `Delete set "${set.name}"`,
        redo: async () => {
          memberIds = (await api.deleteSet(set.id)).memberIds;
          invalidate(set.id);
        },
        undo: async () => {
          await api.createSet(set.kind, set.name, memberIds, set.id);
          invalidate(set.id);
        },
      });
    },
  });
}

/** Replace a set's members wholesale (the "Edit members…" dialog). */
export function useSetSetMembers() {
  const invalidate = useInvalidateSets();
  return useMutation({
    mutationFn: async ({
      setId,
      memberIds,
      setName,
    }: {
      setId: string;
      memberIds: string[];
      setName?: string;
    }) => {
      const before = await api.listSetMembers(setId);
      if (sameMembers(before, memberIds)) return;
      await useUndoStore.getState().run({
        label: `Edit set${setName ? ` "${setName}"` : ""}`,
        redo: async () => {
          await api.setSetMembers(setId, memberIds);
          invalidate(setId);
        },
        undo: async () => {
          await api.setSetMembers(setId, before);
          invalidate(setId);
        },
      });
    },
  });
}

export function useAddToSet() {
  const invalidate = useInvalidateSets();
  return useMutation({
    mutationFn: async ({
      setId,
      memberId,
      label,
    }: {
      setId: string;
      memberId: string;
      label?: string;
    }) => {
      const before = await api.listSetMembers(setId);
      if (before.includes(memberId)) return;
      await useUndoStore.getState().run({
        label: label ?? "Add to set",
        redo: async () => {
          await api.addToSet(setId, memberId);
          invalidate(setId);
        },
        undo: async () => {
          await api.removeFromSet(setId, memberId);
          invalidate(setId);
        },
      });
    },
  });
}

export function useRemoveFromSet() {
  const invalidate = useInvalidateSets();
  return useMutation({
    mutationFn: async ({
      setId,
      memberId,
      label,
    }: {
      setId: string;
      memberId: string;
      label?: string;
    }) => {
      await useUndoStore.getState().run({
        label: label ?? "Remove from set",
        redo: async () => {
          await api.removeFromSet(setId, memberId);
          invalidate(setId);
        },
        undo: async () => {
          await api.addToSet(setId, memberId);
          invalidate(setId);
        },
      });
    },
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, filter }: { name: string; filter: ExcerptFilter }) => {
      const before = (
        qc.getQueryData<Awaited<ReturnType<typeof api.listSavedFilters>>>(keys.savedFilters) ?? []
      ).find((f) => f.name.toLowerCase() === name.trim().toLowerCase());
      let saved: SavedFilter | null = null;
      await useUndoStore.getState().run({
        label: `Save filter "${name.trim()}"`,
        redo: async () => {
          saved = await api.saveFilter(name, filter);
          invalidate();
        },
        undo: async () => {
          if (before) await api.saveFilter(before.name, before.filter);
          else if (saved) await api.deleteSavedFilter(saved.id);
          invalidate();
        },
      });
      return saved as SavedFilter | null;
    },
  });
}

/**
 * Delete a saved filter. Undo re-saves it under the same name; the name is
 * the identity users see, so the row coming back with a fresh id is fine.
 */
export function useDeleteSavedFilter() {
  const invalidate = useInvalidateSavedFilters();
  return useMutation({
    mutationFn: async (saved: SavedFilter) => {
      await useUndoStore.getState().run({
        label: `Delete filter "${saved.name}"`,
        redo: async () => {
          const current = (await api.listSavedFilters()).find(
            (f) => f.name.toLowerCase() === saved.name.toLowerCase(),
          );
          if (current) await api.deleteSavedFilter(current.id);
          invalidate();
        },
        undo: async () => {
          await api.saveFilter(saved.name, saved.filter);
          invalidate();
        },
      });
    },
  });
}

function sameMembers(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}
