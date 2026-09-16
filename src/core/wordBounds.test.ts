import { describe, expect, it } from "vitest";
import { nextBoundary, nextCharBoundary, nextWordBoundary } from "./wordBounds";

// Code points: h0 é1 l2 l3 o4 ␠5 w6 ö7 r8 l9 d10 ␠11 😀12 😀13 ␠14 漢15 字16
//              ␠17 t18 e19 s20 t21 ,22 ␠23 o24 k25   (length 26)
const T = "héllo wörld 😀😀 漢字 test, ok";

describe("nextWordBoundary", () => {
  it("walks forward word by word, skipping whitespace first", () => {
    const steps: number[] = [];
    let cp = 0;
    for (let i = 0; i < 9; i++) {
      cp = nextWordBoundary(T, cp, 1);
      steps.push(cp);
    }
    expect(steps).toEqual([5, 11, 14, 17, 22, 23, 26, 26, 26]);
  });

  it("walks backward word by word", () => {
    const steps: number[] = [];
    let cp = 26;
    for (let i = 0; i < 9; i++) {
      cp = nextWordBoundary(T, cp, -1);
      steps.push(cp);
    }
    expect(steps).toEqual([24, 22, 18, 15, 12, 6, 0, 0, 0]);
  });

  it("treats a run of emoji as one step and CJK as a word", () => {
    // From the space before the emoji: skip it, then cross both emoji at once.
    expect(nextWordBoundary(T, 11, 1)).toBe(14);
    expect(nextWordBoundary(T, 14, -1)).toBe(12);
    // 漢字 is a single word, not two.
    expect(nextWordBoundary(T, 14, 1)).toBe(17);
    expect(nextWordBoundary(T, 17, -1)).toBe(15);
  });

  it("stops mid-run rather than jumping over the whole word", () => {
    expect(nextWordBoundary(T, 2, 1)).toBe(5);
    expect(nextWordBoundary(T, 2, -1)).toBe(0);
    expect(nextWordBoundary(T, 20, 1)).toBe(22);
  });

  it("separates punctuation from the word next to it", () => {
    expect(nextWordBoundary(T, 18, 1)).toBe(22); // "test"
    expect(nextWordBoundary(T, 22, 1)).toBe(23); // ","
    expect(nextWordBoundary(T, 23, 1)).toBe(26); // "ok"
  });

  it("clamps out-of-range and empty input", () => {
    expect(nextWordBoundary(T, 999, 1)).toBe(26);
    expect(nextWordBoundary(T, 999, -1)).toBe(24);
    expect(nextWordBoundary(T, -5, 1)).toBe(5);
    expect(nextWordBoundary(T, -5, -1)).toBe(0);
    expect(nextWordBoundary("", 0, 1)).toBe(0);
    expect(nextWordBoundary("", 0, -1)).toBe(0);
    expect(nextWordBoundary("   ", 0, 1)).toBe(3);
  });

  it("crosses newlines as whitespace", () => {
    const t = "one\n\ntwo";
    expect(nextWordBoundary(t, 3, 1)).toBe(8);
    expect(nextWordBoundary(t, 5, -1)).toBe(0);
  });
});

describe("nextCharBoundary", () => {
  it("steps one code point, never half an emoji", () => {
    expect(nextCharBoundary(T, 12, 1)).toBe(13);
    expect(nextCharBoundary(T, 13, -1)).toBe(12);
    expect(nextCharBoundary(T, 0, -1)).toBe(0);
    expect(nextCharBoundary(T, 26, 1)).toBe(26);
    expect(nextCharBoundary(T, 999, 1)).toBe(26);
  });
});

describe("nextBoundary", () => {
  it("dispatches on granularity", () => {
    expect(nextBoundary(T, 0, 1, "word")).toBe(5);
    expect(nextBoundary(T, 0, 1, "char")).toBe(1);
  });
});
