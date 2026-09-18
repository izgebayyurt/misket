import { describe, expect, it } from "vitest";
import { detailFields, formatValue, humanizeKey, RESOLVED_KEYS } from "./historyDetail";

describe("humanizeKey", () => {
  it("turns a payload key into a label", () => {
    expect(humanizeKey("startPos")).toBe("Start pos");
    expect(humanizeKey("affectedExcerptCount")).toBe("Affected excerpt count");
    expect(humanizeKey("children")).toBe("Children");
    expect(humanizeKey("code_ids")).toBe("Code ids");
  });

  it("leaves a key it cannot read alone", () => {
    expect(humanizeKey("")).toBe("");
  });
});

describe("formatValue", () => {
  it("reads a changed field as old → new", () => {
    expect(formatValue({ from: "Access", to: "Barriers" })).toBe("Access → Barriers");
    expect(formatValue({ from: null, to: "Access" })).toBe("(none) → Access");
    expect(formatValue({ from: 3, to: 12 })).toBe("3 → 12");
  });

  it("joins an array", () => {
    expect(formatValue(["a", "b"])).toBe("a, b");
  });

  it("flattens a plain object into its own fields", () => {
    expect(formatValue({ startPos: 3, endPos: 9 })).toBe("Start pos: 3; End pos: 9");
  });

  it("says nothing for nothing", () => {
    expect(formatValue(null)).toBeNull();
    expect(formatValue(undefined)).toBeNull();
    expect(formatValue("")).toBeNull();
    expect(formatValue("   ")).toBeNull();
    expect(formatValue([])).toBeNull();
    expect(formatValue({})).toBeNull();
  });

  it("reads a boolean as words", () => {
    expect(formatValue(true)).toBe("yes");
    expect(formatValue(false)).toBe("no");
  });

  it("flattens newlines and cuts a very long value short", () => {
    expect(formatValue("one\ntwo")).toBe("one two");
    const long = "x".repeat(500);
    const out = formatValue(long)!;
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThan(long.length);
  });
});

describe("detailFields", () => {
  it("lists a payload in the order it was written", () => {
    const fields = detailFields({ children: "promote", affectedExcerptCount: 4 });
    expect(fields.map((f) => [f.label, f.value])).toEqual([
      ["Children", "promote"],
      ["Affected excerpt count", "4"],
    ]);
  });

  it("leaves out what the panel shows in its own way", () => {
    const fields = detailFields({
      codeIds: ["c1"],
      codeNames: ["Access"],
      documentId: "d1",
      documentName: "Interview 1",
      snapshot: "the coded passage",
      startPos: 12,
    });
    expect(fields.map((f) => f.key)).toEqual(["startPos"]);
    for (const key of ["codeIds", "documentId", "snapshot"]) {
      expect(RESOLVED_KEYS.has(key)).toBe(true);
    }
  });

  it("leaves out fields with nothing to say", () => {
    expect(detailFields({ shortcut: null, description: "", parentId: undefined })).toEqual([]);
  });

  it("has nothing to show for a missing payload", () => {
    expect(detailFields(null)).toEqual([]);
    expect(detailFields(undefined)).toEqual([]);
  });
});
