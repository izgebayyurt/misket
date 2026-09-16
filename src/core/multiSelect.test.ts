import { describe, expect, it } from "vitest";
import {
  clickRow,
  codesInSelection,
  emptySelection,
  pruneSelection,
  selectedInOrder,
  toggleAll,
  type SelectionState,
} from "./multiSelect";

const rows = ["a", "b", "c", "d", "e"];
const sel = (state: SelectionState) => [...state.ids].sort();

describe("multi-select", () => {
  it("toggles one row at a time and remembers the anchor", () => {
    let s = clickRow(emptySelection, rows, 1, false);
    expect(sel(s)).toEqual(["b"]);
    expect(s.anchor).toBe(1);
    s = clickRow(s, rows, 3, false);
    expect(sel(s)).toEqual(["b", "d"]);
    s = clickRow(s, rows, 1, false);
    expect(sel(s)).toEqual(["d"]);
    expect(s.anchor).toBe(1);
  });

  it("shift-clicks a range from the anchor, in either direction", () => {
    let s = clickRow(emptySelection, rows, 3, false);
    s = clickRow(s, rows, 1, true);
    expect(sel(s)).toEqual(["b", "c", "d"]);
    // The anchor stays put, so the range can be re-dragged smaller.
    expect(s.anchor).toBe(3);
    s = clickRow(s, rows, 4, true);
    expect(sel(s)).toEqual(["b", "c", "d", "e"]);
  });

  it("shift-clicks like a plain click with no anchor, and ignores unknown rows", () => {
    const s = clickRow(emptySelection, rows, 2, true);
    expect(sel(s)).toEqual(["c"]);
    expect(s.anchor).toBe(2);
    expect(clickRow(s, rows, 9, false)).toBe(s);
  });

  it("selects all loaded rows, then clears when they are all selected", () => {
    let s = toggleAll(emptySelection, rows);
    expect(sel(s)).toEqual(rows);
    s = toggleAll(s, rows);
    expect(s.ids.size).toBe(0);
    // A partial selection fills in the rest rather than clearing.
    s = toggleAll(clickRow(emptySelection, rows, 0, false), rows);
    expect(sel(s)).toEqual(rows);
    expect(toggleAll(emptySelection, []).ids.size).toBe(0);
  });

  it("prunes ids that are no longer loaded", () => {
    const s = toggleAll(emptySelection, rows);
    const pruned = pruneSelection(s, ["b", "d"]);
    expect(sel(pruned)).toEqual(["b", "d"]);
    expect(pruneSelection(pruned, ["b", "d"])).toBe(pruned);
    expect(pruneSelection(pruned, []).anchor).toBeNull();
  });

  it("returns the selection in row order", () => {
    let s = clickRow(emptySelection, rows, 4, false);
    s = clickRow(s, rows, 0, false);
    expect(selectedInOrder(s, rows)).toEqual(["a", "e"]);
  });

  it("collects the codes present across the selection, without duplicates", () => {
    const withCodes = [
      { id: "a", codeIds: ["c1", "c2"] },
      { id: "b", codeIds: ["c2", "c3"] },
      { id: "c", codeIds: ["c4"] },
    ];
    const s = { ids: new Set(["a", "b"]), anchor: null };
    expect(codesInSelection(withCodes, s)).toEqual(["c1", "c2", "c3"]);
    expect(codesInSelection(withCodes, emptySelection)).toEqual([]);
  });
});
