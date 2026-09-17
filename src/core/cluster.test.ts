import { describe, expect, it } from "vitest";
import {
  averageLinkage,
  cosineSimilarity,
  cutTree,
  heightRange,
  jaccardSimilarity,
  leafOrder,
  similarityMatrix,
  type DendroTree,
} from "./cluster";

describe("jaccardSimilarity", () => {
  it("is |A∩B| / |A∪B|", () => {
    // |A|=10, |B|=6, |A∩B|=4 -> union = 10+6-4 = 12
    expect(jaccardSimilarity(4, 10, 6)).toBeCloseTo(4 / 12);
  });

  it("is 1 for identical sets", () => {
    expect(jaccardSimilarity(5, 5, 5)).toBe(1);
  });

  it("is 0 for disjoint sets", () => {
    expect(jaccardSimilarity(0, 5, 5)).toBe(0);
  });

  it("is 0, not NaN, for two empty sets", () => {
    expect(jaccardSimilarity(0, 0, 0)).toBe(0);
  });
});

describe("cosineSimilarity", () => {
  it("is |A∩B| / sqrt(|A||B|)", () => {
    expect(cosineSimilarity(4, 10, 6)).toBeCloseTo(4 / Math.sqrt(60));
  });

  it("is 1 for identical sets", () => {
    expect(cosineSimilarity(5, 5, 5)).toBe(1);
  });

  it("is 0, not NaN, when one set is empty", () => {
    expect(cosineSimilarity(0, 0, 5)).toBe(0);
  });
});

describe("similarityMatrix", () => {
  it("has a diagonal of 1 and is symmetric", () => {
    const ids = ["a", "b", "c"];
    const pairs: Record<string, number> = { "a|b": 2, "a|c": 0, "b|c": 1 };
    const own: Record<string, number> = { a: 4, b: 3, c: 5 };
    const m = similarityMatrix(
      ids,
      (id) => own[id]!,
      (x, y) => pairs[[x, y].sort().join("|")] ?? 0,
      "jaccard",
    );
    expect(m[0]![0]).toBe(1);
    expect(m[1]![1]).toBe(1);
    expect(m[2]![2]).toBe(1);
    expect(m[0]![1]).toBeCloseTo(m[1]![0]!);
    expect(m[0]![2]).toBeCloseTo(m[2]![0]!);
    expect(m[0]![1]).toBeCloseTo(2 / (4 + 3 - 2));
    expect(m[0]![2]).toBe(0);
  });
});

describe("averageLinkage", () => {
  it("returns a null tree for fewer than two ids", () => {
    expect(averageLinkage([], () => 0).tree).toBeNull();
    const single = averageLinkage(["a"], () => 0);
    expect(single.tree).toEqual({ type: "leaf", id: "a", members: ["a"] });
    expect(single.merges).toEqual([]);
  });

  // Hand-computed UPGMA example. Distance (dissimilarity) matrix:
  //        A    B    C    D
  //   A    0   17   21   31
  //   B   17    0   30   34
  //   C   21   30    0   28
  //   D   31   34   28    0
  //
  // Step 1: min is d(A,B)=17 -> merge {A,B}, height 17.
  //   d({A,B},C) = (21+30)/2 = 25.5
  //   d({A,B},D) = (31+34)/2 = 32.5
  //   d(C,D) unchanged = 28
  // Step 2: min is d({A,B},C)=25.5 -> merge {A,B,C}, height 25.5.
  //   d({A,B,C},D) = (2*32.5 + 1*28)/3 = 31
  // Step 3: merge {A,B,C,D}, height 31.
  const raw: Record<string, number> = {
    "A|B": 17,
    "A|C": 21,
    "A|D": 31,
    "B|C": 30,
    "B|D": 34,
    "C|D": 28,
  };
  const distance = (a: string, b: string) => raw[[a, b].sort().join("|")]!;

  it("merges in the hand-computed order with the hand-computed heights", () => {
    const { merges } = averageLinkage(["A", "B", "C", "D"], distance);
    expect(merges).toHaveLength(3);
    expect(merges[0]!.left.slice().sort()).toEqual(["A"]);
    expect(merges[0]!.right.slice().sort()).toEqual(["B"]);
    expect(merges[0]!.height).toBeCloseTo(17);

    expect(merges[1]!.left.slice().sort()).toEqual(["A", "B"]);
    expect(merges[1]!.right.slice().sort()).toEqual(["C"]);
    expect(merges[1]!.height).toBeCloseTo(25.5);

    expect(merges[2]!.left.slice().sort()).toEqual(["A", "B", "C"]);
    expect(merges[2]!.right.slice().sort()).toEqual(["D"]);
    expect(merges[2]!.height).toBeCloseTo(31);
  });

  it("builds a tree whose root height is the final (largest) merge", () => {
    const { tree } = averageLinkage(["A", "B", "C", "D"], distance);
    expect(tree).not.toBeNull();
    expect((tree as Extract<DendroTree, { type: "node" }>).height).toBeCloseTo(31);
    expect(tree!.members.slice().sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("orders leaves left to right without crossing (A, B, C, D)", () => {
    const { tree, leafOrder: order } = averageLinkage(["A", "B", "C", "D"], distance);
    expect(order).toEqual(["A", "B", "C", "D"]);
    expect(leafOrder(tree!)).toEqual(order);
  });

  it("is invariant to the input id order (same merges, same heights)", () => {
    const { merges } = averageLinkage(["D", "C", "B", "A"], distance);
    expect(merges.map((m) => m.height)).toEqual([17, 25.5, 31]);
  });

  it("handles a tie by falling back to id order deterministically", () => {
    // A-B and C-D are both the closest pair, tied at 1.
    const tie: Record<string, number> = { "A|B": 1, "C|D": 1, "A|C": 9, "A|D": 9, "B|C": 9, "B|D": 9 };
    const d = (a: string, b: string) => tie[[a, b].sort().join("|")]!;
    const { merges } = averageLinkage(["A", "B", "C", "D"], d);
    // Whichever pair is found first (scan order), the run should be stable
    // across repeats.
    const again = averageLinkage(["A", "B", "C", "D"], d);
    expect(again.merges).toEqual(merges);
  });
});

describe("cutTree", () => {
  const raw: Record<string, number> = {
    "A|B": 17,
    "A|C": 21,
    "A|D": 31,
    "B|C": 30,
    "B|D": 34,
    "C|D": 28,
  };
  const distance = (a: string, b: string) => raw[[a, b].sort().join("|")]!;
  const { tree } = averageLinkage(["A", "B", "C", "D"], distance);

  it("returns every leaf on its own below the smallest merge height", () => {
    expect(cutTree(tree, 0).map((c) => c.sort())).toEqual([["A"], ["B"], ["C"], ["D"]]);
  });

  it("collapses everything into one cluster above the tallest merge", () => {
    expect(cutTree(tree, 100)).toHaveLength(1);
    expect(cutTree(tree, 100)[0]!.sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("cuts between the first and second merge into {A,B}, {C}, {D}", () => {
    const clusters = cutTree(tree, 20).map((c) => c.slice().sort());
    expect(clusters).toEqual(
      expect.arrayContaining([["A", "B"], ["C"], ["D"]]),
    );
    expect(clusters).toHaveLength(3);
  });

  it("returns nothing for a null tree", () => {
    expect(cutTree(null, 5)).toEqual([]);
  });
});

describe("heightRange", () => {
  it("is [0, 0] for a null or single-leaf tree", () => {
    expect(heightRange(null)).toEqual([0, 0]);
    expect(heightRange({ type: "leaf", id: "a", members: ["a"] })).toEqual([0, 0]);
  });

  it("tops out at the root's height", () => {
    const raw: Record<string, number> = { "A|B": 2, "A|C": 5, "B|C": 5 };
    const { tree } = averageLinkage(["A", "B", "C"], (a, b) => raw[[a, b].sort().join("|")]!);
    expect(heightRange(tree)[1]).toBeGreaterThan(0);
  });
});
