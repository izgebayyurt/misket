import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/backup";
import { useWorkspace } from "@/state/workspace";
import { keys } from "./keys";

export function useBackups() {
  return useQuery({ queryKey: keys.backups, queryFn: api.listBackups });
}

export function useSaveProjectCopy() {
  return useMutation({ mutationFn: api.saveProjectCopy });
}

/**
 * Replaces the whole open project with a copy from disk: the workspace and
 * every query start again. This is the one change that is not undoable — the
 * history in the file goes with the file.
 */
export function useRestoreBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.restoreBackup,
    onSuccess: () => {
      useWorkspace.getState().reset();
      qc.resetQueries();
    },
  });
}
