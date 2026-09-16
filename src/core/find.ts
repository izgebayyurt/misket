/**
 * "Find in document": case-insensitive substring search over the text
 * already loaded for a document. Returns UTF-16 offsets (end-exclusive),
 * matching the DOM contract in `src/core/selection.ts`.
 */

export interface FindMatch {
  start: number;
  end: number;
}

/**
 * Find every non-overlapping occurrence of `query` in `text`.
 *
 * When lower-casing neither string changes its length (true for plain ASCII
 * and the vast majority of real-world text), a fast `indexOf` scan over the
 * lower-cased strings is exact, because UTF-16 offsets in the lower-cased
 * string line up 1:1 with offsets in the original. Some case foldings do
 * change length (e.g. Turkish `İ`.toLowerCase() gains a combining mark), so
 * when either string's length changes we fall back to a code-point-by-code-
 * point comparison that never assumes such an alignment.
 */
export function findMatches(text: string, query: string): FindMatch[] {
  const q = query.trim();
  if (!q || !text) return [];
  const textLower = text.toLowerCase();
  const queryLower = q.toLowerCase();
  if (textLower.length === text.length && queryLower.length === q.length) {
    return findFast(textLower, queryLower);
  }
  return findCodePointSafe(text, q);
}

function findFast(textLower: string, queryLower: string): FindMatch[] {
  const matches: FindMatch[] = [];
  let from = 0;
  for (;;) {
    const idx = textLower.indexOf(queryLower, from);
    if (idx === -1) break;
    matches.push({ start: idx, end: idx + queryLower.length });
    from = idx + queryLower.length;
  }
  return matches;
}

interface CodePoint {
  /** The code point itself, lower-cased on its own. */
  lower: string;
  /** UTF-16 offset of this code point's first code unit. */
  u16: number;
  /** Number of UTF-16 code units this code point occupies (1 or 2). */
  width: number;
}

function codePoints(s: string): CodePoint[] {
  const out: CodePoint[] = [];
  let u16 = 0;
  for (const ch of s) {
    // `for...of` on a string iterates by code point (surrogate pairs kept whole).
    out.push({ lower: ch.toLowerCase(), u16, width: ch.length });
    u16 += ch.length;
  }
  return out;
}

function findCodePointSafe(text: string, query: string): FindMatch[] {
  const haystack = codePoints(text);
  const needle = codePoints(query).map((c) => c.lower);
  const matches: FindMatch[] = [];
  if (needle.length === 0) return matches;
  let i = 0;
  while (i <= haystack.length - needle.length) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j]!.lower !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      const first = haystack[i]!;
      const last = haystack[i + needle.length - 1]!;
      matches.push({ start: first.u16, end: last.u16 + last.width });
      i += needle.length;
    } else {
      i++;
    }
  }
  return matches;
}

/** Index of the first match at or after `from` (UTF-16), or 0 if none qualifies. */
export function matchIndexAtOrAfter(matches: FindMatch[], from: number): number {
  for (let i = 0; i < matches.length; i++) {
    if (matches[i]!.start >= from) return i;
  }
  return 0;
}
