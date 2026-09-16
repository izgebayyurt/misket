/**
 * Pure layout for the history view's branch graph: turns the flat
 * `history_tree` result into rows (newest at the top) and lanes (columns),
 * plus the SVG path data to draw the edges between them. No DOM, no chart
 * library — see `sparkline.ts` for the same idea applied to a line chart.
 *
 * A node's *lane* is which column its dot sits in. The main line — the path
 * from the root, through each node's `preferredChild` (falling back to the
 * newest child when nothing is preferred, exactly like the backend's
 * `next_child`) — always ends up in lane 0. Every other child at a fork
 * starts a new branch in the next free lane, and that lane is given back
 * once the branch rejoins its parent, so unrelated forks elsewhere in the
 * tree can reuse the same column without ever drawing through a node that
 * does not belong to them.
 */

import type { HistoryNodeSummary } from "@/api/types";

export interface LaidOutNode {
  node: HistoryNodeSummary;
  /** 0 at the top (newest); increases toward the root. */
  row: number;
  lane: number;
}

export interface HistoryEdge {
  fromId: number;
  toId: number;
  fromLane: number;
  toLane: number;
  fromRow: number;
  toRow: number;
}

export interface HistoryLayout {
  rows: LaidOutNode[];
  edges: HistoryEdge[];
  /** How many lane columns the graph needs, so the caller can size its SVG. */
  laneCount: number;
}

/**
 * The child that continues this node's own line: its `preferredChild` when
 * that child still exists, else the newest (last) child. Mirrors the
 * backend's `next_child` fallback, so the line drawn here as "the main line"
 * is exactly the path a plain redo would walk.
 */
function trunkChildId(node: HistoryNodeSummary): number | null {
  if (node.children.length === 0) return null;
  if (node.preferredChild != null && node.children.includes(node.preferredChild)) {
    return node.preferredChild;
  }
  return node.children[node.children.length - 1]!;
}

/**
 * Lay the tree out into rows and lanes.
 *
 * Rows: every node sorts above its parent — child ids are always greater
 * than their parent's, so sorting by id descending is already a valid
 * topological order — and, per the project's own convention, ordering never
 * looks at `at`, so two nodes with the same timestamp still sort the same
 * way every time.
 *
 * Lanes: processed in the same newest-to-oldest sweep as the rows, since
 * every child is visited before its parent. Each node picks its lane from
 * whichever of its children is its `trunkChildId` (the edge that continues
 * past it rather than ending there); every other child's lane is freed at
 * that same row, because nothing further down the tree can need an edge
 * that terminates here. A node with no children — the first time it is
 * reached, since nothing points at it yet — opens a fresh lane, at the
 * lowest number not already in use.
 */
export function layoutHistory(nodes: HistoryNodeSummary[]): HistoryLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ordered = [...nodes].sort((a, b) => b.id - a.id);

  let nextLane = 0;
  const freeLanes: number[] = [];
  function allocLane(): number {
    if (freeLanes.length > 0) {
      freeLanes.sort((a, b) => a - b);
      return freeLanes.shift()!;
    }
    return nextLane++;
  }

  const laneOf = new Map<number, number>();
  // For each parent id, the lane (and originating child) of every edge
  // heading toward it, collected as each child is processed before it.
  const incoming = new Map<number, { lane: number; childId: number }[]>();

  for (const node of ordered) {
    const pending = incoming.get(node.id) ?? [];
    const trunk = trunkChildId(node);
    // `pending` was pushed in id-descending order (children are always
    // processed before their parent), so `pending[0]` is the fallback for
    // malformed input: the newest child seen, same as `trunkChildId`'s own
    // fallback would pick.
    const trunkEntry = pending.find((p) => p.childId === trunk) ?? pending[0];
    let lane: number;
    if (trunkEntry) {
      lane = trunkEntry.lane;
      for (const p of pending) if (p !== trunkEntry) freeLanes.push(p.lane);
    } else {
      lane = allocLane();
    }
    laneOf.set(node.id, lane);
    if (node.parentId != null && byId.has(node.parentId)) {
      const list = incoming.get(node.parentId) ?? [];
      list.push({ lane, childId: node.id });
      incoming.set(node.parentId, list);
    }
  }

  // Relabel so the main line — root, through preferredChild, to a leaf — is
  // always lane 0, regardless of which branch happened to open first.
  const root = nodes.filter((n) => n.parentId == null || !byId.has(n.parentId)).sort((a, b) => a.id - b.id)[0];
  if (root) {
    const rootLane = laneOf.get(root.id) ?? 0;
    if (rootLane !== 0) {
      for (const [id, lane] of laneOf) {
        if (lane === 0) laneOf.set(id, rootLane);
        else if (lane === rootLane) laneOf.set(id, 0);
      }
    }
  }

  const rowOf = new Map<number, number>();
  ordered.forEach((n, i) => rowOf.set(n.id, i));

  const edges: HistoryEdge[] = [];
  for (const node of nodes) {
    if (node.parentId == null || !byId.has(node.parentId)) continue;
    edges.push({
      fromId: node.id,
      toId: node.parentId,
      fromLane: laneOf.get(node.id) ?? 0,
      toLane: laneOf.get(node.parentId) ?? 0,
      fromRow: rowOf.get(node.id) ?? 0,
      toRow: rowOf.get(node.parentId) ?? 0,
    });
  }

  const rows: LaidOutNode[] = ordered.map((node, row) => ({
    node,
    row,
    lane: laneOf.get(node.id) ?? 0,
  }));

  return { rows, edges, laneCount: nextLane };
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * An SVG `<path d>` for one edge: a straight vertical line when the child
 * stays in its parent's lane, or a gentle S-curve (vertical tangents at both
 * ends) when it has to move across to a different one.
 */
export function edgePath(edge: HistoryEdge, laneWidth: number, rowHeight: number): string {
  const x1 = edge.fromLane * laneWidth + laneWidth / 2;
  const y1 = edge.fromRow * rowHeight + rowHeight / 2;
  const x2 = edge.toLane * laneWidth + laneWidth / 2;
  const y2 = edge.toRow * rowHeight + rowHeight / 2;
  if (x1 === x2) return `M${round(x1)},${round(y1)} L${round(x2)},${round(y2)}`;
  const midY = (y1 + y2) / 2;
  return `M${round(x1)},${round(y1)} C${round(x1)},${round(midY)} ${round(x2)},${round(midY)} ${round(x2)},${round(y2)}`;
}

/** `id` and everything under it, from the same flat list `layoutHistory` reads. */
function descendantIds(nodes: HistoryNodeSummary[], id: number): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const n of nodes) {
    if (n.parentId != null) childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n.id]);
  }
  const keep = new Set<number>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (keep.has(cur)) continue;
    keep.add(cur);
    stack.push(...(childrenOf.get(cur) ?? []));
  }
  return keep;
}

/**
 * Everything not `id` or a descendant of it — what `compact_before(id)` is
 * about to drop. A dry run for the confirm dialog: the real count only comes
 * back from the backend after the compact has already happened.
 */
export function compactPreview(
  nodes: HistoryNodeSummary[],
  id: number,
): { dropped: number; droppedBranches: string[] } {
  const keep = descendantIds(nodes, id);
  const doomed = nodes.filter((n) => !keep.has(n.id));
  return {
    dropped: doomed.length,
    droppedBranches: doomed.flatMap((n) => (n.branchName ? [n.branchName] : [])),
  };
}

/**
 * Whether the project would have to move first: compacting from `id` is only
 * safe when the head is `id` itself or somewhere under it (otherwise the
 * project's current state would be thrown away with the rest).
 */
export function headIsOnOrBelow(nodes: HistoryNodeSummary[], id: number): boolean {
  const head = nodes.find((n) => n.isHead);
  if (!head) return false;
  return descendantIds(nodes, id).has(head.id);
}
