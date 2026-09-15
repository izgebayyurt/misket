import { describe, expect, it } from "vitest";
import { buildOffsetMap, codePointCount, cpToUtf16, utf16ToCp } from "./offsets";

describe("offsets", () => {
  it("is the identity for BMP text", () => {
    const m = buildOffsetMap("héllo");
    expect(codePointCount(m)).toBe(5);
    for (let i = 0; i <= 5; i++) {
      expect(cpToUtf16(m, i)).toBe(i);
      expect(utf16ToCp(m, i)).toBe(i);
    }
  });

  it("accounts for surrogate pairs", () => {
    const text = "a😀b😀"; // cps: a(0) 😀(1) b(2) 😀(3); u16 length 6
    const m = buildOffsetMap(text);
    expect(codePointCount(m)).toBe(4);
    expect([0, 1, 2, 3, 4].map((cp) => cpToUtf16(m, cp))).toEqual([0, 1, 3, 4, 6]);
    expect([0, 1, 2, 3, 4, 5, 6].map((u) => utf16ToCp(m, u))).toEqual([0, 1, 1, 2, 3, 3, 4]);
    expect(text.slice(cpToUtf16(m, 1), cpToUtf16(m, 2))).toBe("😀");
  });

  it("handles empty text and range errors", () => {
    const m = buildOffsetMap("");
    expect(codePointCount(m)).toBe(0);
    expect(cpToUtf16(m, 0)).toBe(0);
    expect(() => cpToUtf16(m, 1)).toThrow(RangeError);
    expect(() => utf16ToCp(m, -1)).toThrow(RangeError);
  });

  it("treats a lone high surrogate as one code point", () => {
    const m = buildOffsetMap("\ud83dx");
    expect(codePointCount(m)).toBe(2);
    expect(cpToUtf16(m, 1)).toBe(1);
  });
});
