import { afterEach, describe, expect, it } from "vitest";
import type { Query } from "@/api/types";
import i18n from "@/lib/i18n";
import {
  addTerm,
  codeRef,
  describeQuery,
  emptyQuery,
  isCodeRef,
  MAX_NEAR_CHARS,
  removeTerm,
  setOp,
  setTerm,
  validate,
} from "./query";

// These functions take a translator instead of importing i18next themselves
// (src/core stays framework-free — see CLAUDE.md); the real instance is as
// good a stub as a fake one, and lets these tests double as a check that
// the Turkish resource resolves the same keys.
const t = i18n.t.bind(i18n);

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const NAMES: Record<string, string> = { a: "Access", b: "Barriers", c: "Cost" };
const name = (id: string) => NAMES[id] ?? "";

const and: Query = { op: "and", terms: [codeRef("a"), codeRef("b")], within: null };

describe("describeQuery", () => {
  it("reads a flat query as a sentence", () => {
    expect(describeQuery(and, name, t)).toBe("Access and Barriers");
    expect(describeQuery({ ...and, op: "or" }, name, t)).toBe("Access or Barriers");
    expect(describeQuery({ ...and, op: "not" }, name, t)).toBe("Access not Barriers");
  });

  it("spells out the near scope", () => {
    const near: Query = { op: "near", terms: and.terms, within: { kind: "paragraph" } };
    expect(describeQuery(near, name, t)).toBe("Access near Barriers (same paragraph)");
    expect(describeQuery({ ...near, within: { kind: "chars", n: 100 } }, name, t)).toBe(
      "Access near Barriers (within 100 characters)",
    );
    expect(describeQuery({ ...near, within: { kind: "chars", n: 1 } }, name, t)).toBe(
      "Access near Barriers (within 1 character)",
    );
    // No scope means the default one, exactly as Rust reads it.
    expect(describeQuery({ ...near, within: null }, name, t)).toBe(
      "Access near Barriers (same paragraph)",
    );
  });

  it("brackets a nested group", () => {
    const nested: Query = {
      op: "and",
      terms: [codeRef("a"), { op: "or", terms: [codeRef("b"), codeRef("c")], within: null }],
      within: null,
    };
    expect(describeQuery(nested, name, t)).toBe("Access and (Barriers or Cost)");
  });

  it("marks a term that excludes sub-codes, and survives missing names", () => {
    expect(describeQuery({ ...and, terms: [codeRef("a", false), codeRef("b")] }, name, t)).toBe(
      "Access (no sub-codes) and Barriers",
    );
    expect(describeQuery({ ...and, terms: [codeRef("gone"), codeRef("b")] }, name, t)).toBe(
      "? and Barriers",
    );
    expect(describeQuery(null, name, t)).toBe("");
  });

  it("reads in Turkish too", async () => {
    await i18n.changeLanguage("tr");
    expect(describeQuery(and, name, t)).toBe("Access ve Barriers");
  });
});

describe("validate", () => {
  it("accepts a complete query", () => {
    expect(validate(and, t)).toBeNull();
    expect(validate({ op: "or", terms: [codeRef("a")], within: null }, t)).toBeNull();
  });

  it("rejects what Rust would reject", () => {
    expect(validate({ op: "and", terms: [], within: null }, t)).toMatch(/at least 1 code/);
    expect(validate({ op: "not", terms: [codeRef("a")], within: null }, t)).toMatch(/at least 2/);
    expect(validate({ op: "near", terms: [codeRef("a")], within: null }, t)).toMatch(/at least 2/);
    expect(validate({ ...and, terms: [codeRef(" "), codeRef("b")] }, t)).toMatch(/needs a code/);
    expect(validate({ ...and, op: "maybe" as Query["op"] }, t)).toMatch(/Unknown operator/);
  });

  it("checks the near distance", () => {
    const near = (n: number): Query => ({
      op: "near",
      terms: and.terms,
      within: { kind: "chars", n },
    });
    expect(validate(near(0), t)).toBeNull();
    expect(validate(near(MAX_NEAR_CHARS), t)).toBeNull();
    expect(validate(near(-1), t)).toMatch(/out of range/);
    expect(validate(near(MAX_NEAR_CHARS + 1), t)).toMatch(/out of range/);
    expect(validate(near(Number.NaN), t)).toMatch(/out of range/);
  });

  it("reports a problem inside a group", () => {
    expect(
      validate(
        {
          op: "and",
          terms: [codeRef("a"), { op: "not", terms: [codeRef("b")], within: null }],
          within: null,
        },
        t,
      ),
    ).toMatch(/at least 2/);
  });
});

describe("edits", () => {
  it("starts from two empty codes, and gives near a scope", () => {
    expect(emptyQuery()).toEqual({ op: "and", terms: [codeRef(""), codeRef("")], within: null });
    expect(emptyQuery("near").within).toEqual({ kind: "paragraph" });
  });

  it("replaces, appends and removes terms", () => {
    expect(setTerm(and, 1, codeRef("c")).terms[1]).toEqual(codeRef("c"));
    expect(addTerm(and, codeRef("c")).terms).toHaveLength(3);
    expect(removeTerm(addTerm(and, codeRef("c")), 0).terms).toEqual([codeRef("b"), codeRef("c")]);
    // "and" is happy with one term, so nothing is padded back in.
    expect(removeTerm(and, 0).terms).toEqual([codeRef("b")]);
    // "not" needs two, so removing one leaves a blank row to fill in.
    expect(removeTerm({ ...and, op: "not" }, 0).terms).toEqual([codeRef("b"), codeRef("")]);
  });

  it("changing the operator keeps the terms and fixes the scope", () => {
    const near = setOp(and, "near");
    expect(near.terms).toEqual(and.terms);
    expect(near.within).toEqual({ kind: "paragraph" });
    // Only near has a scope.
    expect(setOp(near, "or").within).toBeNull();
    // A one-term "or" grows when it becomes a "not".
    const one: Query = { op: "or", terms: [codeRef("a")], within: null };
    expect(setOp(one, "not").terms).toEqual([codeRef("a"), codeRef("")]);
  });

  it("tells a code term from a group", () => {
    expect(isCodeRef(codeRef("a"))).toBe(true);
    expect(isCodeRef(and)).toBe(false);
  });
});
