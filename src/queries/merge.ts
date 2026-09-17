import { useMutation } from "@tanstack/react-query";
import * as api from "@/api/merge";
import type { MergeDecision } from "@/api/types";
import { queryClient } from "./client";

/**
 * Pulling another copy touches documents, codes, excerpts, memos, sets and
 * the framework at once, so nothing in the cache is still known fresh.
 */
export function usePullFromCopy() {
  return useMutation({
    mutationFn: (args: { path: string; decisions: MergeDecision[] }) =>
      api.mergeApply(args.path, args.decisions),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
