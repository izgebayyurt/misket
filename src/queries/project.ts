import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/project";
import { keys } from "./keys";
import { useWorkspace } from "@/state/workspace";

export function useProjectInfo() {
  return useQuery({ queryKey: keys.project, queryFn: api.getProjectInfo, staleTime: 5_000 });
}

export function useRecentProjects() {
  return useQuery({ queryKey: keys.recent, queryFn: api.listRecentProjects });
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
