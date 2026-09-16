import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/project";
import type { ProjectInfo } from "@/api/types";
import { keys } from "./keys";
import { useWorkspace } from "@/state/workspace";
import { useUndoStore } from "@/state/undoStore";

export function useProjectInfo() {
  return useQuery({ queryKey: keys.project, queryFn: api.getProjectInfo, staleTime: 5_000 });
}

export function useProjectStats() {
  return useQuery({ queryKey: keys.stats, queryFn: api.getProjectStats });
}

export function useRecentProjects() {
  return useQuery({ queryKey: keys.recent, queryFn: api.listRecentProjects });
}

/** Rename the open project; undo renames it back. */
export function useRenameProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const before = qc.getQueryData<ProjectInfo | null>(keys.project);
      const previousName = before?.name ?? "";
      let info: ProjectInfo | undefined;
      await useUndoStore.getState().run({
        label: "Rename project",
        redo: async () => {
          info = await api.renameProject(name);
          qc.invalidateQueries({ queryKey: keys.project });
          qc.invalidateQueries({ queryKey: keys.recent });
        },
        undo: async () => {
          if (previousName) {
            info = await api.renameProject(previousName);
            qc.invalidateQueries({ queryKey: keys.project });
            qc.invalidateQueries({ queryKey: keys.recent });
          }
        },
      });
      return info as ProjectInfo;
    },
  });
}

export function useOpenProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.openProject(path),
    onSuccess: () => {
      useWorkspace.getState().reset();
      qc.resetQueries();
    },
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, name }: { path: string; name: string }) => api.createProject(path, name),
    onSuccess: () => {
      useWorkspace.getState().reset();
      qc.resetQueries();
    },
  });
}

export function useCreateSampleProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.createSampleProject(),
    onSuccess: () => {
      useWorkspace.getState().reset();
      qc.resetQueries();
    },
  });
}

export function useCloseProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.closeProject,
    onSuccess: () => {
      useWorkspace.getState().reset();
      qc.resetQueries();
    },
  });
}

export function useRemoveRecent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.removeRecentProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.recent }),
  });
}
