/**
 * Pure formatting for the history view's detail panel: turning one step's
 * stored `detail` payload into a small key-value list a person can read.
 *
 * The payloads are written by the domain functions in `db::*`, one shape per
 * kind, so nothing here knows their schemas. It only knows the conventions
 * they all follow: camelCase keys, and a changed field written as
 * `{ from, to }` (`activity::change`).
 */

/** One row of the panel's key-value list. */
export interface DetailField {
  key: string;
  /** `startPos` → `Start pos`, `codeIds` → `Code ids`. */
  label: string;
  /** Already formatted for display, including `old → new` for a change. */
  value: string;
}

/**
 * Keys the panel shows in its own way — as a resolved reference, a snippet or
 * a chip — and so leaves out of the key-value list.
 */
export const RESOLVED_KEYS = new Set([
  "codeIds",
  "codeNames",
  "documentId",
  "documentName",
  "excerptId",
  "memoId",
  "codeId",
  "codeName",
  "targetId",
  "targetName",
  "sourceId",
  "sourceName",
  "snapshot",
  "geometry",
]);

/** `startPos` → `Start pos`; `code_ids` → `Code ids`. */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_.]/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** How long a single value may read before it is cut short. */
const MAX_VALUE = 400;

function elide(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > MAX_VALUE ? `${flat.slice(0, MAX_VALUE)}…` : flat;
}

/** One value, flattened to a line. `null` when there is nothing to show. */
export function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString() : null;
  if (typeof value === "string") return value.trim() === "" ? null : elide(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const parts = value.map((v) => formatValue(v)).filter((v): v is string => v !== null);
    return parts.length === 0 ? null : elide(parts.join(", "));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // A changed field, as `activity::change` writes it.
    if ("from" in obj || "to" in obj) {
      const from = formatValue(obj.from) ?? "(none)";
      const to = formatValue(obj.to) ?? "(none)";
      return `${from} → ${to}`;
    }
    const parts = Object.entries(obj)
      .map(([k, v]) => {
        const formatted = formatValue(v);
        return formatted === null ? null : `${humanizeKey(k)}: ${formatted}`;
      })
      .filter((v): v is string => v !== null);
    return parts.length === 0 ? null : elide(parts.join("; "));
  }
  return null;
}

/**
 * The detail payload as a list of readable fields, in the order the payload
 * wrote them, skipping what the panel shows in its own way and anything that
 * has nothing to say.
 */
export function detailFields(
  detail: Record<string, unknown> | null | undefined,
  skip: ReadonlySet<string> = RESOLVED_KEYS,
): DetailField[] {
  if (!detail) return [];
  const out: DetailField[] = [];
  for (const [key, raw] of Object.entries(detail)) {
    if (skip.has(key)) continue;
    const value = formatValue(raw);
    if (value === null) continue;
    out.push({ key, label: humanizeKey(key), value });
  }
  return out;
}
