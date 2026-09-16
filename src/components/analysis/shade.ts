/** Shading for matrix cells, shared by the co-occurrence and document matrices. */

import type { CSSProperties } from "react";

/**
 * Cell shading: the accent colour at an opacity proportional to the count.
 * `color-mix` against `transparent` keeps it readable in both themes.
 */
export function shade(count: number, max: number): CSSProperties {
  if (count <= 0 || max <= 0) return {};
  // Square root so a few large cells do not flatten everything else.
  const t = Math.sqrt(count / max);
  const pct = Math.round(10 + 62 * t);
  return { backgroundColor: `color-mix(in srgb, var(--accent) ${pct}%, transparent)` };
}
