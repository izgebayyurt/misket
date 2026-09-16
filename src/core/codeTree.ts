import type { Code } from "@/api/types";

export interface CodeNode {
  code: Code;
  children: CodeNode[];
  depth: number;
}

export interface CodeTree {
  roots: CodeNode[];
  byId: Map<string, CodeNode>;
}

/** Build a tree from the flat list; siblings keep their `sortOrder`. */
export function buildCodeTree(codes: Code[]): CodeTree {
  const byId = new Map<string, CodeNode>();
  for (const code of codes) byId.set(code.id, { code, children: [], depth: 0 });
  const roots: CodeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.code.parentId ? byId.get(node.code.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const bySort = (a: CodeNode, b: CodeNode) =>
    a.code.sortOrder - b.code.sortOrder || a.code.createdAt.localeCompare(b.code.createdAt);
  const visit = (nodes: CodeNode[], depth: number) => {
    nodes.sort(bySort);
    for (const n of nodes) {
      n.depth = depth;
      visit(n.children, depth + 1);
    }
  };
  visit(roots, 0);
  return { roots, byId };
}

/** Depth-first flattening in display order. */
export function flattenTree(tree: CodeTree, collapsed?: Set<string>): CodeNode[] {
  const out: CodeNode[] = [];
  const visit = (nodes: CodeNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (!collapsed?.has(n.code.id)) visit(n.children);
    }
  };
  visit(tree.roots);
  return out;
}

/** Ids of a node and everything below it. */
export function descendantIds(tree: CodeTree, id: string): Set<string> {
  const out = new Set<string>();
  const node = tree.byId.get(id);
  if (!node) return out;
  const visit = (n: CodeNode) => {
    out.add(n.code.id);
    n.children.forEach(visit);
  };
  visit(node);
  return out;
}

/** "Parent / Child / Leaf" for display. */
export function pathOf(tree: CodeTree, id: string, sep = " / "): string {
  const parts: string[] = [];
  let cur = tree.byId.get(id);
  while (cur) {
    parts.unshift(cur.code.name);
    cur = cur.code.parentId ? tree.byId.get(cur.code.parentId) : undefined;
  }
  return parts.join(sep);
}

export const PALETTE = [
  "#D9534F",
  "#F0AD4E",
  "#5CB85C",
  "#5BC0DE",
  "#8E6BBF",
  "#E96FA6",
  "#2E8B8B",
  "#C77D3C",
  "#4A6FA5",
  "#8AA63B",
  "#B05C8A",
  "#6C757D",
];

/** The least-used palette color, for a new code. */
export function nextColor(codes: Code[]): string {
  const counts = new Map(PALETTE.map((c) => [c, 0]));
  for (const c of codes) {
    const key = c.color.toUpperCase();
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = PALETTE[0]!;
  let bestCount = Infinity;
  for (const color of PALETTE) {
    const n = counts.get(color) ?? 0;
    if (n < bestCount) {
      best = color;
      bestCount = n;
    }
  }
  return best;
}

/** Simple case-insensitive substring match on the full path. */
export function matchesQuery(tree: CodeTree, id: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return pathOf(tree, id).toLowerCase().includes(q);
}

/** How long an in vivo code name may get before it is cut short. */
export const IN_VIVO_NAME_MAX = 60;

/**
 * Turn a text selection into a code name: collapse every run of whitespace
 * (a quote spanning a line break should not carry the break into the
 * codebook), trim, and cut at {@link IN_VIVO_NAME_MAX} characters without
 * leaving a trailing space. Returns "" if there is nothing usable.
 */
export function inVivoName(selection: string): string {
  const collapsed = selection.replace(/\s+/g, " ").trim();
  return collapsed.length <= IN_VIVO_NAME_MAX
    ? collapsed
    : collapsed.slice(0, IN_VIVO_NAME_MAX).trimEnd();
}

/**
 * Make `name` unique among `siblings`, the way the database's
 * case-insensitive sibling-name index requires: "Trust", then "Trust (2)",
 * "Trust (3)"… Coding the same phrase twice should add a second code rather
 * than fail with a conflict.
 */
export function uniqueSiblingName(name: string, siblings: string[]): string {
  const taken = new Set(siblings.map((s) => s.trim().toLowerCase()));
  if (!taken.has(name.trim().toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** The names of a parent's direct children (or of the root codes). */
export function siblingNames(tree: CodeTree, parentId: string | null): string[] {
  const nodes = parentId ? (tree.byId.get(parentId)?.children ?? []) : tree.roots;
  return nodes.map((n) => n.code.name);
}
