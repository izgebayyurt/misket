import { describe, expect, it } from "vitest";
import { findMatches, matchIndexAtOrAfter } from "./find";

describe("findMatches", () => {
  it("returns nothing for an empty or whitespace query, or empty text", () => {
    expect(findMatches("hello world", "")).toEqual([]);
    expect(findMatches("hello world", "   ")).toEqual([]);
    expect(findMatches("", "hello")).toEqual([]);
  });

  it("finds case-insensitive ASCII matches with UTF-16 ranges", () => {
    expect(findMatches("Hello WORLD hello", "hello")).toEqual([
      { start: 0, end: 5 },
      { start: 12, end: 17 },
    ]);
    expect(findMatches("Hello WORLD hello", "WoRlD")).toEqual([{ start: 6, end: 11 }]);
  });

  it("does not overlap matches", () => {
    expect(findMatches("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("trims the query but not the text", () => {
    expect(findMatches("  hello  ", "hello")).toEqual([{ start: 2, end: 7 }]);
    expect(findMatches("hello", "  hello  ")).toEqual([{ start: 0, end: 5 }]);
  });

  it("accounts for surrogate pairs (emoji) before a match", () => {
    const text = "a😀b😀 world";
    // "a"(0) "😀"(1-2) "b"(3) "😀"(4-5) " "(6) => "world" starts at u16 7.
    const matches = findMatches(text, "world");
    expect(matches).toEqual([{ start: 7, end: 12 }]);
    expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe("world");
  });

  it("matches CJK text exactly (case folding is a no-op for it)", () => {
    const text = "漢字 test 漢字";
    const matches = findMatches(text, "漢字");
    expect(matches).toEqual([
      { start: 0, end: 2 },
      { start: 8, end: 10 },
    ]);
  });

  it("falls back to a code-point-safe scan when case folding changes length", () => {
    // Turkish capital dotted I lower-cases to "i" + combining dot above (2 code units).
    const text = "İstanbul";
    const lower = text.toLowerCase();
    expect(lower.length).not.toBe(text.length); // sanity: this exercises the slow path
    const matches = findMatches(text, "İstanbul");
    expect(matches).toEqual([{ start: 0, end: text.length }]);
    // A plain-ASCII needle still matches inside such text via the slow path.
    expect(findMatches(text, "anbul")).toEqual([{ start: 3, end: 8 }]);
  });

  it("returns no matches when the needle is longer than the haystack", () => {
    expect(findMatches("hi", "hello")).toEqual([]);
  });

  describe("with { stem: true }", () => {
    it("matches other word forms sharing a stem", () => {
      const text = "She coded the interview yesterday.";
      expect(findMatches(text, "coding", { stem: false })).toEqual([]);
      const matches = findMatches(text, "coding", { stem: true });
      expect(matches).toEqual([{ start: 4, end: 9 }]);
      expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe("coded");
    });

    it("matches a multi-word query as a contiguous, in-order run", () => {
      const text = "The participants were coding interviews all week.";
      const matches = findMatches(text, "code interview", { stem: true });
      expect(matches).toEqual([{ start: 22, end: 39 }]);
      expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe("coding interviews");
    });

    it("does not match out of order or a merely similar-looking word", () => {
      expect(findMatches("interview coding session", "code interview", { stem: true })).toEqual([]);
      // "codicil" must not match "code" just because it starts the same way.
      expect(findMatches("a codicil to the will", "code", { stem: true })).toEqual([]);
    });
  });
});

describe("matchIndexAtOrAfter", () => {
  const matches = [
    { start: 0, end: 3 },
    { start: 10, end: 13 },
    { start: 20, end: 23 },
  ];

  it("finds the first match at or after the offset", () => {
    expect(matchIndexAtOrAfter(matches, 0)).toBe(0);
    expect(matchIndexAtOrAfter(matches, 5)).toBe(1);
    expect(matchIndexAtOrAfter(matches, 10)).toBe(1);
    expect(matchIndexAtOrAfter(matches, 21)).toBe(0); // none qualify -> wrap to first
  });

  it("returns 0 for an empty match list", () => {
    expect(matchIndexAtOrAfter([], 5)).toBe(0);
  });
});
