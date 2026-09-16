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
 * A short, calm relative time: `just now`, `12m ago`, `5h ago`, `3d ago`, and
 * a plain date once it is over a month old. Unparseable input reads as `–`.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "–";
  const diff = now - then;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.round(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`;
  const days = Math.round(diff / DAY);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** The full timestamp, for a `title` tooltip. */
export function absoluteTime(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toLocaleString();
}
