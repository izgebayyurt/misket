import { afterEach, describe, expect, it } from "vitest";
import i18n, { applyLanguage, currentLocale } from "./i18n";

describe("i18next plural rules", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("picks English's two plural forms by count", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("history.stepCount", { count: 1 })).toBe("1 change");
    expect(i18n.t("history.stepCount", { count: 5 })).toBe("5 changes");
  });

  it("uses Turkish's single plural form for every count", async () => {
    await i18n.changeLanguage("tr");
    // Turkish nouns do not inflect after a numeral, so _one and _other are
    // the same text (see the brief: "supply both keys" all the same, since
    // a resource with only _other would fall back to it for count === 1 too,
    // but we author both so a future locale with real forms is unsurprising).
    expect(i18n.t("history.stepCount", { count: 1 })).toBe("1 değişiklik");
    expect(i18n.t("history.stepCount", { count: 5 })).toBe("5 değişiklik");
  });

  it("formats {{count, number}} through Intl.NumberFormat per locale", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("activity.recordedCount", { count: 12345 })).toBe("12,345 recorded");
    await i18n.changeLanguage("tr");
    expect(i18n.t("activity.recordedCount", { count: 12345 })).toBe("12.345 kayıt");
  });
});

describe("applyLanguage / currentLocale", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("switches i18next's active language and reports it back", () => {
    expect(applyLanguage("tr")).toBe("tr");
    expect(currentLocale()).toBe("tr");
    expect(applyLanguage("en")).toBe("en");
    expect(currentLocale()).toBe("en");
  });
});
