import { describe, expect, it } from "vitest";
import {
  analyzeWhitespace,
  DEFAULT_TIDY_OPTIONS,
  previewDiffLines,
  summarizeWhitespace,
  tidyText,
  type TidyOptions,
} from "./tidy";

const ALL_ON: TidyOptions = {
  collapseBlankLines: true,
  trimTrailingSpaces: true,
  unwrapHardBreaks: true,
  normalizeSpaces: true,
};
const ALL_OFF: TidyOptions = {
  collapseBlankLines: false,
  trimTrailingSpaces: false,
  unwrapHardBreaks: false,
  normalizeSpaces: false,
};

describe("analyzeWhitespace", () => {
  it("reports a clean document as not needing tidy", () => {
    const report = analyzeWhitespace("Hello there.\nSecond line.\n");
    expect(report).toEqual({
      blankLineRuns: 0,
      maxBlankRun: 0,
      trailingSpaceLines: 0,
      tabLines: 0,
      hardWrappedLines: 0,
      nonBreakingSpaces: 0,
      needsTidy: false,
    });
  });

  it("counts runs of 2+ blank lines and the longest run", () => {
    const text = "a\n\n\nb\n\n\n\n\nc\nd";
    const report = analyzeWhitespace(text);
    expect(report.blankLineRuns).toBe(2);
    expect(report.maxBlankRun).toBe(4);
    expect(report.needsTidy).toBe(true);
  });

  it("does not count a file's own trailing newline as a blank line", () => {
    const report = analyzeWhitespace("Sentence one.\nSentence two.\n");
    expect(report.maxBlankRun).toBe(0);
    expect(report.needsTidy).toBe(false);
  });

  it("does not count a single blank line as a run", () => {
    const report = analyzeWhitespace("a\n\nb");
    expect(report.blankLineRuns).toBe(0);
    expect(report.maxBlankRun).toBe(1);
    expect(report.needsTidy).toBe(false);
  });

  it("counts trailing space/tab lines and tab lines", () => {
    const report = analyzeWhitespace("clean\ntrailing space \nhas\ttab\nboth \t\n");
    expect(report.trailingSpaceLines).toBe(2);
    expect(report.tabLines).toBe(2);
    expect(report.needsTidy).toBe(true);
  });

  it("counts non-breaking spaces", () => {
    const report = analyzeWhitespace("a\u00A0b\u00A0c");
    expect(report.nonBreakingSpaces).toBe(2);
    expect(report.needsTidy).toBe(true);
  });

  it("detects hard-wrapped lines: no sentence punctuation, next line starts lowercase", () => {
    const text = "This is a line that keeps\ngoing onto the next one.\nA new sentence.";
    const report = analyzeWhitespace(text);
    expect(report.hardWrappedLines).toBe(1);
    expect(report.needsTidy).toBe(true);
  });

  it("does not flag a line ending in sentence punctuation", () => {
    const report = analyzeWhitespace('End with a quote."\nlowercase next.');
    expect(report.hardWrappedLines).toBe(0);
  });

  it("does not flag when the next line starts uppercase or is blank", () => {
    const a = analyzeWhitespace("Line one\nLine two.");
    expect(a.hardWrappedLines).toBe(0);
    const b = analyzeWhitespace("Line one\n\nlower after blank");
    expect(b.hardWrappedLines).toBe(0);
  });

  it('recognizes the full punctuation set: . ! ? : " ” ’ ) …', () => {
    const enders = [".", "!", "?", ":", '"', "”", "’", ")", "…"];
    for (const ch of enders) {
      const report = analyzeWhitespace(`Sentence ends here${ch}\nlowercase continuation`);
      expect(report.hardWrappedLines, `ender ${ch}`).toBe(0);
    }
  });
});

describe("tidyText", () => {
  it("collapses runs of blank lines to one and trims leading/trailing blanks", () => {
    const text = "\n\na\n\n\n\nb\n\n\n";
    const out = tidyText(text, {
      collapseBlankLines: true,
      trimTrailingSpaces: false,
      unwrapHardBreaks: false,
      normalizeSpaces: false,
    });
    expect(out).toBe("a\n\nb");
  });

  it("trims trailing spaces and tabs per line", () => {
    const text = "a  \nb\t\nc";
    const out = tidyText(text, {
      collapseBlankLines: false,
      trimTrailingSpaces: true,
      unwrapHardBreaks: false,
      normalizeSpaces: false,
    });
    expect(out).toBe("a\nb\nc");
  });

  it("normalizes non-breaking spaces and tabs to a single space and collapses runs", () => {
    const text = "a\u00A0\u00A0b\tc   d";
    const out = tidyText(text, {
      collapseBlankLines: false,
      trimTrailingSpaces: false,
      unwrapHardBreaks: false,
      normalizeSpaces: true,
    });
    expect(out).toBe("a b c d");
  });

  it("unwraps a hard-wrapped line into the next with a single space", () => {
    const text = "This keeps\ngoing on.\nNext sentence.";
    const out = tidyText(text, {
      collapseBlankLines: false,
      trimTrailingSpaces: false,
      unwrapHardBreaks: true,
      normalizeSpaces: false,
    });
    expect(out).toBe("This keeps going on.\nNext sentence.");
  });

  it("chains multiple hard-wraps in one pass", () => {
    const text = "one\ntwo\nthree.\nfour.";
    const out = tidyText(text, {
      collapseBlankLines: false,
      trimTrailingSpaces: false,
      unwrapHardBreaks: true,
      normalizeSpaces: false,
    });
    expect(out).toBe("one two three.\nfour.");
  });

  it("never unwraps across a blank line", () => {
    const text = "This keeps\n\ngoing on.";
    const out = tidyText(text, {
      collapseBlankLines: false,
      trimTrailingSpaces: false,
      unwrapHardBreaks: true,
      normalizeSpaces: false,
    });
    expect(out).toBe("This keeps\n\ngoing on.");
  });

  it("is a no-op with all options off (beyond normalizing line endings)", () => {
    const text = "a\r\nb\nc";
    expect(tidyText(text, ALL_OFF)).toBe("a\nb\nc");
  });

  it("is idempotent for a fixed set of options", () => {
    const messy =
      "  Intro line   \n\n\n\nThis is a sentence that keeps\ngoing onto the next\u00A0\u00A0line\t\twith tabs.\n\n\n\nFinal paragraph.\n\n\n";
    for (const options of [ALL_ON, ALL_OFF, DEFAULT_TIDY_OPTIONS]) {
      const once = tidyText(messy, options);
      const twice = tidyText(once, options);
      expect(twice).toBe(once);
    }
  });

  it("is idempotent starting from clean text too", () => {
    const clean = "Hello there.\n\nSecond paragraph.";
    const once = tidyText(clean, ALL_ON);
    const twice = tidyText(once, ALL_ON);
    expect(twice).toBe(once);
  });
});

describe("summarizeWhitespace", () => {
  it("returns nothing for a clean report", () => {
    expect(summarizeWhitespace(analyzeWhitespace("Clean.\nText."))).toEqual([]);
  });

  it("describes each non-zero metric", () => {
    const text = "a  \n\n\n\nb\u00A0c\td\nlowercase after this";
    const report = analyzeWhitespace(text);
    const parts = summarizeWhitespace(report);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.join(" / ")).toContain("blank lines");
  });
});

describe("previewDiffLines", () => {
  it("returns empty arrays when texts are identical", () => {
    const preview = previewDiffLines("a\nb\nc", "a\nb\nc");
    expect(preview.before).toEqual([]);
    expect(preview.after).toEqual([]);
  });

  it("windows around the first differing line", () => {
    const before = ["one", "two", "three", "four  ", "five", "six"].join("\n");
    const after = ["one", "two", "three", "four", "five", "six"].join("\n");
    const preview = previewDiffLines(before, after, 40);
    expect(preview.startLine).toBe(0);
    expect(preview.before).toEqual(["one", "two", "three", "four  ", "five", "six"]);
    expect(preview.after).toEqual(["one", "two", "three", "four", "five", "six"]);
  });

  it("limits the window to maxLines", () => {
    const beforeLines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const afterLines = [...beforeLines];
    afterLines[50] = "CHANGED";
    const preview = previewDiffLines(beforeLines.join("\n"), afterLines.join("\n"), 10);
    expect(preview.before.length).toBeLessThanOrEqual(10);
    expect(preview.after.length).toBeLessThanOrEqual(10);
    expect(preview.startLine).toBe(47);
  });
});
