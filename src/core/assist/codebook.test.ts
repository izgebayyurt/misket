import { describe, expect, it } from "vitest";
import { MAX_CODEBOOK_CODES, overlap, terms, trimCodebook, type CodebookEntry } from "./codebook";

function entry(id: string, path: string, extra: Partial<CodebookEntry> = {}): CodebookEntry {
  return { id, path, description: "", inclusion: "", exclusion: "", ...extra };
}

describe("terms", () => {
  it("drops short and common words and stems the rest", () => {
    const t = terms("The nurses were waiting in the corridor");
    expect(t.has("the")).toBe(false);
    expect(t.has("in")).toBe(false);
    // Stemmed, so "nurses" and "nurse" are the same term.
    expect(t).toEqual(terms("nurse waiting corridor"));
  });

  it("splits on punctuation and numbers stay", () => {
    expect(terms("ward-3, ward 3!")).toEqual(new Set(["ward"]));
  });
});

describe("overlap", () => {
  const passage = terms("I waited four hours in the corridor before anyone came");

  it("counts a hit in the name double", () => {
    const named = overlap(passage, entry("a", "Waiting"));
    const described = overlap(passage, entry("b", "Access", { description: "waiting" }));
    expect(named).toBe(2);
    expect(described).toBe(1);
  });

  it("is zero for a code the passage has nothing to do with", () => {
    expect(overlap(passage, entry("c", "Funding"))).toBe(0);
  });
});

describe("trimCodebook", () => {
  it("returns the whole book untouched when it fits", () => {
    const book = [entry("a", "Alpha"), entry("b", "Beta")];
    expect(trimCodebook(book, "anything", 200)).toBe(book);
  });

  it("keeps the closest codes and puts them back in codebook order", () => {
    const book = [
      entry("far", "Funding"),
      entry("near", "Waiting times"),
      entry("other", "Staffing"),
      entry("mid", "Corridor care"),
    ];
    const kept = trimCodebook(book, "I waited in the corridor for hours", 2);
    expect(kept.map((c) => c.id)).toEqual(["near", "mid"]);
  });

  it("is stable when nothing overlaps: codebook order wins", () => {
    const book = Array.from({ length: 5 }, (_, i) => entry(`c${i}`, `Code ${i}`));
    expect(trimCodebook(book, "zzz", 3).map((c) => c.id)).toEqual(["c0", "c1", "c2"]);
  });

  it("sends nothing when asked for nothing", () => {
    expect(trimCodebook([entry("a", "Alpha")], "x", 0)).toEqual([]);
  });

  it("caps at 200 by default", () => {
    const book = Array.from({ length: 500 }, (_, i) => entry(`c${i}`, `Code ${i}`));
    expect(trimCodebook(book, "code 300")).toHaveLength(MAX_CODEBOOK_CODES);
  });
});
