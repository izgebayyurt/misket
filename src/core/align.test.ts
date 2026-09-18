import { describe, expect, it } from "vitest";
import { msToPos, parseTimeMs, posToMs, prepare, type Anchor } from "./align";

const a = (pairs: [number, number][]): Anchor[] => pairs.map(([pos, ms]) => ({ pos, ms }));

describe("alignment", () => {
  it("puts everything at the start when nothing is anchored", () => {
    expect(posToMs([], 0)).toBe(0);
    expect(posToMs([], 5000)).toBe(0);
    expect(msToPos([], 90_000)).toBe(0);
  });

  it("interpolates linearly between anchors", () => {
    const anchors = a([
      [100, 10_000],
      [200, 30_000],
    ]);
    expect(posToMs(anchors, 100)).toBe(10_000);
    expect(posToMs(anchors, 150)).toBe(20_000);
    expect(posToMs(anchors, 200)).toBe(30_000);
    expect(msToPos(anchors, 20_000)).toBe(150);
  });

  it("starts at 0 ms before the first anchor and carries on past the last", () => {
    const anchors = a([
      [100, 10_000],
      [200, 40_000],
    ]);
    expect(posToMs(anchors, 0)).toBe(0);
    expect(posToMs(anchors, 50)).toBe(5_000);
    // 200 ms per code point on average.
    expect(posToMs(anchors, 300)).toBe(60_000);
    expect(msToPos(anchors, 60_000)).toBe(300);
  });

  it("lets an anchor at the very start push the whole document back", () => {
    const anchors = a([
      [0, 30_000],
      [100, 40_000],
    ]);
    expect(posToMs(anchors, 0)).toBe(30_000);
    expect(posToMs(anchors, 50)).toBe(35_000);
    expect(msToPos(anchors, 0)).toBe(0);
    expect(msToPos(anchors, 35_000)).toBe(50);
  });

  it("sorts, de-duplicates and never lets the clock run backwards", () => {
    const messy = a([
      [200, 30_000],
      [100, 10_000],
      [150, 5_000],
      [-3, 1],
    ]);
    expect(prepare(messy)).toEqual(
      a([
        [100, 10_000],
        [150, 10_000],
        [200, 30_000],
      ]),
    );
    expect(prepare(prepare(messy))).toEqual(prepare(messy));
    expect(posToMs(messy, 120)).toBeLessThanOrEqual(posToMs(messy, 160));
  });

  it("answers a pause with the passage about to be read", () => {
    const anchors = a([
      [100, 10_000],
      [160, 10_000],
      [200, 14_000],
    ]);
    expect(posToMs(anchors, 130)).toBe(10_000);
    expect(msToPos(anchors, 10_000)).toBe(100);
    expect(msToPos(anchors, 12_000)).toBe(180);
  });

  it("round trips through both directions", () => {
    const anchors = a([
      [40, 2_000],
      [120, 9_500],
      [400, 61_000],
    ]);
    for (const pos of [0, 1, 39, 40, 119, 120, 260, 400, 401, 900]) {
      expect(Math.abs(msToPos(anchors, posToMs(anchors, pos)) - pos)).toBeLessThanOrEqual(1);
    }
  });
});

describe("parseTimeMs", () => {
  it("takes the shapes transcripts and cues are written in", () => {
    expect(parseTimeMs("0:05")).toBe(5_000);
    expect(parseTimeMs("12:34")).toBe(754_000);
    expect(parseTimeMs("1:02:03")).toBe(3_723_000);
    expect(parseTimeMs("01:02:03")).toBe(3_723_000);
    expect(parseTimeMs("00:01.250")).toBe(1_250);
    expect(parseTimeMs("00:01,250")).toBe(1_250);
    expect(parseTimeMs("00:01.5")).toBe(1_500);
    expect(parseTimeMs(" [12:34] ")).toBe(754_000);
    expect(parseTimeMs("(1:02:03)")).toBe(3_723_000);
    expect(parseTimeMs("<00:00:02.000>")).toBe(2_000);
    expect(parseTimeMs("124:00")).toBe(7_440_000);
  });

  it("refuses anything that is not a clock", () => {
    for (const bad of ["", "12", "12:3", "12:345", "ten", "1:2:3:4", "12:60", "12:ab", "12:34."]) {
      expect(parseTimeMs(bad), bad).toBeNull();
    }
  });
});
