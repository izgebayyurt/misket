import { describe, expect, it } from "vitest";
import type { Code } from "@/api/types";
import {
  buildCodeTree,
  descendantIds,
  flattenTree,
  IN_VIVO_NAME_MAX,
  inVivoName,
  nextColor,
  PALETTE,
  pathOf,
  siblingNames,
  uniqueSiblingName,
} from "./codeTree";

const mk = (id: string, parentId: string | null, sortOrder: number, color = "#000000"): Code => ({
  id,
  parentId,
  name: id.toUpperCase(),
  color,
  description: "",
  inclusion: "",
  exclusion: "",
  exampleExcerptId: null,
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

describe("in vivo names", () => {
  it("collapses whitespace and trims", () => {
    expect(inVivoName("  it just\n  feels   safer ")).toBe("it just feels safer");
    expect(inVivoName("\n\t ")).toBe("");
  });

  it("caps the name without leaving a trailing space", () => {
    const long = "word ".repeat(40);
    const name = inVivoName(long);
    expect(name.length).toBeLessThanOrEqual(IN_VIVO_NAME_MAX);
    expect(name).toBe(name.trimEnd());
    // A selection exactly at the limit is kept whole.
    const exact = "x".repeat(IN_VIVO_NAME_MAX);
    expect(inVivoName(exact)).toBe(exact);
  });

  it("de-duplicates against sibling names, case-insensitively", () => {
    expect(uniqueSiblingName("Trust", [])).toBe("Trust");
    expect(uniqueSiblingName("Trust", ["Doubt"])).toBe("Trust");
    expect(uniqueSiblingName("Trust", ["trust"])).toBe("Trust (2)");
    expect(uniqueSiblingName("Trust", ["Trust", "Trust (2)"])).toBe("Trust (3)");
    // A gap is filled rather than skipped past.
    expect(uniqueSiblingName("Trust", ["Trust", "Trust (3)"])).toBe("Trust (2)");
  });

  it("reads sibling names from the tree, root level included", () => {
    const tree = buildCodeTree([mk("a", null, 0), mk("b", null, 1), mk("a1", "a", 0)]);
    expect(siblingNames(tree, null)).toEqual(["A", "B"]);
    expect(siblingNames(tree, "a")).toEqual(["A1"]);
    expect(siblingNames(tree, "missing")).toEqual([]);
  });
});
