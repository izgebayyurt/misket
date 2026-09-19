import { describe, expect, it } from "vitest";
import { intlTag, resolveLocale, SUPPORTED_LOCALES } from "./locale";

describe("resolveLocale", () => {
  it("passes an explicit setting straight through", () => {
    expect(resolveLocale("en", "tr-TR")).toBe("en");
    expect(resolveLocale("tr", "en-US")).toBe("tr");
  });

  it('reads the system locale when the setting is "system"', () => {
    expect(resolveLocale("system", "tr-TR")).toBe("tr");
    expect(resolveLocale("system", "tr")).toBe("tr");
    expect(resolveLocale("system", "en-GB")).toBe("en");
  });

  it("falls back to English for anything unsupported", () => {
    expect(resolveLocale("system", "fr-FR")).toBe("en");
    expect(resolveLocale("system", "")).toBe("en");
  });

  it("only ever returns a shipped locale", () => {
    for (const setting of ["system", "en", "tr"] as const) {
      for (const sys of ["fr-FR", "tr-TR", "en-US", "de"]) {
        expect(SUPPORTED_LOCALES).toContain(resolveLocale(setting, sys));
      }
    }
  });
});

describe("intlTag", () => {
  it("maps each locale to a BCP 47 tag Intl accepts", () => {
    expect(intlTag("en")).toBe("en-US");
    expect(intlTag("tr")).toBe("tr-TR");
    expect(() => new Intl.NumberFormat(intlTag("en"))).not.toThrow();
    expect(() => new Intl.NumberFormat(intlTag("tr"))).not.toThrow();
  });
});
