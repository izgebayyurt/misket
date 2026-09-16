/**
 * "Find in document": case-insensitive substring search over the text
 * already loaded for a document. Returns UTF-16 offsets (end-exclusive),
 * matching the DOM contract in `src/core/selection.ts`.
 */

import { stem } from "./stem";

export interface FindMatch {
  start: number;
  end: number;
}

export interface FindOptions {
  /** Match whole words by stem (see `src/core/stem.ts`) instead of a
   * literal substring — "Match word forms". */
  stem?: boolean;
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
 *
 * With `options.stem`, matching is by whole word instead: `query` is
 * tokenized into words, each reduced to a stem, and a match is a contiguous
 * run of the text's words whose stems match, in order.
 */
export function findMatches(text: string, query: string, options?: FindOptions): FindMatch[] {
  const q = query.trim();
  if (!q || !text) return [];
  if (options?.stem) {
    return findStemmedMatches(text, q);
  }
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

/** A word run's own text and its UTF-16 offsets in the source string. */
interface Token {
  text: string;
  start: number;
  end: number;
}

// Unicode letters and numbers — the same "word character" definition
// `crates/misket-core/src/text/mod.rs::tokenize` uses via `char::is_alphanumeric`.
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Tokenize into words: maximal runs of Unicode letters/numbers and
 * apostrophes, with leading/trailing apostrophes trimmed, each carrying its
 * UTF-16 start/end offset in `text`. Iterates by code point (surrogate
 * pairs kept whole) so offsets stay correct across astral characters.
 */
function tokenizeWithOffsets(text: string): Token[] {
  const out: Token[] = [];
  let current = "";
  let start = 0;
  let u16 = 0;
  for (const ch of text) {
    if (WORD_CHAR.test(ch) || ch === "'") {
      if (current === "") start = u16;
      current += ch;
    } else if (current !== "") {
      pushToken(out, current, start);
      current = "";
    }
    u16 += ch.length;
  }
  if (current !== "") pushToken(out, current, start);
  return out;
}

function pushToken(out: Token[], raw: string, start: number) {
  let s = 0;
  let e = raw.length;
  while (s < e && raw[s] === "'") s++;
  while (e > s && raw[e - 1] === "'") e--;
  const trimmed = raw.slice(s, e);
  if (trimmed) out.push({ text: trimmed.toLowerCase(), start: start + s, end: start + e });
}

function findStemmedMatches(text: string, query: string): FindMatch[] {
  const queryStems = tokenizeWithOffsets(query).map((t) => stem(t.text));
  if (queryStems.length === 0) return [];
  const docTokens = tokenizeWithOffsets(text);
  const docStems = docTokens.map((t) => stem(t.text));
  const n = queryStems.length;
  const matches: FindMatch[] = [];
  for (let i = 0; i + n <= docStems.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (docStems[i + j] !== queryStems[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      matches.push({ start: docTokens[i]!.start, end: docTokens[i + n - 1]!.end });
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
