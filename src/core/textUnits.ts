/**
 * Sentence and paragraph boundaries, for "auto-code by pattern": expanding a
 * search match to the sentence or paragraph that contains it. Offsets here
 * are UTF-16 code units (DOM/JS string space), matching `segmentation.ts`;
 * convert to code points only through `offsets.ts`, per the project's
 * offset convention.
 */

export interface Span {
  start: number;
  end: number;
}

function trimSpan(text: string, start: number, end: number): Span {
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return { start, end };
}

/** The paragraph ("\n"-delimited line) containing `at`, trimmed of leading/trailing whitespace. */
export function paragraphAt(text: string, at: number): Span {
  const clamped = Math.max(0, Math.min(at, text.length));
  let start = text.lastIndexOf("\n", Math.max(0, clamped - 1));
  start = start === -1 ? 0 : start + 1;
  let end = text.indexOf("\n", clamped);
  if (end === -1) end = text.length;
  return trimSpan(text, start, Math.max(start, end));
}

/**
 * A conservative sentence boundary: `.`, `!` or `?` (optionally followed by a
 * closing quote/bracket) then whitespace or the end of the text. It does not
 * special-case abbreviations like "Dr." — good enough to expand a match to
 * "roughly the sentence it's in" for bulk coding, never to cross a paragraph.
 */
const SENTENCE_END = /[.!?]["'’)\]]?(?:\s|$)/g;

/** The sentence containing `at`, never crossing its paragraph's bounds. */
export function sentenceAt(text: string, at: number): Span {
  const para = paragraphAt(text, at);
  const clamped = Math.max(para.start, Math.min(at, para.end));

  let start = para.start;
  SENTENCE_END.lastIndex = para.start;
  for (let m = SENTENCE_END.exec(text); m && m.index < para.end; m = SENTENCE_END.exec(text)) {
    const boundary = m.index + m[0].length;
    if (boundary > clamped) break;
    start = Math.min(boundary, para.end);
  }

  let end = para.end;
  SENTENCE_END.lastIndex = clamped;
  const next = SENTENCE_END.exec(text);
  if (next && next.index < para.end) end = next.index + next[0].length;

  return trimSpan(text, start, Math.max(start, Math.min(end, para.end)));
}
