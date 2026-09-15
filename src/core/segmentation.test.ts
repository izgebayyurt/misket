import { describe, expect, it } from "vitest";
import { segmentParagraph, splitParagraphs, type RenderableExcerpt } from "./segmentation";

const ex = (
  id: string,
  start: number,
  end: number,
  codeIds: string[] = [id],
): RenderableExcerpt => ({
  id,
  start,
  end,
  codeIds,
});

function joined(text: string, paraStart: number, paraEnd: number, excerpts: RenderableExcerpt[]) {
  return segmentParagraph(paraStart, paraEnd, excerpts)
    .map((s) => text.slice(s.start, s.end))
    .join("");
}

describe("segmentParagraph", () => {
  const text = "0123456789";

  it("returns one plain segment with no excerpts", () => {
    expect(segmentParagraph(0, 10, [])).toEqual([
      { start: 0, end: 10, excerptIds: [], codeIds: [] },
    ]);
  });

  it("handles a single excerpt inside the paragraph", () => {
    const segs = segmentParagraph(0, 10, [ex("a", 2, 5)]);
    expect(segs.map((s) => [s.start, s.end, s.excerptIds])).toEqual([
      [0, 2, []],
      [2, 5, ["a"]],
      [5, 10, []],
    ]);
    expect(joined(text, 0, 10, [ex("a", 2, 5)])).toBe(text);
  });

  it("handles nested and partially overlapping excerpts", () => {
    const excerpts = [ex("a", 1, 8), ex("b", 3, 5), ex("c", 6, 9, ["x", "a"])];
    const segs = segmentParagraph(0, 10, excerpts);
    expect(segs.map((s) => [s.start, s.end, s.excerptIds.join(","), s.codeIds.join(",")])).toEqual([
      [0, 1, "", ""],
      [1, 3, "a", "a"],
      [3, 5, "a,b", "a,b"],
      [5, 6, "a", "a"],
      [6, 8, "a,c", "a,x"],
      [8, 9, "c", "x,a"],
      [9, 10, "", ""],
    ]);
    expect(joined(text, 0, 10, excerpts)).toBe(text);
  });

  it("handles adjacent (touching) excerpts without merging them", () => {
    const segs = segmentParagraph(0, 10, [ex("a", 0, 5), ex("b", 5, 10)]);
    expect(segs.map((s) => s.excerptIds)).toEqual([["a"], ["b"]]);
  });

  it("clips excerpts that cross paragraph boundaries", () => {
    const segs = segmentParagraph(10, 20, [ex("a", 5, 15), ex("b", 18, 30)]);
    expect(segs.map((s) => [s.start, s.end, s.excerptIds])).toEqual([
      [10, 15, ["a"]],
      [15, 18, []],
      [18, 20, ["b"]],
    ]);
  });

  it("ignores empty excerpts and excerpts outside the paragraph", () => {
    const segs = segmentParagraph(0, 10, [ex("z", 3, 3), ex("y", 10, 12), ex("x", 20, 25)]);
    expect(segs).toEqual([{ start: 0, end: 10, excerptIds: [], codeIds: [] }]);
  });

  it("empty paragraph yields an empty segment", () => {
    expect(segmentParagraph(4, 4, [ex("a", 0, 10)])).toEqual([
      { start: 4, end: 4, excerptIds: [], codeIds: [] },
    ]);
  });
});

describe("splitParagraphs", () => {
  it("keeps UTF-16 starts including empty lines", () => {
    expect(splitParagraphs("ab\n\ncd")).toEqual([
      { start: 0, end: 2, text: "ab" },
      { start: 3, end: 3, text: "" },
      { start: 4, end: 6, text: "cd" },
    ]);
    expect(splitParagraphs("")).toEqual([{ start: 0, end: 0, text: "" }]);
  });
});
