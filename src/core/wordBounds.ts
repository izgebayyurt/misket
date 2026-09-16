/**
 * Word and character boundaries in Unicode code point offsets, for nudging an
 * excerpt's start or end edge from the keyboard.
 *
 * Offsets are code points (what the database stores), end-exclusive, so these
 * results can be handed to `update_excerpt_range` unchanged. The text is an
 * ordinary JavaScript (UTF-16) string, so the scan walks code points and
 * never splits a surrogate pair: one emoji is one step.
 */

/** `1` moves towards the end of the text, `-1` towards the start. */
export type Direction = 1 | -1;

export type Granularity = "word" | "char";

/**
 * Three classes are enough to behave like every editor's "move by word":
 * letters/digits/marks stick together, runs of punctuation and symbols stick
 * together, and whitespace is skipped before a word rather than stopped in.
 * `\p{L}` covers CJK, so 漢字 is one word; an emoji is `\p{S}`, so a run of
 * emoji is one "punctuation" step.
 */
type CharClass = "space" | "word" | "other";

const SPACE = /\s/u;
const WORD = /[\p{L}\p{N}\p{M}_]/u;

function classify(cp: string): CharClass {
  if (SPACE.test(cp)) return "space";
  return WORD.test(cp) ? "word" : "other";
}

/** UTF-16 width of the code point starting at `i`. */
function forwardWidth(text: string, i: number): number {
  const c = text.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
    const d = text.charCodeAt(i + 1);
    if (d >= 0xdc00 && d <= 0xdfff) return 2;
  }
  return 1;
}

/** UTF-16 width of the code point ending just before `i`. */
function backwardWidth(text: string, i: number): number {
  const c = text.charCodeAt(i - 1);
  if (c >= 0xdc00 && c <= 0xdfff && i - 2 >= 0) {
    const d = text.charCodeAt(i - 2);
    if (d >= 0xd800 && d <= 0xdbff) return 2;
  }
  return 1;
}

function classAt(text: string, i: number): CharClass {
  return classify(text.slice(i, i + forwardWidth(text, i)));
}

function classBefore(text: string, i: number): CharClass {
  return classify(text.slice(i - backwardWidth(text, i), i));
}

/**
 * UTF-16 index of code point `cp`, plus the code point actually reached
 * (clamped to the text), so callers can start from an out-of-range offset.
 */
function locate(text: string, cp: number): { index: number; cp: number } {
  if (cp <= 0) return { index: 0, cp: 0 };
  let index = 0;
  let n = 0;
  while (index < text.length && n < cp) {
    index += forwardWidth(text, index);
    n++;
  }
  return { index, cp: n };
}

/**
 * The next word boundary from code point offset `cp` in direction `dir`.
 *
 * Whitespace between `cp` and the next word is skipped, then the whole run of
 * same-class code points is crossed, so repeated calls walk word by word.
 * Returns `cp` clamped to the text when there is no further boundary.
 */
export function nextWordBoundary(text: string, cp: number, dir: Direction): number {
  const from = locate(text, cp);
  let i = from.index;
  let n = from.cp;
  if (dir === 1) {
    while (i < text.length && classAt(text, i) === "space") {
      i += forwardWidth(text, i);
      n++;
    }
    if (i >= text.length) return n;
    const run = classAt(text, i);
    while (i < text.length && classAt(text, i) === run) {
      i += forwardWidth(text, i);
      n++;
    }
    return n;
  }
  while (i > 0 && classBefore(text, i) === "space") {
    i -= backwardWidth(text, i);
    n--;
  }
  if (i <= 0) return n;
  const run = classBefore(text, i);
  while (i > 0 && classBefore(text, i) === run) {
    i -= backwardWidth(text, i);
    n--;
  }
  return n;
}

/** One code point further along, clamped to the text. Emoji count as one. */
export function nextCharBoundary(text: string, cp: number, dir: Direction): number {
  const from = locate(text, cp);
  if (dir === 1) return from.index >= text.length ? from.cp : from.cp + 1;
  return from.index <= 0 ? from.cp : from.cp - 1;
}

/** `nextWordBoundary` or `nextCharBoundary`, chosen by `granularity`. */
export function nextBoundary(
  text: string,
  cp: number,
  dir: Direction,
  granularity: Granularity,
): number {
  return granularity === "word" ? nextWordBoundary(text, cp, dir) : nextCharBoundary(text, cp, dir);
}
