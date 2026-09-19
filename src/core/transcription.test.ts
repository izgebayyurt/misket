import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import {
  PARAGRAPH_OPTIONS,
  formatElapsed,
  formatEta,
  formatSize,
  modelSupportsLanguage,
} from "./transcription";

const t = i18n.t.bind(i18n);

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
    expect(formatEta(5, t)).toBe("less than a minute left");
    expect(formatEta(45, t)).toBe("about a minute left");
    expect(formatEta(600, t)).toBe("about 10 min left");
    expect(formatEta(3600, t)).toBe("about 1 h left");
    expect(formatEta(5400, t)).toBe("about 1 h 30 min left");
  });

  it("says nothing when there is nothing to say", () => {
    expect(formatEta(null, t)).toBeNull();
    expect(formatEta(undefined, t)).toBeNull();
    expect(formatEta(-3, t)).toBeNull();
  });
});

describe("formatElapsed", () => {
  it("reports how long a run took", () => {
    expect(formatElapsed(1_400, t)).toBe("1s");
    expect(formatElapsed(65_000, t)).toBe("1m 05s");
    expect(formatElapsed(111, t)).toBe("under a second");
    expect(formatElapsed(0, t)).toBe("under a second");
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

  it("resolves every label key against the en resource", () => {
    for (const option of PARAGRAPH_OPTIONS) {
      expect(t(option.labelKey)).not.toBe(option.labelKey);
    }
  });
});
