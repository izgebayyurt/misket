/** Language resolution: pure, no `react-i18next` import (see CLAUDE.md — `src/core` stays framework-free). */

import type { Language } from "@/api/types";

/** The languages Misket actually ships resources for. */
export type SupportedLocale = "en" | "tr";

export const SUPPORTED_LOCALES: SupportedLocale[] = ["en", "tr"];

/**
 * Resolve the `AppSettings.language` setting to one of the locales we ship.
 * `"system"` reads the browser/OS locale (`navigator.language`, passed in so
 * this stays pure and testable); anything not in {@link SUPPORTED_LOCALES}
 * falls back to English.
 */
export function resolveLocale(setting: Language, systemLocale: string): SupportedLocale {
  const wanted = setting === "system" ? systemLocale : setting;
  const lower = wanted.toLowerCase();
  const match = SUPPORTED_LOCALES.find((l) => lower === l || lower.startsWith(`${l}-`));
  return match ?? "en";
}

/** BCP 47 tag `Intl` should format with for a resolved locale. */
export function intlTag(locale: SupportedLocale): string {
  return locale === "tr" ? "tr-TR" : "en-US";
}
