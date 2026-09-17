import { describe, expect, it } from "vitest";
import {
  branchesOf,
  collapseDays,
  compactPreview,
  currentBranchName,
  dayDigest,
  dayKey,
  dayLabel,
  defaultExpandedDays,
  edgePath,
  forkPointOf,
  groupByDay,
  headIsOnOrBelow,
  layoutHistory,
  undivergedBranches,
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

// --- day groups ---------------------------------------------------------

/** Local noon on a given day, so a timezone shift cannot move the date. */
function at(y: number, m: number, d: number, hour = 12): string {
  return new Date(y, m - 1, d, hour).toISOString();
}

describe("dayKey", () => {
  it("names the local calendar day", () => {
    expect(dayKey(at(2026, 9, 17))).toBe("2026-09-17");
    // Late in the evening is still that evening's day, not the next in UTC.
    expect(dayKey(at(2026, 9, 17, 23))).toBe("2026-09-17");
    expect(dayKey(at(2026, 1, 2, 0))).toBe("2026-01-02");
  });

  it("buckets unparseable timestamps on their own", () => {
    expect(dayKey("not a date")).toBe("");
  });
});

describe("dayLabel", () => {
  const now = new Date(2026, 8, 17, 15).getTime();

  it("names today and yesterday", () => {
    expect(dayLabel("2026-09-17", now)).toBe("Today");
    expect(dayLabel("2026-09-16", now)).toBe("Yesterday");
  });

  it("spells out anything older", () => {
    const label = dayLabel("2026-09-14", now);
    expect(label).not.toBe("Today");
    expect(label).toContain("2026");
  });

  it("says so when the timestamp made no sense", () => {
    expect(dayLabel("", now)).toBe("Undated");
  });
});

describe("dayDigest", () => {
  it("counts kinds by what they are called, not by their kind string", () => {
    const nodes = [
      ...Array.from({ length: 8 }, (_, i) => node({ id: i + 1, kind: "excerpt.created" })),
      ...Array.from({ length: 4 }, (_, i) => node({ id: 20 + i, kind: "excerpt.codes_added" })),
      node({ id: 30, kind: "code.created" }),
      node({ id: 31, kind: "code.created" }),
      node({ id: 32, kind: "code.created" }),
      node({ id: 40, kind: "code.merged_into" }),
    ];
    // "created an excerpt" and "added a code to one" are both codings.
    expect(dayDigest(nodes)).toBe("12 codings, 3 codes created, 1 merge");
  });

  it("uses the singular for one of something", () => {
    expect(dayDigest([node({ id: 1, kind: "memo.created" })])).toBe("1 memo");
  });

  it("keeps the line short, rolling the rest into a count", () => {
    const nodes = [
      node({ id: 1, kind: "excerpt.created" }),
      node({ id: 2, kind: "code.created" }),
      node({ id: 3, kind: "memo.created" }),
      node({ id: 4, kind: "document.imported" }),
      node({ id: 5, kind: "set.created" }),
    ];
    const digest = dayDigest(nodes);
    expect(digest.split(", ")).toHaveLength(4);
    expect(digest.endsWith("+ 2 more")).toBe(true);
  });

  it("falls back to the kind's own group for something it has never seen", () => {
    expect(dayDigest([node({ id: 1, kind: "gizmo.spun" })])).toBe("1 gizmo change");
  });

  it("has nothing to say about no steps", () => {
    expect(dayDigest([])).toBe("");
  });
});

describe("groupByDay", () => {
  const now = new Date(2026, 8, 17, 15).getTime();

  it("splits the rows into runs of one day, newest first", () => {
    const nodes = [
      node({ id: 1, parentId: null, children: [2], at: at(2026, 9, 15) }),
      node({ id: 2, parentId: 1, children: [3], at: at(2026, 9, 16) }),
      node({ id: 3, parentId: 2, children: [], at: at(2026, 9, 16), isHead: true }),
    ];
    const { rows } = layoutHistory(nodes);
    const groups = groupByDay(rows, now);
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ["Yesterday", 2],
      ["Tue 15 Sep 2026", 1],
    ]);
  });
});

describe("defaultExpandedDays", () => {
  it("opens the day the project is at, and any day with a fork or a name", () => {
    const nodes = [
      node({ id: 1, parentId: null, children: [2], at: at(2026, 9, 10) }),
      node({ id: 2, parentId: 1, children: [3, 5], at: at(2026, 9, 11) }),
      node({ id: 3, parentId: 2, children: [], at: at(2026, 9, 12) }),
      node({ id: 5, parentId: 2, children: [], at: at(2026, 9, 13), isHead: true }),
      node({ id: 6, parentId: null, children: [], at: at(2026, 9, 14), branchName: "side" }),
    ];
    const { rows } = layoutHistory(nodes);
    expect(defaultExpandedDays(rows).sort()).toEqual([
      "2026-09-11", // a fork
      "2026-09-13", // the head
      "2026-09-14", // a branch name
    ]);
  });
});

describe("collapseDays", () => {
  // 1 and 2 on the 15th, 3 and 4 on the 16th.
  const nodes = [
    node({ id: 1, parentId: null, children: [2], at: at(2026, 9, 15) }),
    node({ id: 2, parentId: 1, children: [3], at: at(2026, 9, 15) }),
    node({ id: 3, parentId: 2, children: [4], at: at(2026, 9, 16) }),
    node({ id: 4, parentId: 3, children: [], at: at(2026, 9, 16), isHead: true }),
  ];
  const { rows } = layoutHistory(nodes);
  const now = new Date(2026, 8, 17, 15).getTime();

  it("puts a header above each day and the steps under the open ones", () => {
    const { rows: display } = collapseDays(rows, new Set(["2026-09-16"]), now);
    expect(
      display.map((r) => (r.kind === "day" ? `day ${r.day} ${r.expanded}` : `step ${r.node.id}`)),
    ).toEqual(["day 2026-09-16 true", "step 4", "step 3", "day 2026-09-15 false"]);
  });

  it("gives a closed day its count and its digest", () => {
    const { rows: display } = collapseDays(rows, new Set(), now);
    const header = display.find((r) => r.kind === "day" && r.day === "2026-09-15");
    expect(header?.kind).toBe("day");
    if (header?.kind !== "day") return;
    expect(header.count).toBe(2);
    expect(header.digest).toBe("2 codes created");
    expect(header.hasHead).toBe(false);
  });

  it("marks the header of the day the project is at", () => {
    const { rows: display } = collapseDays(rows, new Set(), now);
    const header = display.find((r) => r.kind === "day" && r.day === "2026-09-16");
    expect(header?.kind === "day" && header.hasHead).toBe(true);
  });

  it("draws a closed day's steps at its header row, so no edge is lost", () => {
    const { rows: display, edges } = collapseDays(rows, new Set(), now);
    // Two headers, nothing else.
    expect(display).toHaveLength(2);
    expect(display.map((r) => r.row)).toEqual([0, 1]);
    // 4 -> 3 and 2 -> 1 collapse to nothing; 3 -> 2 joins the two headers.
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromId: 3, toId: 2, fromRow: 0, toRow: 1 });
  });

  it("keeps every edge when every day is open", () => {
    const open = new Set(["2026-09-15", "2026-09-16"]);
    const { rows: display, edges } = collapseDays(rows, open, now);
    expect(display).toHaveLength(6); // 4 steps + 2 headers
    expect(edges).toHaveLength(3);
    // Rows still ascend from a step to its parent, headers included.
    for (const e of edges) expect(e.fromRow).toBeLessThan(e.toRow);
  });

  it("keeps the lanes running through a closed day", () => {
    // 2 forks into {3, 5}; 5 is on another day, on its own lane, and its
    // line passes right over the closed day that holds 3 and 4.
    const forked = [
      node({ id: 1, parentId: null, children: [2], at: at(2026, 9, 10) }),
      node({ id: 2, parentId: 1, children: [3, 5], preferredChild: 3, at: at(2026, 9, 10) }),
      node({ id: 3, parentId: 2, children: [4], at: at(2026, 9, 11) }),
      node({ id: 4, parentId: 3, children: [], at: at(2026, 9, 11), isHead: true }),
      node({ id: 5, parentId: 2, children: [], at: at(2026, 9, 12) }),
    ];
    const laid = layoutHistory(forked);
    const { rows: display } = collapseDays(laid.rows, new Set(), now);
    const header = display.find((r) => r.kind === "day" && r.day === "2026-09-11");
    expect(header?.kind).toBe("day");
    if (header?.kind !== "day") return;
    const laneOf = new Map(laid.rows.map((r) => [r.node.id, r.lane]));
    // Its own steps' lane, and the lane of the branch passing over it.
    expect(header.lanes).toContain(laneOf.get(3));
    expect(header.lanes).toContain(laneOf.get(5));
  });

  it("puts a day's branch names and fork on its header", () => {
    const forked = [
      node({ id: 1, parentId: null, children: [2], at: at(2026, 9, 10) }),
      node({
        id: 2,
        parentId: 1,
        children: [3, 4],
        at: at(2026, 9, 10),
        branchName: "second pass",
      }),
      node({ id: 3, parentId: 2, children: [], at: at(2026, 9, 11) }),
      node({ id: 4, parentId: 2, children: [], at: at(2026, 9, 11), isHead: true }),
    ];
    const { rows: laid } = layoutHistory(forked);
    const { rows: display } = collapseDays(laid, new Set(), now);
    const header = display.find((r) => r.kind === "day" && r.day === "2026-09-10");
    expect(header?.kind).toBe("day");
    if (header?.kind !== "day") return;
    expect(header.branchNames).toEqual(["second pass"]);
    expect(header.hasBranchPoint).toBe(true);
  });

  it("has nothing to lay out for an empty history", () => {
    expect(collapseDays([], new Set(), now)).toEqual({ rows: [], edges: [] });
  });
});

// --- branches -----------------------------------------------------------

describe("forkPointOf", () => {
  it("is the named step itself once its line divides", () => {
    // 2 was named, then edited from twice: the old line and the new one.
    const nodes = [
      node({ id: 1, parentId: null, children: [2] }),
      node({ id: 2, parentId: 1, children: [3, 4], branchName: "second pass" }),
      node({ id: 3, parentId: 2, children: [] }),
      node({ id: 4, parentId: 2, children: [], isHead: true }),
    ];
    expect(forkPointOf(nodes, 2)).toBe(2);
  });

  it("is the named step of a fork nothing has been built on yet", () => {
    const nodes = [
      node({ id: 1, parentId: null, children: [2] }),
      node({ id: 2, parentId: 1, children: [], branchName: "fresh", isHead: true }),
    ];
    expect(forkPointOf(nodes, 2)).toBe(2);
  });

  it("looks up to the nearest dividing step when the name sits mid-branch", () => {
    // 2 forks into {3, 4}; the name was moved by hand onto 5, further down
    // the branch that begins at 4.
    const nodes = [
      node({ id: 1, parentId: null, children: [2] }),
      node({ id: 2, parentId: 1, children: [3, 4] }),
      node({ id: 3, parentId: 2, children: [] }),
      node({ id: 4, parentId: 2, children: [5] }),
      node({ id: 5, parentId: 4, children: [6], branchName: "renamed later" }),
      node({ id: 6, parentId: 5, children: [], isHead: true }),
    ];
    expect(forkPointOf(nodes, 5)).toBe(2);
  });

  it("is nothing for a step that is not there", () => {
    expect(forkPointOf([node({ id: 1 })], 99)).toBeNull();
  });
});

describe("currentBranchName", () => {
  const nodes = [
    node({ id: 1, parentId: null, children: [2] }),
    node({ id: 2, parentId: 1, children: [3, 4], branchName: "second pass" }),
    node({ id: 3, parentId: 2, children: [] }),
    node({ id: 4, parentId: 2, children: [], isHead: true }),
  ];

  it("is the nearest named step at or above the head", () => {
    expect(currentBranchName(nodes)).toBe("second pass");
  });

  it("is main when nothing above the head is named", () => {
    const plain = [
      node({ id: 1, parentId: null, children: [2] }),
      node({ id: 2, parentId: 1, children: [], isHead: true }),
    ];
    expect(currentBranchName(plain)).toBe("main");
    expect(currentBranchName([])).toBe("main");
  });
});

describe("branchesOf", () => {
  const nodes = [
    node({ id: 1, parentId: null, children: [2], preferredChild: 2 }),
    node({ id: 2, parentId: 1, children: [3, 4], preferredChild: 4, branchName: "second pass" }),
    node({ id: 3, parentId: 2, children: [] }),
    node({ id: 4, parentId: 2, children: [], isHead: true }),
  ];

  it("lists main first, then every named branch", () => {
    expect(branchesOf(nodes).map((b) => b.name)).toEqual(["main", "second pass"]);
  });

  it("follows each branch's own line to its tip", () => {
    const [main, second] = branchesOf(nodes);
    // main runs 1 -> 2 -> 4 (each node's preferred child).
    expect(main!.tipId).toBe(4);
    expect(second!.tipId).toBe(4);
    expect(second!.forkPointId).toBe(2);
    expect(second!.diverged).toBe(true);
  });

  it("marks the branch the project is on", () => {
    expect(branchesOf(nodes).map((b) => b.isCurrent)).toEqual([false, true]);
  });

  it("says when a branch has not diverged yet", () => {
    const fresh = [
      node({ id: 1, parentId: null, children: [2], preferredChild: 2 }),
      node({ id: 2, parentId: 1, children: [], branchName: "fresh", isHead: true }),
    ];
    const [, branch] = branchesOf(fresh);
    expect(branch!.diverged).toBe(false);
    expect(branch!.tipId).toBe(2);
  });

  it("has no strip to show for an empty history", () => {
    expect(branchesOf([])).toEqual([]);
  });
});

describe("undivergedBranches", () => {
  it("is the named leaves — the forks with no line of their own yet", () => {
    const nodes = [
      node({ id: 1, parentId: null, children: [2] }),
      node({ id: 2, parentId: 1, children: [3], branchName: "grown" }),
      node({ id: 3, parentId: 2, children: [], branchName: "fresh", isHead: true }),
    ];
    expect([...undivergedBranches(nodes)]).toEqual([[3, "fresh"]]);
  });
});
