import { describe, expect, it } from "vitest";
import { ANALYSES, ANALYSIS_GROUPS, analysisEntry } from "./registry";

describe("the analysis registry", () => {
  it("gives every analysis a unique id", () => {
    const ids = ANALYSES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts every analysis in a group the list knows how to head", () => {
    const groups = new Set(ANALYSIS_GROUPS.map((g) => g.id));
    for (const a of ANALYSES) expect(groups).toContain(a.group);
  });

  it("gives every analysis a label, an icon and a component", () => {
    for (const a of ANALYSES) {
      expect(a.label.trim()).not.toBe("");
      expect(a.icon).toBeTruthy();
      expect(a.component).toBeTruthy();
    }
  });

  it("finds an analysis by its tab name", () => {
    expect(analysisEntry("reliability").label).toBe("Reliability");
    expect(analysisEntry("frequencies").label).toBe("Frequencies");
  });

  it("falls back to the first analysis for a tab this build does not have", () => {
    // A window restored with a tab another branch added, or one since removed.
    expect(analysisEntry("not-an-analysis" as never)).toBe(ANALYSES[0]);
  });

  it("carries the analyses merged in from other branches", () => {
    expect(ANALYSES.map((a) => a.id)).toContain("treemap");
    expect(ANALYSES.map((a) => a.id)).toContain("clustering");
  });

  it("keeps reliability in the list rather than in its own view", () => {
    expect(ANALYSES.find((a) => a.id === "reliability")?.group).toBe("team");
  });
});
