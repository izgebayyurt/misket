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
