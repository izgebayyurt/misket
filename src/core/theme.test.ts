import { describe, expect, it } from "vitest";
import { resolveDark } from "./theme";

describe("resolveDark", () => {
  it("forces dark or light regardless of the media query", () => {
    expect(resolveDark("dark", false)).toBe(true);
    expect(resolveDark("dark", true)).toBe(true);
    expect(resolveDark("light", false)).toBe(false);
    expect(resolveDark("light", true)).toBe(false);
  });

  it("follows the media query for 'system'", () => {
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
  });
});
