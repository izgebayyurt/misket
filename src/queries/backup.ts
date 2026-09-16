import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/backup";
import { useUndoStore } from "@/state/undoStore";
import { useWorkspace } from "@/state/workspace";
import { keys } from "./keys";

export function useBackups() {
  return useQuery({ queryKey: keys.backups, queryFn: api.listBackups });
}

export function useSaveProjectCopy() {
  return useMutation({ mutationFn: api.saveProjectCopy });
}

/** Replaces the whole open project: resets the workspace and all queries,
 * and (not undoable across a file swap) clears the undo stack. */
export function useRestoreBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.restoreBackup,
    onSuccess: () => {
      useUndoStore.getState().clear();
      useWorkspace.getState().reset();
      qc.resetQueries();
    },
  });
}
