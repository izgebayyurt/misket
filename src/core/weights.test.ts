import { describe, expect, it } from "vitest";
import type { WeightScale } from "@/api/types";
import i18n from "@/lib/i18n";
import {
  fitsWeightScale,
  formatWeight,
  formatWeightWithLabel,
  snapWeight,
  validateWeightScale,
  weightLabel,
  weightScaleValues,
} from "./weights";

const intensity: WeightScale = { min: 1, max: 5, step: 1, default: 3 };
const sentiment: WeightScale = {
  min: -2,
  max: 2,
  step: 1,
  default: 0,
  labels: { "-2": "very negative", "2": "very positive" },
};

describe("validateWeightScale", () => {
  const t = i18n.t.bind(i18n);

  it("rejects min >= max, step <= 0 and an out-of-range default", () => {
    expect(validateWeightScale({ min: 5, max: 1, step: 1, default: 3 }, t)).toMatch(/min/);
    expect(validateWeightScale({ min: 1, max: 5, step: 0, default: 3 }, t)).toMatch(/step/);
    expect(validateWeightScale({ min: 1, max: 5, step: -1, default: 3 }, t)).toMatch(/step/);
    expect(validateWeightScale({ min: 1, max: 5, step: 1, default: 6 }, t)).toMatch(/default/);
    expect(validateWeightScale({ min: 1, max: 5, step: 1, default: 0 }, t)).toMatch(/default/);
  });

  it("accepts a well-formed scale", () => {
    expect(validateWeightScale(intensity, t)).toBeNull();
    expect(validateWeightScale(sentiment, t)).toBeNull();
  });
});

describe("snapWeight", () => {
  it("rounds to the nearest step", () => {
    expect(snapWeight(intensity, 3.4)).toBe(3);
    expect(snapWeight(intensity, 3.6)).toBe(4);
  });

  it("clamps to the range after snapping", () => {
    expect(snapWeight(intensity, 0)).toBe(1);
    expect(snapWeight(intensity, 9)).toBe(5);
  });

  it("works with a negative range and non-integer steps", () => {
    expect(snapWeight(sentiment, -1.6)).toBe(-2);
    const half: WeightScale = { min: 0, max: 1, step: 0.5, default: 0.5 };
    expect(snapWeight(half, 0.2)).toBe(0);
    expect(snapWeight(half, 0.3)).toBe(0.5);
  });
});

describe("fitsWeightScale", () => {
  it("is true only within [min, max]", () => {
    expect(fitsWeightScale(intensity, 1)).toBe(true);
    expect(fitsWeightScale(intensity, 5)).toBe(true);
    expect(fitsWeightScale(intensity, 0.9)).toBe(false);
    expect(fitsWeightScale(intensity, 5.1)).toBe(false);
  });
});

describe("weightScaleValues", () => {
  it("lists every step from min to max", () => {
    expect(weightScaleValues(intensity)).toEqual([1, 2, 3, 4, 5]);
    expect(weightScaleValues(sentiment)).toEqual([-2, -1, 0, 1, 2]);
  });
});

describe("formatWeight and labels", () => {
  it("formats without floating-point noise", () => {
    expect(formatWeight(3)).toBe("3");
    expect(formatWeight(0.1 + 0.2)).toBe("0.3");
  });

  it("looks up a label by the value's formatted key", () => {
    expect(weightLabel(sentiment, -2)).toBe("very negative");
    expect(weightLabel(sentiment, 2)).toBe("very positive");
    expect(weightLabel(sentiment, 0)).toBeNull();
    expect(weightLabel(intensity, 3)).toBeNull();
  });

  it("appends the label in parentheses when there is one", () => {
    expect(formatWeightWithLabel(sentiment, -2)).toBe("-2 (very negative)");
    expect(formatWeightWithLabel(sentiment, 0)).toBe("0");
  });
});
