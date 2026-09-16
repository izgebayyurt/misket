import { describe, expect, it } from "vitest";
import { paragraphAt, sentenceAt } from "./textUnits";

function at(text: string, span: { start: number; end: number }) {
  return text.slice(span.start, span.end);
}

describe("paragraphAt", () => {
  const text = "First para.\nSecond para, two sentences. Still second.\n\nThird para.";

  it("finds the paragraph containing an offset", () => {
    expect(at(text, paragraphAt(text, 2))).toBe("First para.");
    expect(at(text, paragraphAt(text, 20))).toBe("Second para, two sentences. Still second.");
    expect(at(text, paragraphAt(text, text.length - 3))).toBe("Third para.");
  });

  it("clamps out-of-range offsets", () => {
    expect(at(text, paragraphAt(text, -5))).toBe("First para.");
    expect(at(text, paragraphAt(text, text.length + 50))).toBe("Third para.");
  });

  it("returns an empty span for a blank line", () => {
    const blankAt = text.indexOf("\n\n") + 1;
    expect(paragraphAt(text, blankAt)).toEqual({ start: blankAt, end: blankAt });
  });
});

describe("sentenceAt", () => {
  const text = "First para.\nSecond para, two sentences. Still second.\n\nThird para.";

  it("finds the sentence containing an offset, within its paragraph", () => {
    const secondSentenceStart = text.indexOf("Still second.");
    expect(at(text, sentenceAt(text, secondSentenceStart + 3))).toBe("Still second.");
    const firstSentenceStart = text.indexOf("Second para");
    expect(at(text, sentenceAt(text, firstSentenceStart + 3))).toBe("Second para, two sentences.");
  });

  it("never crosses a paragraph boundary", () => {
    const span = sentenceAt(text, text.indexOf("Third para") + 2);
    expect(at(text, span)).toBe("Third para.");
  });

  it("handles a quoted or bracketed sentence ending", () => {
    const t = 'She said "hello there." Then left. Another one.';
    const span = sentenceAt(t, 2);
    expect(at(t, span)).toBe('She said "hello there."');
  });

  it("falls back to the whole paragraph when there is no sentence punctuation", () => {
    const t = "no punctuation here at all";
    expect(at(t, sentenceAt(t, 5))).toBe(t);
  });
});
