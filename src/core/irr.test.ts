import { describe, expect, it } from "vitest";
import { describeScope, formatKappa, formatPercent, kappaBand, kappaShade } from "./irr";

describe("kappaBand", () => {
  it("uses the Landis & Koch boundaries", () => {
    expect(kappaBand(-0.3).label).toBe("Poor");
    expect(kappaBand(0).label).toBe("Slight");
    expect(kappaBand(0.2).label).toBe("Slight");
    expect(kappaBand(0.21).label).toBe("Fair");
    expect(kappaBand(0.4).label).toBe("Fair");
    expect(kappaBand(0.6).label).toBe("Moderate");
    expect(kappaBand(0.8).label).toBe("Substantial");
    expect(kappaBand(0.81).label).toBe("Almost perfect");
    expect(kappaBand(1).label).toBe("Almost perfect");
  });

  it("has no band for an undefined kappa", () => {
    expect(kappaBand(null).id).toBe("none");
    expect(kappaBand(undefined).id).toBe("none");
    expect(kappaBand(Number.NaN).id).toBe("none");
  });
});

describe("formatting", () => {
  it("writes kappa to two decimals and undefined as a dash", () => {
    expect(formatKappa(0.6666)).toBe("0.67");
    expect(formatKappa(1)).toBe("1.00");
    expect(formatKappa(-1)).toBe("-1.00");
    expect(formatKappa(null)).toBe("—");
  });

  it("never prints a negative zero", () => {
    expect(formatKappa(-0.001)).toBe("0.00");
  });

  it("writes agreement as whole percent", () => {
    expect(formatPercent(0.5833)).toBe("58%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("kappaShade", () => {
  it("leaves at-or-below-chance cells unshaded", () => {
    expect(kappaShade(0)).toEqual({});
    expect(kappaShade(-0.5)).toEqual({});
    expect(kappaShade(null)).toEqual({});
  });

  it("deepens towards 1 and flips the text colour when dark", () => {
    expect(kappaShade(0.2).backgroundColor).toContain("22%");
    expect(kappaShade(0.2).color).toBeUndefined();
    expect(kappaShade(1).backgroundColor).toContain("72%");
    expect(kappaShade(1).color).toBe("var(--accent-fg)");
  });
});

describe("describeScope", () => {
  it("names the unit and pluralizes", () => {
    expect(describeScope({ unit: "paragraph", units: 4, documents: 1, codes: 3 })).toBe(
      "4 paragraphs across 1 document, 3 codes",
    );
    expect(describeScope({ unit: "turn", units: 1, documents: 2, codes: 1 })).toBe(
      "1 speaker turn across 2 documents, 1 code",
    );
    expect(describeScope({ unit: "excerpt", units: 9, documents: 3, codes: 2 })).toBe(
      "9 excerpts across 3 documents, 2 codes",
    );
  });
});
