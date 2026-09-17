import { describe, expect, it } from "vitest";
import { coderIdsOf, codersOfCode, initialsOf } from "./coders";

const codings = [
  { codeId: "a", coderId: "ada" },
  { codeId: "a", coderId: "bob" },
  { codeId: "b", coderId: "bob" },
];

describe("coderIdsOf", () => {
  it("lists each coder once, in the order they appear", () => {
    expect(coderIdsOf({ codings })).toEqual(["ada", "bob"]);
  });

  it("is empty for an excerpt from before coder identity", () => {
    expect(coderIdsOf({})).toEqual([]);
    expect(coderIdsOf({ codings: [] })).toEqual([]);
    // An unattributed row carries an empty id, which is nobody.
    expect(coderIdsOf({ codings: [{ codeId: "a", coderId: "" }] })).toEqual([]);
  });
});

describe("codersOfCode", () => {
  it("picks out who applied one code, keeping duplicates apart", () => {
    expect(codersOfCode({ codings }, "a")).toEqual(["ada", "bob"]);
    expect(codersOfCode({ codings }, "b")).toEqual(["bob"]);
    expect(codersOfCode({ codings }, "missing")).toEqual([]);
  });
});

describe("initialsOf", () => {
  it("takes the first and last initial, or two letters of one word", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("Ada Byron King Lovelace")).toBe("AL");
    expect(initialsOf("ada")).toBe("AD");
    expect(initialsOf("  grace  ")).toBe("GR");
    expect(initialsOf("")).toBe("?");
  });
});
