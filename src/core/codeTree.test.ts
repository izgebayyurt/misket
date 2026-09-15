import { describe, expect, it } from "vitest";
import type { Code } from "@/api/types";
import { buildCodeTree, descendantIds, flattenTree, nextColor, PALETTE, pathOf } from "./codeTree";

const mk = (id: string, parentId: string | null, sortOrder: number, color = "#000000"): Code => ({
  id,
  parentId,
  name: id.toUpperCase(),
  color,
  description: "",
  shortcut: null,
  sortOrder,
  excerptCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("codeTree", () => {
  const codes = [
    mk("b", null, 1),
    mk("a", null, 0),
    mk("a2", "a", 1),
    mk("a1", "a", 0),
    mk("a1x", "a1", 0),
  ];
  const tree = buildCodeTree(codes);

  it("builds ordered roots and children with depth", () => {
    expect(tree.roots.map((n) => n.code.id)).toEqual(["a", "b"]);
    expect(tree.byId.get("a")!.children.map((n) => n.code.id)).toEqual(["a1", "a2"]);
    expect(tree.byId.get("a1x")!.depth).toBe(2);
  });

  it("flattens depth-first and respects collapsed nodes", () => {
    expect(flattenTree(tree).map((n) => n.code.id)).toEqual(["a", "a1", "a1x", "a2", "b"]);
    expect(flattenTree(tree, new Set(["a1"])).map((n) => n.code.id)).toEqual([
      "a",
      "a1",
      "a2",
      "b",
    ]);
  });

  it("computes descendants and paths", () => {
    expect([...descendantIds(tree, "a")].sort()).toEqual(["a", "a1", "a1x", "a2"]);
    expect(descendantIds(tree, "missing").size).toBe(0);
    expect(pathOf(tree, "a1x")).toBe("A / A1 / A1X");
  });

  it("orphans (parent missing) become roots", () => {
    const t = buildCodeTree([mk("x", "gone", 0)]);
    expect(t.roots.map((n) => n.code.id)).toEqual(["x"]);
  });

  it("picks the least-used palette color", () => {
    expect(nextColor([])).toBe(PALETTE[0]);
    expect(nextColor([mk("a", null, 0, PALETTE[0]!)])).toBe(PALETTE[1]);
    const all = PALETTE.map((c, i) => mk(String(i), null, i, c));
    expect(nextColor([...all, mk("z", null, 99, PALETTE[0]!)])).toBe(PALETTE[1]);
  });
});
