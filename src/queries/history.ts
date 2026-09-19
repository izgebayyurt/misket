import { useQuery } from "@tanstack/react-query";
import i18next from "@/lib/i18n";
import * as api from "@/api/history";
import type { HistoryNode } from "@/api/types";
import { keys } from "./keys";
import { queryClient } from "./client";
import { TOAST_KEYS, toast } from "@/state/toasts";

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
 * One step in full, for the detail panel: the payload it recorded plus the
 * names its references read by *now*. Keyed by node id and refetched on
 * mount, since a later step can rename or delete what this one points at.
 */
export function useHistoryNode(id: number | null) {
  return useQuery({
    queryKey: keys.historyNode(id ?? 0),
    queryFn: () => api.historyNode(id!),
    enabled: id != null,
    staleTime: 0,
    refetchOnMount: "always",
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
  toast.info(i18next.t("history.movedTo", { summary: node.summary }), {
    key: TOAST_KEYS.timeTravel,
  });
}

/**
 * Check out `id`, then name it: "Fork here…" always forks at the head.
 *
 * Returns the node that now carries the name — which is the step the fork
 * grew from, and what the view selects and scrolls to, so a fork is visible
 * the moment it is made.
 */
export async function forkHistoryNode(id: number, name: string): Promise<HistoryNode> {
  await api.historyCheckout(id);
  const node = await api.historyFork(name);
  await queryClient.invalidateQueries();
  toast.info(i18next.t("history.forkedHere", { name }));
  return node;
}

export async function renameHistoryBranch(id: number, name: string | null): Promise<void> {
  await api.historyRenameBranch(id, name);
  await queryClient.invalidateQueries({ queryKey: keys.history });
  toast.info(
    name ? i18next.t("history.branchRenamed", { name }) : i18next.t("history.branchNameCleared"),
  );
}

export async function compactHistoryBefore(id: number): Promise<void> {
  const report = await api.historyCompact(id);
  await queryClient.invalidateQueries();
  toast.info(
    report.droppedNodes === 0
      ? i18next.t("history.nothingToCompact")
      : i18next.t("history.compacted", { count: report.droppedNodes }),
  );
}
