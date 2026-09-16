import { useQuery } from "@tanstack/react-query";
import * as api from "@/api/activity";
import type { ActivityFilter } from "@/api/types";
import { keys } from "./keys";

/**
 * The activity log is written by every mutation in the app, so nothing here
 * tries to keep a cache warm: these queries refetch whenever the panel that
 * shows them is mounted or the window regains focus.
 */
const FRESH = { staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true } as const;

export function useActivity(filter: ActivityFilter) {
  return useQuery({
    queryKey: keys.activityList(filter),
    queryFn: () => api.listActivity(filter),
    ...FRESH,
  });
}

export function useCodeHistory(codeId: string | null) {
  return useQuery({
    queryKey: keys.codeHistory(codeId ?? ""),
    queryFn: () => api.codeHistory(codeId!),
    enabled: !!codeId,
    ...FRESH,
  });
}

export function useExcerptHistory(excerptId: string | null) {
  return useQuery({
    queryKey: keys.excerptHistory(excerptId ?? ""),
    queryFn: () => api.excerptHistory(excerptId!),
    enabled: !!excerptId,
    ...FRESH,
  });
}
