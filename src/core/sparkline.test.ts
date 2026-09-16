import { describe, expect, it } from "vitest";
import { sparklineAreaPath, sparklineLinePath, sparklinePoints } from "./sparkline";

describe("sparklinePoints", () => {
  it("returns nothing for an empty series", () => {
    expect(sparklinePoints([], { width: 100, height: 20 })).toEqual([]);
  });

  it("centers a single point and draws it at the top (it is the max)", () => {
    expect(sparklinePoints([5], { width: 100, height: 20 })).toEqual([{ x: 50, y: 0 }]);
  });

  it("draws an all-zero series flat along the baseline", () => {
    const points = sparklinePoints([0, 0, 0, 0], { width: 90, height: 30 });
    expect(points.every((p) => p.y === 30)).toBe(true);
    expect(points.map((p) => p.x)).toEqual([0, 30, 60, 90]);
  });

  it("scales the tallest value to y = 0 and spaces points evenly", () => {
    const points = sparklinePoints([0, 5, 10], { width: 20, height: 10 });
    expect(points).toEqual([
      { x: 0, y: 10 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ]);
  });

  it("clamps negative values to the baseline instead of drawing off-chart", () => {
    const points = sparklinePoints([-3, 4], { width: 10, height: 10 });
    expect(points[0]!.y).toBe(10);
  });
});

describe("sparklineLinePath", () => {
  it("is empty for no data", () => {
    expect(sparklineLinePath([], { width: 10, height: 10 })).toBe("");
  });

  it("starts with M and continues with L for each later point", () => {
    const d = sparklineLinePath([0, 2, 4], { width: 20, height: 10 });
    expect(d).toBe("M0,10 L10,5 L20,0");
  });
});

describe("sparklineAreaPath", () => {
  it("is empty for no data", () => {
    expect(sparklineAreaPath([], { width: 10, height: 10 })).toBe("");
  });

  it("closes the line down to the baseline under the last and first points", () => {
    const d = sparklineAreaPath([0, 2, 4], { width: 20, height: 10 });
    expect(d).toBe("M0,10 L10,5 L20,0 L20,10 L0,10 Z");
  });
});
