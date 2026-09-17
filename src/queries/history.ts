import { useQuery } from "@tanstack/react-query";
import * as api from "@/api/history";
import { keys } from "./keys";
import { queryClient } from "./client";
import { toast } from "@/state/toasts";

/**
 * The whole undo tree, for the branch graph. Every mutation in the app can
 * move it (any write appends a node, and undo/redo/checkout move the head),
 * so — like the activity feed — this refetches on mount and on window focus
 * rather than trusting a cache.
 */
export function useHistoryTree() {
  return useQuery({
    queryKey: keys.history,
    queryFn: api.historyTree,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

/**
 * Move the project to `id` and refresh everything, the same way
 * `useUndoStore`'s undo/redo do — a checkout can touch any part of the
 * project, not just the history tree itself.
 */
export async function checkoutHistoryNode(id: number): Promise<void> {
  const node = await api.historyCheckout(id);
  await queryClient.invalidateQueries();
  toast.info(`Moved to: ${node.summary}`);
}

/** Check out `id`, then name it: "Fork here…" always forks at the head. */
export async function forkHistoryNode(id: number, name: string): Promise<void> {
  await api.historyCheckout(id);
  await api.historyFork(name);
  await queryClient.invalidateQueries();
  toast.info(`Forked: ${name}`);
}

export async function renameHistoryBranch(id: number, name: string | null): Promise<void> {
  await api.historyRenameBranch(id, name);
  await queryClient.invalidateQueries({ queryKey: keys.history });
  toast.info(name ? `Branch renamed: ${name}` : "Branch name cleared");
}

export async function compactHistoryBefore(id: number): Promise<void> {
  const report = await api.historyCompact(id);
  await queryClient.invalidateQueries();
  toast.info(
    report.droppedNodes === 0
      ? "Nothing to compact"
      : `Compacted: dropped ${report.droppedNodes.toLocaleString()} step${report.droppedNodes === 1 ? "" : "s"}`,
  );
}
