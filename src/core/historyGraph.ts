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
  const root = nodes
    .filter((n) => n.parentId == null || !byId.has(n.parentId))
    .sort((a, b) => a.id - b.id)[0];
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
    if (n.parentId != null)
      childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n.id]);
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

// ---------------------------------------------------------------- day groups

/**
 * The local calendar day a step happened on, as `YYYY-MM-DD`.
 *
 * Local, not UTC: a step made at 11pm belongs to the day the person who made
 * it would name. Unparseable input gets its own `""` bucket rather than
 * throwing the whole list away.
 */
export function dayKey(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const month = `${t.getMonth() + 1}`.padStart(2, "0");
  const day = `${t.getDate()}`.padStart(2, "0");
  return `${t.getFullYear()}-${month}-${day}`;
}

/** `Today`, `Yesterday`, then a plain `Mon 14 Sep 2026`. */
export function dayLabel(day: string, now: number = Date.now()): string {
  if (day === "") return "Undated";
  const today = dayKey(new Date(now).toISOString());
  if (day === today) return "Today";
  const yesterday = dayKey(new Date(now - 24 * 60 * 60 * 1000).toISOString());
  if (day === yesterday) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  // Composed rather than one `toLocaleDateString` call, so the order and the
  // punctuation are the same everywhere while the names stay localized.
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  const month = date.toLocaleDateString(undefined, { month: "short" });
  return `${weekday} ${date.getDate()} ${month} ${date.getFullYear()}`;
}

/**
 * What to call a kind in a day's digest, singular and plural. Several kinds
 * share a phrase on purpose — creating an excerpt and adding a code to one are
 * both "codings" to someone scanning a day — and the digest counts by phrase,
 * not by kind, so they add up into one number.
 */
const DIGEST_PHRASES: Record<string, [string, string]> = {
  "excerpt.created": ["coding", "codings"],
  "excerpt.codes_added": ["coding", "codings"],
  "excerpt.restored": ["coding", "codings"],
  "bulk.codes_added": ["bulk coding", "bulk codings"],
  "bulk.auto_coded": ["auto-coding", "auto-codings"],
  "bulk.retagged": ["recoding", "recodings"],
  "excerpt.code_removed": ["code removed", "codes removed"],
  "bulk.codes_removed": ["code removed", "codes removed"],
  "excerpt.deleted": ["excerpt deleted", "excerpts deleted"],
  "bulk.excerpts_deleted": ["excerpt deleted", "excerpts deleted"],
  "excerpt.range_updated": ["excerpt edit", "excerpt edits"],
  "excerpt.split": ["excerpt edit", "excerpt edits"],
  "excerpt.split_off": ["excerpt edit", "excerpt edits"],
  "excerpt.merged": ["excerpt edit", "excerpt edits"],
  "excerpt.merged_into": ["excerpt edit", "excerpt edits"],
  "code.created": ["code created", "codes created"],
  "code.updated": ["code edit", "code edits"],
  "code.moved": ["code edit", "code edits"],
  "code.deleted": ["code deleted", "codes deleted"],
  "code.merged_into": ["merge", "merges"],
  "code.merged_from": ["merge", "merges"],
  "codebook.imported": ["codebook import", "codebook imports"],
  "document.imported": ["document imported", "documents imported"],
  "document.deleted": ["document deleted", "documents deleted"],
  "document.renamed": ["document renamed", "documents renamed"],
  "document.reordered": ["document reordered", "documents reordered"],
  "memo.created": ["memo", "memos"],
  "memo.updated": ["memo", "memos"],
  "memo.deleted": ["memo deleted", "memos deleted"],
  "memo.restored": ["memo", "memos"],
  "descriptor.value_set": ["descriptor set", "descriptors set"],
  "descriptor.field_created": ["descriptor field", "descriptor fields"],
  "descriptor.field_updated": ["descriptor field", "descriptor fields"],
  "descriptor.field_deleted": ["descriptor field", "descriptor fields"],
  "descriptor.fields_reordered": ["descriptor field", "descriptor fields"],
  "set.created": ["set change", "set changes"],
  "set.renamed": ["set change", "set changes"],
  "set.deleted": ["set change", "set changes"],
  "set.members_changed": ["set change", "set changes"],
  "filter.saved": ["saved filter", "saved filters"],
  "filter.deleted": ["saved filter", "saved filters"],
  "framework.matrix_created": ["framework edit", "framework edits"],
  "framework.matrix_updated": ["framework edit", "framework edits"],
  "framework.matrix_deleted": ["framework edit", "framework edits"],
  "framework.cell_set": ["framework cell", "framework cells"],
  "transcript.format_set": ["transcript setting", "transcript settings"],
  "transcript.default_set": ["transcript setting", "transcript settings"],
  "analysis.stop_words_set": ["stop-word edit", "stop-word edits"],
  "project.renamed": ["project renamed", "project renames"],
  "project.pulled": ["pull", "pulls"],
};

/** The fallback phrase for a kind not in the table: `code change(s)`. */
function digestPhrase(kind: string): [string, string] {
  const known = DIGEST_PHRASES[kind];
  if (known) return known;
  const group = kind.includes(".") ? kind.slice(0, kind.indexOf(".")) : kind;
  return [`${group} change`, `${group} changes`];
}

/**
 * A day's one-line summary — `12 codings, 3 codes created, 1 merge` — from
 * the steps it holds. The three commonest phrases, biggest first, and
 * `+ 4 more` for whatever is left, so the line never grows past a glance.
 */
export function dayDigest(nodes: HistoryNodeSummary[]): string {
  const counts = new Map<string, { n: number; one: string; many: string }>();
  for (const node of nodes) {
    const [one, many] = digestPhrase(node.kind);
    const entry = counts.get(one) ?? { n: 0, one, many };
    // A compound step counts as the one action it stands for, not as its
    // members: that is how it reads in the list.
    entry.n += 1;
    counts.set(one, entry);
  }
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n || a.one.localeCompare(b.one));
  const shown = ranked.slice(0, 3).map((e) => `${e.n} ${e.n === 1 ? e.one : e.many}`);
  const rest = ranked.slice(3).reduce((sum, e) => sum + e.n, 0);
  if (rest > 0) shown.push(`+ ${rest} more`);
  return shown.join(", ");
}

/** One day's worth of laid-out rows, in the order the graph puts them. */
export interface DayGroup {
  day: string;
  label: string;
  rows: LaidOutNode[];
}

/**
 * Split the laid-out rows into runs of the same calendar day, newest first.
 *
 * A run, not a bucket: the rows are ordered by id, and a clock that jumped
 * backwards could put yesterday below today again. Two runs of the same day
 * then get a header each rather than one of them being lifted out of order.
 */
export function groupByDay(rows: LaidOutNode[], now: number = Date.now()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const row of rows) {
    const day = dayKey(row.node.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, label: dayLabel(day, now), rows: [row] });
  }
  return groups;
}

/**
 * The days that start out open: the one the project is currently at, and any
 * day that holds a fork or a named branch.
 *
 * Collapsing is meant to shorten a long list, never to hide the shape of the
 * tree — so no day that carries a branch point or a branch name is ever
 * closed by default.
 */
export function defaultExpandedDays(rows: LaidOutNode[]): string[] {
  const open = new Set<string>();
  for (const { node } of rows) {
    if (node.isHead || node.branchName || node.children.length > 1) open.add(dayKey(node.at));
  }
  return [...open];
}

/** A day's header row in the display list. */
export interface DayHeaderRow {
  kind: "day";
  row: number;
  day: string;
  label: string;
  /** How many steps happened that day. */
  count: number;
  digest: string;
  expanded: boolean;
  /**
   * Every lane with a line running through this row: the lanes of the steps
   * inside it, plus the lanes of branches that merely pass by. A collapsed
   * day is one row, and the graph still has to be drawable across it.
   */
  lanes: number[];
  /** Branch names on the steps inside, for the chips on a collapsed header. */
  branchNames: string[];
  /** A step that day has more than one child: the graph forks inside it. */
  hasBranchPoint: boolean;
  /** The project is currently at a step from that day. */
  hasHead: boolean;
}

/** One step's row in the display list. */
export interface StepRow {
  kind: "step";
  row: number;
  lane: number;
  node: HistoryNodeSummary;
  day: string;
}

export type DisplayRow = DayHeaderRow | StepRow;

export interface CollapsedLayout {
  rows: DisplayRow[];
  /** Edges in display-row coordinates, ready for `edgePath`. */
  edges: HistoryEdge[];
}

/**
 * Map the laid-out rows into the rows actually drawn: a header per day, and
 * that day's steps under it only while the day is open.
 *
 * Collapsing changes which row a step is *drawn* at, not the graph: a step in
 * a closed day is drawn at its day's header row, so every edge still starts
 * and ends somewhere and the lanes read continuously across the closed day.
 * Edges that would begin and end on the same row (two steps of one closed
 * day) are dropped, having nothing left to draw.
 */
export function collapseDays(
  rows: LaidOutNode[],
  expandedDays: ReadonlySet<string>,
  now: number = Date.now(),
): CollapsedLayout {
  const groups = groupByDay(rows, now);
  const laneOf = new Map(rows.map((r) => [r.node.id, r.lane]));
  const rowOf = new Map(rows.map((r) => [r.node.id, r.row]));

  const display: DisplayRow[] = [];
  const displayRowOf = new Map<number, number>();
  for (const group of groups) {
    const expanded = expandedDays.has(group.day);
    const first = group.rows[0]!.row;
    const last = group.rows[group.rows.length - 1]!.row;
    const header: DayHeaderRow = {
      kind: "day",
      row: display.length,
      day: group.day,
      label: group.label,
      count: group.rows.length,
      digest: dayDigest(group.rows.map((r) => r.node)),
      expanded,
      lanes: lanesThrough(rows, laneOf, rowOf, first, last),
      branchNames: group.rows.flatMap((r) => (r.node.branchName ? [r.node.branchName] : [])),
      hasBranchPoint: group.rows.some((r) => r.node.children.length > 1),
      hasHead: group.rows.some((r) => r.node.isHead),
    };
    display.push(header);
    for (const laid of group.rows) {
      if (expanded) {
        displayRowOf.set(laid.node.id, display.length);
        display.push({
          kind: "step",
          row: display.length,
          lane: laid.lane,
          node: laid.node,
          day: group.day,
        });
      } else {
        // Drawn at the header: the day is one row now.
        displayRowOf.set(laid.node.id, header.row);
      }
    }
  }

  const edges: HistoryEdge[] = [];
  for (const { node } of rows) {
    if (node.parentId == null) continue;
    const fromRow = displayRowOf.get(node.id);
    const toRow = displayRowOf.get(node.parentId);
    if (fromRow == null || toRow == null || fromRow === toRow) continue;
    edges.push({
      fromId: node.id,
      toId: node.parentId,
      fromLane: laneOf.get(node.id) ?? 0,
      toLane: laneOf.get(node.parentId) ?? 0,
      fromRow,
      toRow,
    });
  }
  return { rows: display, edges };
}

/**
 * Which lanes have a line crossing the original rows `first..last`: the lanes
 * of the steps in that range, plus any lane whose edge spans right over it.
 */
function lanesThrough(
  rows: LaidOutNode[],
  laneOf: Map<number, number>,
  rowOf: Map<number, number>,
  first: number,
  last: number,
): number[] {
  const lanes = new Set<number>();
  for (const r of rows) {
    if (r.row >= first && r.row <= last) lanes.add(r.lane);
  }
  for (const { node } of rows) {
    if (node.parentId == null) continue;
    const from = rowOf.get(node.id);
    const to = rowOf.get(node.parentId);
    if (from == null || to == null) continue;
    // Strictly spanning: an edge merely touching the range is already
    // accounted for by the step at that end.
    if (from < first && to > last) {
      lanes.add(laneOf.get(node.id) ?? 0);
      lanes.add(laneOf.get(node.parentId) ?? 0);
    }
  }
  return [...lanes].sort((a, b) => a - b);
}

// ------------------------------------------------------------------ branches

/** A named branch (or `main`) as the Branches strip shows it. */
export interface BranchInfo {
  /** The branch name; `main` for the line the root's own trunk follows. */
  name: string;
  /**
   * The step the branch grows from — where to go to "see where the fork
   * occurred". For `main` this is the root.
   */
  forkPointId: number;
  /** The newest step on the branch: what clicking the chip checks out. */
  tipId: number;
  tipSummary: string;
  /** The project is currently somewhere on this branch. */
  isCurrent: boolean;
  /**
   * Whether the fork point actually divides yet. A branch made with "Fork
   * here…" and not edited since has no separate line of its own, and the
   * graph draws it as a stub off its node rather than as a lane.
   */
  diverged: boolean;
}

/** The child that continues a node's own line, by id. */
function trunkOf(byId: Map<number, HistoryNodeSummary>, node: HistoryNodeSummary): number | null {
  const id = trunkChildId(node);
  return id != null && byId.has(id) ? id : null;
}

/** Follow a node's own line down to its newest step. */
function tipFrom(byId: Map<number, HistoryNodeSummary>, id: number): HistoryNodeSummary {
  let node = byId.get(id)!;
  for (let guard = byId.size; guard > 0; guard--) {
    const next = trunkOf(byId, node);
    if (next == null) break;
    node = byId.get(next)!;
  }
  return node;
}

/**
 * Where a named branch left the line it grew out of.
 *
 * "Fork here…" puts the name on the step the branch grows from, so that step
 * is the answer: it is the fork once it has more than one child (the old
 * continuation and the new branch), and until then it is still the point to
 * come back to. Only when the name sits on a step that the branch merely runs
 * *through* — one child, which takes renaming a branch by hand — does this
 * look further up for the nearest step whose line actually divides.
 */
export function forkPointOf(nodes: HistoryNodeSummary[], branchNodeId: number): number | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const named = byId.get(branchNodeId);
  if (!named) return null;
  if (named.children.length !== 1) return named.id;
  let cur = named;
  for (let guard = nodes.length; guard > 0; guard--) {
    const parent = cur.parentId == null ? undefined : byId.get(cur.parentId);
    if (!parent) break;
    if (parent.children.length > 1) return parent.id;
    cur = parent;
  }
  return named.id;
}

/**
 * The name of the branch the project is on: the nearest named step at or
 * above the head, or `main` when there is none above it.
 */
export function currentBranchName(nodes: HistoryNodeSummary[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur = nodes.find((n) => n.isHead);
  for (let guard = nodes.length; guard > 0 && cur; guard--) {
    if (cur.branchName) return cur.branchName;
    cur = cur.parentId == null ? undefined : byId.get(cur.parentId);
  }
  return "main";
}

/**
 * The Branches strip: `main` first, then every named branch, newest name
 * last, each with its fork point and its tip.
 */
export function branchesOf(nodes: HistoryNodeSummary[]): BranchInfo[] {
  if (nodes.length === 0) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const current = currentBranchName(nodes);
  const out: BranchInfo[] = [];

  const root = nodes
    .filter((n) => n.parentId == null || !byId.has(n.parentId))
    .sort((a, b) => a.id - b.id)[0];
  if (root) {
    const tip = tipFrom(byId, root.id);
    out.push({
      name: "main",
      forkPointId: root.id,
      tipId: tip.id,
      tipSummary: tip.summary,
      isCurrent: current === "main",
      diverged: true,
    });
  }
  for (const node of [...nodes].sort((a, b) => a.id - b.id)) {
    if (!node.branchName) continue;
    const tip = tipFrom(byId, node.id);
    out.push({
      name: node.branchName,
      forkPointId: forkPointOf(nodes, node.id) ?? node.id,
      tipId: tip.id,
      tipSummary: tip.summary,
      isCurrent: current === node.branchName,
      diverged: node.children.length > 1,
    });
  }
  return out;
}

/**
 * Branch names to draw as a stub off their own step: a fork nobody has built
 * on yet, which owns no lane because nothing has diverged from it. Without
 * this a fresh fork would leave no mark on the graph at all.
 */
export function undivergedBranches(nodes: HistoryNodeSummary[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const node of nodes) {
    if (node.branchName && node.children.length === 0) out.set(node.id, node.branchName);
  }
  return out;
}
