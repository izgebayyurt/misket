import { describe, expect, it } from "vitest";
import { paragraphContext } from "./context";

const text = ["First paragraph.", "Second paragraph.", "Third paragraph."].join("\n\n");

describe("paragraphContext", () => {
  it("takes the paragraph either side and no more", () => {
    const start = text.indexOf("Second");
    const { before, after } = paragraphContext(text, start, start + "Second paragraph.".length);
    expect(before).toBe("First paragraph.");
    expect(after).toBe("Third paragraph.");
  });

  it("is empty at the very start and the very end", () => {
    expect(paragraphContext(text, 0, 5).before).toBe("");
    expect(paragraphContext(text, text.length - 5, text.length).after).toBe("");
  });

  it("falls back to a plain window when there are no blank lines", () => {
    const flat = "a".repeat(50) + "TARGET" + "b".repeat(50);
    const { before, after } = paragraphContext(flat, 50, 56, 10);
    expect(before).toBe("a".repeat(10));
    expect(after).toBe("b".repeat(10));
  });

  it("caps each side", () => {
    const long = `${"x ".repeat(2000)}\n\nmiddle\n\n${"y ".repeat(2000)}`;
    const start = long.indexOf("middle");
    const { before, after } = paragraphContext(long, start, start + 6, 100);
    expect(before.length).toBeLessThanOrEqual(100);
    expect(after.length).toBeLessThanOrEqual(100);
  });

  it("copes with offsets outside the text", () => {
    expect(paragraphContext(text, -10, 1_000_000)).toEqual({ before: "", after: "" });
  });

  it("counts in code points, not UTF-16 units", () => {
    const withEmoji = "😀😀😀\n\nhere\n\n😀😀😀";
    const { before, after } = paragraphContext(withEmoji, 5, 9);
    expect(before).toBe("😀😀😀");
    expect(after).toBe("😀😀😀");
  });
});
