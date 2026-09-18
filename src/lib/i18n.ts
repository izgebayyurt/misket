/**
 * `i18next` setup. This is the one place in the app that imports the locale
 * JSON resources and the `react-i18next` init plugin; everywhere else reads
 * strings through `useTranslation()`. `src/core` never imports this module
 * (see CLAUDE.md) — it deals in language *codes*, not in `i18next` itself.
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en/common.json";
import tr from "@/locales/tr/common.json";
import { resolveLocale, type SupportedLocale } from "@/core/locale";
import type { Language } from "@/api/types";

export const defaultNS = "common";

void i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  defaultNS,
  ns: [defaultNS],
  resources: {
    en: { common: en },
    tr: { common: tr },
  },
  // `{{count, number}}` (and `{{n, number}}`, …) formats through
  // `Intl.NumberFormat` in the active locale via i18next's built-in
  // formatter — thousands separators in analysis tables and counts like
  // `activity.recordedCount` follow the locale automatically instead of
  // hardcoding "," or ".".
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** The system locale as the browser reports it (`navigator.language`, or `"en"` outside a browser). */
export function systemLocale(): string {
  return typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";
}

/** Resolve `AppSettings.language` against the system locale and switch `i18next` to it. */
export function applyLanguage(setting: Language): SupportedLocale {
  const locale = resolveLocale(setting, systemLocale());
  if (i18next.language !== locale) void i18next.changeLanguage(locale);
  return locale;
}

/** The locale `i18next` is currently rendering with. */
export function currentLocale(): SupportedLocale {
  return i18next.language === "tr" ? "tr" : "en";
}

export default i18next;
