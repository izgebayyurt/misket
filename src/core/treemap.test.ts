import { describe, expect, it } from "vitest";
import type { Code, CodeFrequency } from "@/api/types";
import { buildCodeTree } from "./codeTree";
import {
  canLabel,
  layoutLevel,
  squarify,
  squarifySorted,
  tintFor,
  treemapForest,
  type TreemapCode,
  type TreemapLeaf,
  type TreemapRect,
} from "./treemap";

const RECT: TreemapRect = { x: 0, y: 0, w: 400, h: 300 };

function area(l: TreemapLeaf): number {
  return l.w * l.h;
}

function overlaps(a: TreemapLeaf, b: TreemapLeaf): boolean {
  return (
    a.x < b.x + b.w - 1e-6 &&
    b.x < a.x + a.w - 1e-6 &&
    a.y < b.y + b.h - 1e-6 &&
    b.y < a.y + a.h - 1e-6
  );
}

function within(rect: TreemapRect, outer: TreemapRect, eps = 1e-6): boolean {
  return (
    rect.x >= outer.x - eps &&
    rect.y >= outer.y - eps &&
    rect.x + rect.w <= outer.x + outer.w + eps &&
    rect.y + rect.h <= outer.y + outer.h + eps
  );
}

describe("squarify", () => {
  it("returns nothing for no items or a degenerate rect", () => {
    expect(squarify([], RECT)).toEqual([]);
    expect(squarify([{ id: "a", value: 1 }], { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
    expect(squarify([{ id: "a", value: 1 }], { x: 0, y: 0, w: 10, h: -1 })).toEqual([]);
  });

  it("drops non-positive values", () => {
    const out = squarify(
      [
        { id: "a", value: 10 },
        { id: "zero", value: 0 },
        { id: "neg", value: -5 },
      ],
      RECT,
    );
    expect(out.map((l) => l.id)).toEqual(["a"]);
  });

  it("gives one item the whole rect", () => {
    const [only] = squarify([{ id: "a", value: 7 }], RECT);
    expect(only!.x).toBeCloseTo(0);
    expect(only!.y).toBeCloseTo(0);
    expect(only!.w).toBeCloseTo(400);
    expect(only!.h).toBeCloseTo(300);
  });

  it("splits two equal items into two equal halves along the longer side", () => {
    const out = squarify(
      [
        { id: "a", value: 1 },
        { id: "b", value: 1 },
      ],
      RECT,
    );
    expect(out).toHaveLength(2);
    // 400x300: w > h, so the split is vertical (two 200x300 halves).
    for (const l of out) {
      expect(l.w).toBeCloseTo(200);
      expect(l.h).toBeCloseTo(300);
    }
    expect(out[0]!.x).toBeCloseTo(0);
    expect(out[1]!.x).toBeCloseTo(200);
  });

  it("keeps areas exactly proportional to value", () => {
    const items = [
      { id: "a", value: 50 },
      { id: "b", value: 30 },
      { id: "c", value: 15 },
      { id: "d", value: 5 },
    ];
    const out = squarifySorted(items, RECT);
    const total = items.reduce((a, i) => a + i.value, 0);
    const rectArea = RECT.w * RECT.h;
    const byId = new Map(out.map((l) => [l.id, l]));
    for (const item of items) {
      const leaf = byId.get(item.id)!;
      expect(area(leaf)).toBeCloseTo((item.value / total) * rectArea, 5);
    }
  });

  it("produces cells that stay within the outer rect and never overlap", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, value: (i + 1) * 3 }));
    const out = squarifySorted(items, RECT);
    for (const l of out) expect(within(l, RECT)).toBe(true);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect(overlaps(out[i]!, out[j]!)).toBe(false);
      }
    }
  });

  it("tiles the rect exactly (areas sum to the rect's area, no gaps)", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, value: (i + 1) ** 2 }));
    const out = squarifySorted(items, RECT);
    const sum = out.reduce((a, l) => a + area(l), 0);
    expect(sum).toBeCloseTo(RECT.w * RECT.h, 5);
  });

  it("keeps aspect ratios reasonable on a skewed, many-item input", () => {
    // A classic lopsided distribution (one big item, a long tail), the case
    // squarify is meant to handle better than a naive slice-and-dice.
    const items = [100, 40, 30, 20, 10, 8, 6, 4, 2, 1].map((value, i) => ({
      id: `n${i}`,
      value,
    }));
    const out = squarifySorted(items, RECT);
    for (const l of out) {
      const ratio = Math.max(l.w / l.h, l.h / l.w);
      // Squarify's whole point is bounding this; a generous ceiling still
      // catches a regression to naive slice-and-dice (which produces
      // ratios in the hundreds for a tail this long).
      expect(ratio).toBeLessThan(8);
    }
  });

  it("lays out a single row (all items fit one strip) left to right when wide", () => {
    const out = squarify(
      [
        { id: "a", value: 3 },
        { id: "b", value: 1 },
      ],
      { x: 0, y: 0, w: 1000, h: 10 },
    );
    // Extremely wide rect: both items are best laid out side by side.
    expect(out.every((l) => Math.abs(l.h - 10) < 1e-6)).toBe(true);
  });
});

describe("squarifySorted", () => {
  it("does not mutate the input array's order", () => {
    const items = [
      { id: "small", value: 1 },
      { id: "big", value: 100 },
    ];
    const copy = items.map((i) => ({ ...i }));
    squarifySorted(items, RECT);
    expect(items).toEqual(copy);
  });

  it("places the largest value first regardless of input order", () => {
    const out = squarifySorted(
      [
        { id: "small", value: 1 },
        { id: "big", value: 100 },
      ],
      RECT,
    );
    const big = out.find((l) => l.id === "big")!;
    // The largest item anchors the top-left corner in squarify's convention.
    expect(big.x).toBe(0);
    expect(big.y).toBe(0);
  });
});

describe("layoutLevel", () => {
  const leaf = (id: string, value: number): TreemapCode => ({
    id,
    name: id,
    color: "#000",
    value,
    children: [],
  });

  it("fills the rect with a leaf's own cell when it has no children", () => {
    const node = leaf("only", 10);
    const { cells } = layoutLevel(node, RECT);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ id: "only", x: 0, y: 0, w: 400, h: 300 });
    expect(cells[0]!.code).toBe(node);
  });

  it("lays out direct children, not the node itself, when it has them", () => {
    const node: TreemapCode = {
      id: "root",
      name: "root",
      color: "#000",
      value: 3,
      children: [leaf("a", 2), leaf("b", 1)],
    };
    const { cells } = layoutLevel(node, RECT);
    expect(cells.map((c) => c.id).sort()).toEqual(["a", "b"]);
    const total = cells.reduce((s, c) => s + c.w * c.h, 0);
    expect(total).toBeCloseTo(RECT.w * RECT.h, 5);
  });

  it("omits grandchildren — one drill level only", () => {
    const grandchild = leaf("grandchild", 5);
    const child: TreemapCode = {
      id: "child",
      name: "child",
      color: "#000",
      value: 5,
      children: [grandchild],
    };
    const node: TreemapCode = {
      id: "root",
      name: "root",
      color: "#000",
      value: 5,
      children: [child],
    };
    const { cells } = layoutLevel(node, RECT);
    expect(cells.map((c) => c.id)).toEqual(["child"]);
  });
});

function code(id: string, parentId: string | null, extra: Partial<Code> = {}): Code {
  return {
    id,
    parentId,
    name: id,
    color: "#123456",
    description: "",
    inclusion: "",
    exclusion: "",
    exampleExcerptId: null,
    shortcut: null,
    sortOrder: 0,
    excerptCount: 0,
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...extra,
  };
}

function freq(codeId: string, own: number, withDescendants: number): CodeFrequency {
  return { codeId, own, withDescendants, documentCount: 0, perDocument: [] };
}

describe("treemapForest", () => {
  it("builds one tree per root, own counts as leaves", () => {
    const tree = buildCodeTree([code("root", null), code("child", "root")]);
    const [forest] = treemapForest(tree, [freq("root", 2, 5), freq("child", 3, 3)], true);
    expect(forest).toMatchObject({ id: "root", value: 2 });
    expect(forest!.children).toMatchObject([{ id: "child", value: 3 }]);
  });

  it("uses withDescendants when ownOnly is false", () => {
    const tree = buildCodeTree([code("root", null), code("child", "root")]);
    const [forest] = treemapForest(tree, [freq("root", 2, 5), freq("child", 3, 3)], false);
    expect(forest!.value).toBe(5);
    expect(forest!.children[0]!.value).toBe(3);
  });

  it("gives a code missing from the frequency list a value of 0", () => {
    const tree = buildCodeTree([code("lonely", null)]);
    const [forest] = treemapForest(tree, [], true);
    expect(forest!.value).toBe(0);
  });

  it("carries the code's own colour and name onto the treemap node", () => {
    const tree = buildCodeTree([code("a", null, { name: "Trust", color: "#ABCDEF" })]);
    const [forest] = treemapForest(tree, [freq("a", 1, 1)], true);
    expect(forest).toMatchObject({ name: "Trust", color: "#ABCDEF" });
  });
});

describe("tintFor", () => {
  it("is 0 at the drill level's own depth", () => {
    expect(tintFor(2, 2)).toBe(0);
  });

  it("increases with depth below the drilled node and caps out", () => {
    expect(tintFor(0, 1)).toBeGreaterThan(0);
    expect(tintFor(0, 2)).toBeGreaterThan(tintFor(0, 1));
    expect(tintFor(0, 100)).toBeLessThanOrEqual(0.75);
  });

  it("never goes negative for a cell above the base depth", () => {
    expect(tintFor(3, 1)).toBe(0);
  });
});

describe("canLabel", () => {
  it("hides labels on cells too small to read", () => {
    expect(canLabel({ x: 0, y: 0, w: 10, h: 10 })).toBe(false);
    expect(canLabel({ x: 0, y: 0, w: 40, h: 40 })).toBe(true);
  });
});
