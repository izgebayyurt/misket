import { describe, expect, it } from "vitest";
import type { Query } from "@/api/types";
import {
  codePickCount,
  documentPickCount,
  emptyFilterState,
  filterState,
  isFiltered,
  toFilter,
} from "./excerptFilter";

const QUERY: Query = {
  op: "near",
  terms: [
    { codeId: "c1", includeDescendants: true },
    { codeId: "c2", includeDescendants: false },
  ],
  within: { kind: "chars", n: 50 },
};

describe("filterState", () => {
  it("fills in the browser's defaults for a missing filter", () => {
    expect(filterState(undefined)).toEqual(emptyFilterState);
    expect(filterState(null)).toEqual(emptyFilterState);
    expect(filterState({})).toEqual(emptyFilterState);
  });

  it("reads every field a saved filter can carry", () => {
    const state = filterState({
      codeIds: ["c1"],
      codeSetIds: ["s1"],
      includeDescendants: false,
      requireAllCodes: true,
      documentIds: ["d1"],
      documentSetIds: ["s2"],
      uncodedOnly: true,
      overlapsCodeId: "c9",
      descriptors: [{ fieldId: "f", op: "eq", values: ["x"] }],
      query: QUERY,
      speakers: ["P1"],
      coderIds: ["ada"],
      weightRange: { codeId: "w1", min: 2, max: 4 },
      limit: 10,
    });
    expect(state).toEqual({
      codeIds: ["c1"],
      codeSetIds: ["s1"],
      includeDescendants: false,
      requireAllCodes: true,
      documentIds: ["d1"],
      documentSetIds: ["s2"],
      uncodedOnly: true,
      overlapsCodeId: "c9",
      descriptors: [{ fieldId: "f", op: "eq", values: ["x"] }],
      query: QUERY,
      speakers: ["P1"],
      coderIds: ["ada"],
      weightRange: { codeId: "w1", min: 2, max: 4 },
    });
  });

  it("resets fields a saved filter leaves out instead of merging them", () => {
    // Applying a filter is an assignment, so a filter that does not mention
    // documents must clear whatever documents were picked before.
    const before = filterState({ documentIds: ["d1"], uncodedOnly: true });
    const after = filterState({ codeSetIds: ["s1"] });
    expect(after.documentIds).toEqual([]);
    expect(after.uncodedOnly).toBe(false);
    expect(before.documentIds).toEqual(["d1"]);
  });
});

describe("toFilter", () => {
  it("sends empty lists as null and round-trips through filterState", () => {
    const f = toFilter(emptyFilterState, 200);
    expect(f).toEqual({
      codeIds: null,
      codeSetIds: null,
      includeDescendants: true,
      requireAllCodes: false,
      documentIds: null,
      documentSetIds: null,
      uncodedOnly: false,
      overlapsCodeId: null,
      descriptors: null,
      query: null,
      speakers: null,
      coderIds: null,
      weightRange: null,
      limit: 200,
      offset: 0,
    });
    expect(filterState(f)).toEqual(emptyFilterState);
  });

  it("keeps sets alongside individually picked ids", () => {
    const state = { ...emptyFilterState, codeIds: ["c1"], codeSetIds: ["s1", "s2"] };
    const f = toFilter(state, 50, 50);
    expect(f.codeIds).toEqual(["c1"]);
    expect(f.codeSetIds).toEqual(["s1", "s2"]);
    expect(f.limit).toBe(50);
    expect(f.offset).toBe(50);
    expect(filterState(f)).toEqual(state);
  });

  it("carries the query object through unchanged", () => {
    const state = { ...emptyFilterState, query: QUERY };
    const f = toFilter(state, 50);
    expect(f.query).toEqual(QUERY);
    expect(filterState(f)).toEqual(state);
  });

  it("carries overlapsCodeId straight through, unlike the list fields", () => {
    const state = { ...emptyFilterState, overlapsCodeId: "c9" };
    const f = toFilter(state, 50);
    expect(f.overlapsCodeId).toBe("c9");
    expect(filterState(f).overlapsCodeId).toBe("c9");
  });
});

describe("counts and isFiltered", () => {
  it("counts a set as one pick on each side", () => {
    const state = {
      ...emptyFilterState,
      codeIds: ["c1", "c2"],
      codeSetIds: ["s1"],
      documentSetIds: ["s2"],
    };
    expect(codePickCount(state)).toBe(3);
    expect(documentPickCount(state)).toBe(1);
  });

  it("is only unfiltered when nothing narrows the result set", () => {
    expect(isFiltered(emptyFilterState)).toBe(false);
    // Sub-code and match-all settings alone change nothing on their own.
    expect(
      isFiltered({ ...emptyFilterState, includeDescendants: false, requireAllCodes: true }),
    ).toBe(false);
    for (const patch of [
      { codeIds: ["c"] },
      { codeSetIds: ["s"] },
      { documentIds: ["d"] },
      { documentSetIds: ["s"] },
      { uncodedOnly: true },
      { overlapsCodeId: "c" },
      { descriptors: [{ fieldId: "f", op: "empty" as const, values: [] }] },
      { query: QUERY },
      { coderIds: ["ada"] },
      { weightRange: { codeId: "w1", min: 1, max: 5 } },
    ]) {
      expect(isFiltered({ ...emptyFilterState, ...patch })).toBe(true);
    }
  });
});
