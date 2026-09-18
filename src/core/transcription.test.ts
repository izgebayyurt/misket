import { describe, expect, it } from "vitest";
import {
  PARAGRAPH_OPTIONS,
  formatElapsed,
  formatEta,
  formatSize,
  modelSupportsLanguage,
} from "./transcription";

describe("formatSize", () => {
  it("reads the way the model table does", () => {
    expect(formatSize(75 * 1024 * 1024)).toBe("75 MiB");
    expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GiB");
  });

  it("does not print nonsense for nothing", () => {
    expect(formatSize(0)).toBe("0 MiB");
    expect(formatSize(-1)).toBe("0 MiB");
    expect(formatSize(Number.NaN)).toBe("0 MiB");
  });
});

describe("formatEta", () => {
  it("stays vague", () => {
    expect(formatEta(5)).toBe("less than a minute left");
    expect(formatEta(45)).toBe("about a minute left");
    expect(formatEta(600)).toBe("about 10 min left");
    expect(formatEta(3600)).toBe("about 1 h left");
    expect(formatEta(5400)).toBe("about 1 h 30 min left");
  });

  it("says nothing when there is nothing to say", () => {
    expect(formatEta(null)).toBeNull();
    expect(formatEta(undefined)).toBeNull();
    expect(formatEta(-3)).toBeNull();
  });
});

describe("formatElapsed", () => {
  it("reports how long a run took", () => {
    expect(formatElapsed(1_400)).toBe("1s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
    expect(formatElapsed(0)).toBe("0s");
  });
});

describe("modelSupportsLanguage", () => {
  it("lets a multilingual model take anything", () => {
    expect(modelSupportsLanguage(true, "tr")).toBe(true);
    expect(modelSupportsLanguage(true, null)).toBe(true);
  });

  it("holds an English-only model to English", () => {
    expect(modelSupportsLanguage(false, "en")).toBe(true);
    expect(modelSupportsLanguage(false, "auto")).toBe(true);
    expect(modelSupportsLanguage(false, null)).toBe(true);
    expect(modelSupportsLanguage(false, "tr")).toBe(false);
  });
});

describe("PARAGRAPH_OPTIONS", () => {
  it("offers per-segment first and no duplicates", () => {
    expect(PARAGRAPH_OPTIONS[0]?.value).toBeNull();
    const values = PARAGRAPH_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
