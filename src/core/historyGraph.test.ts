import { describe, expect, it } from "vitest";
import {
  compactPreview,
  edgePath,
  headIsOnOrBelow,
  layoutHistory,
  type HistoryEdge,
} from "./historyGraph";
import type { HistoryNodeSummary } from "@/api/types";

/** A minimal node, with sensible defaults for the fields a given test does
 * not care about. */
function node(partial: Partial<HistoryNodeSummary> & { id: number }): HistoryNodeSummary {
  return {
    parentId: null,
    at: "2026-01-01T00:00:00Z",
    actor: "",
    kind: "code.created",
    summary: `node ${partial.id}`,
    branchName: null,
    undoable: true,
    isHead: false,
    preferredChild: null,
    stepCount: 1,
    children: [],
    ...partial,
  };
}

describe("layoutHistory", () => {
  it("gives a linear history a single lane, newest row first", () => {
    const nodes = [
      node({ id: 1, parentId: null, children: [2] }),
      node({ id: 2, parentId: 1, children: [3] }),
      node({ id: 3, parentId: 2, children: [], isHead: true }),
    ];
    const { rows, edges, laneCount } = layoutHistory(nodes);

    expect(laneCount).toBe(1);
    expect(rows.map((r) => r.node.id)).toEqual([3, 2, 1]);
    expect(rows.every((r) => r.lane === 0)).toBe(true);
    // Every row sits above its parent.
    const rowOf = new Map(rows.map((r) => [r.node.id, r.row]));
    for (const e of edges) expect(rowOf.get(e.fromId)!).toBeLessThan(rowOf.get(e.toId)!);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.fromLane === 0 && e.toLane === 0)).toBe(true);
  });

  it("puts a fork made after an undo on a second lane", () => {
    // 1 -> 2 -> 3 was the original line; undoing to 1 and editing again
    // created 4, which is what the project currently follows.
    const nodes = [
      node({ id: 1, parentId: null, children: [2, 4], preferredChild: 4 }),
      node({ id: 2, parentId: 1, children: [3], preferredChild: 3 }),
      node({ id: 3, parentId: 2, children: [] }),
      node({ id: 4, parentId: 1, children: [], isHead: true }),
    ];
    const { rows, laneCount } = layoutHistory(nodes);
    const laneOf = new Map(rows.map((r) => [r.node.id, r.lane]));

    expect(laneCount).toBe(2);
    // The main line follows preferredChild, so it is 1 -> 4, not 1 -> 2 -> 3.
    expect(laneOf.get(1)).toBe(0);
    expect(laneOf.get(4)).toBe(0);
    expect(laneOf.get(2)).toBe(laneOf.get(3));
    expect(laneOf.get(2)).not.toBe(0);
  });

  it("gives nested forks their own lanes without colliding with an unrelated node", () => {
    // 1 forks into {2, 4} (4 preferred); 2 itself forks into {3, 5} (5 preferred).
    const nodes = [
      node({ id: 1, parentId: null, children: [2, 4], preferredChild: 4 }),
      node({ id: 2, parentId: 1, children: [3, 5], preferredChild: 5 }),
      node({ id: 3, parentId: 2, children: [] }),
      node({ id: 4, parentId: 1, children: [], isHead: true }),
      node({ id: 5, parentId: 2, children: [] }),
    ];
    const { rows, edges, laneCount } = layoutHistory(nodes);
    const laneOf = new Map(rows.map((r) => [r.node.id, r.lane]));

    expect(laneCount).toBe(3);
    expect(laneOf.get(1)).toBe(0);
    expect(laneOf.get(4)).toBe(0);
    expect(laneOf.get(2)).toBe(laneOf.get(5)); // 2's own trunk continues into 5
    expect(laneOf.get(2)).not.toBe(0);
    expect(laneOf.get(3)).not.toBe(laneOf.get(2));
    expect(laneOf.get(3)).not.toBe(0);

    // No edge may pass, in its own lane, through a row that belongs to a
    // node sitting in that same lane but unrelated to that edge.
    const byLane = new Map<number, number[]>();
    for (const r of rows) byLane.set(r.lane, [...(byLane.get(r.lane) ?? []), r.row]);
    for (const e of edges) {
      if (e.fromLane !== e.toLane) continue;
      const [lo, hi] = [Math.min(e.fromRow, e.toRow), Math.max(e.fromRow, e.toRow)];
      for (const row of byLane.get(e.fromLane) ?? []) {
        if (row === e.fromRow || row === e.toRow) continue;
        expect(row < lo || row > hi).toBe(true);
      }
    }
  });

  it("marks exactly the head node", () => {
    const nodes = [
      node({ id: 1, parentId: null, children: [2] }),
      node({ id: 2, parentId: 1, children: [], isHead: true }),
    ];
    const { rows } = layoutHistory(nodes);
    expect(rows.filter((r) => r.node.isHead).map((r) => r.node.id)).toEqual([2]);
  });

  it("orders newest first by id, stably, even when timestamps tie", () => {
    const tie = "2026-01-01T00:00:00Z";
    const nodes = [
      node({ id: 1, parentId: null, children: [2], at: tie }),
      node({ id: 2, parentId: 1, children: [3], at: tie }),
      node({ id: 3, parentId: 2, children: [], at: tie }),
    ];
    const { rows } = layoutHistory(nodes);
    expect(rows.map((r) => r.node.id)).toEqual([3, 2, 1]);
  });

  it("lays out nothing for an empty tree", () => {
    expect(layoutHistory([])).toEqual({ rows: [], edges: [], laneCount: 0 });
  });
});

describe("edgePath", () => {
  const laneWidth = 18;
  const rowHeight = 44;

  it("draws a straight vertical line within one lane", () => {
    const edge: HistoryEdge = { fromId: 2, toId: 1, fromLane: 0, toLane: 0, fromRow: 0, toRow: 1 };
    const d = edgePath(edge, laneWidth, rowHeight);
    expect(d).toBe("M9,22 L9,66");
  });

  it("curves gently between two different lanes", () => {
    const edge: HistoryEdge = { fromId: 3, toId: 2, fromLane: 1, toLane: 0, fromRow: 0, toRow: 1 };
    const d = edgePath(edge, laneWidth, rowHeight);
    expect(d.startsWith("M27,22 C27,44 9,44 9,66")).toBe(true);
  });
});

describe("compactPreview", () => {
  const nodes = [
    node({ id: 1, parentId: null, children: [2, 4], branchName: "old start" }),
    node({ id: 2, parentId: 1, children: [3] }),
    node({ id: 3, parentId: 2, children: [] }),
    node({ id: 4, parentId: 1, children: [5], branchName: "kept branch", isHead: true }),
    node({ id: 5, parentId: 4, children: [] }),
  ];

  it("counts everything not under the chosen node, and names its dropped branches", () => {
    expect(compactPreview(nodes, 4)).toEqual({ dropped: 3, droppedBranches: ["old start"] });
  });

  it("keeps everything when compacting from the root", () => {
    expect(compactPreview(nodes, 1)).toEqual({ dropped: 0, droppedBranches: [] });
  });
});

describe("headIsOnOrBelow", () => {
  const nodes = [
    node({ id: 1, parentId: null, children: [2, 4] }),
    node({ id: 2, parentId: 1, children: [3] }),
    node({ id: 3, parentId: 2, children: [], isHead: true }),
    node({ id: 4, parentId: 1, children: [] }),
  ];

  it("is true at the head itself and at any ancestor of it", () => {
    expect(headIsOnOrBelow(nodes, 3)).toBe(true);
    expect(headIsOnOrBelow(nodes, 2)).toBe(true);
    expect(headIsOnOrBelow(nodes, 1)).toBe(true);
  });

  it("is false off the head's own line", () => {
    expect(headIsOnOrBelow(nodes, 4)).toBe(false);
  });
});
