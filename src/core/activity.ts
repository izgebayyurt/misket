/**
 * Pure helpers for the activity log: how a stored `kind` reads on screen, and
 * how a timestamp reads next to it.
 */

/** `code.merged_into` → `Code merged into`; `undo` → `Undo`. */
export function kindLabel(kind: string): string {
  const words = kind.replace(/[._]/g, " ").trim();
  if (!words) return kind;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The part before the dot (`code`, `excerpt`, `bulk`, …), for grouping. */
export function kindGroup(kind: string): string {
  const dot = kind.indexOf(".");
  return dot === -1 ? kind : kind.slice(0, dot);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A short, calm relative time — "5 minutes ago", "in 2 hours" — through
 * `Intl.RelativeTimeFormat` so it reads correctly in every locale we ship
 * (see `src/core/locale.ts` for the locale tag). Falls back to a plain
 * localized date once it is over a month old. Unparseable input reads as an
 * em dash, the one piece of this that has no words to translate.
 */
export function relativeTime(iso: string, now: number = Date.now(), locale = "en"): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "–";
  const diff = now - then;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diff < MINUTE) return rtf.format(0, "second");
  if (diff < HOUR) return rtf.format(-Math.round(diff / MINUTE), "minute");
  if (diff < DAY) return rtf.format(-Math.round(diff / HOUR), "hour");
  const days = Math.round(diff / DAY);
  if (days < 30) return rtf.format(-days, "day");
  return new Intl.DateTimeFormat(locale).format(new Date(iso));
}

/** The full timestamp, for a `title` tooltip. */
export function absoluteTime(iso: string, locale = "en"): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime())
    ? iso
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(t);
}
