import { describe, expect, it } from "vitest";
import { sparklineAreaPath, sparklineLinePath, sparklinePoints, zeroFillDays } from "./sparkline";

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

describe("zeroFillDays", () => {
  const today = new Date(Date.UTC(2024, 2, 10)); // 2024-03-10

  it("zero-fills every day in the window, oldest first, ending on `today`", () => {
    const series = zeroFillDays([], 5, today);
    expect(series).toEqual([
      ["2024-03-06", 0],
      ["2024-03-07", 0],
      ["2024-03-08", 0],
      ["2024-03-09", 0],
      ["2024-03-10", 0],
    ]);
  });

  it("fills in counts for the days that have them", () => {
    const series = zeroFillDays(
      [
        ["2024-03-08", 3],
        ["2024-03-10", 1],
      ],
      5,
      today,
    );
    expect(series).toEqual([
      ["2024-03-06", 0],
      ["2024-03-07", 0],
      ["2024-03-08", 3],
      ["2024-03-09", 0],
      ["2024-03-10", 1],
    ]);
  });

  it("ignores counts outside the window", () => {
    const series = zeroFillDays([["2020-01-01", 99]], 3, today);
    expect(series.reduce((sum, [, c]) => sum + c, 0)).toBe(0);
  });

  it("defaults to the real current date when `today` is omitted", () => {
    const series = zeroFillDays([], 1);
    expect(series).toEqual([[new Date().toISOString().slice(0, 10), 0]]);
  });
});
