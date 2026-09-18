/**
 * How much of a document goes with a passage.
 *
 * A passage on its own often reads as nothing: "that was the worst part" needs
 * the sentence before it. One paragraph either side is the compromise the
 * feature is documented as making — enough to disambiguate, little enough
 * that a person can predict what leaves the machine from the passage they
 * selected.
 */

/** The most of one neighbouring paragraph that is ever taken. */
export const MAX_CONTEXT = 1000;

/**
 * The paragraph before `start` and the paragraph after `end`, each capped.
 *
 * Paragraphs are blank-line separated, which is how Misket's importers write
 * them. When the text has no blank lines at all, this falls back to a plain
 * window of the same size, because some length of context beats none.
 * Offsets are code points, as everywhere else in Misket.
 */
export function paragraphContext(
  text: string,
  start: number,
  end: number,
  max: number = MAX_CONTEXT,
): { before: string; after: string } {
  const chars = Array.from(text);
  const clamp = (n: number) => Math.min(Math.max(n, 0), chars.length);
  const from = clamp(start);
  const to = clamp(end);
  // The blank line that ends the previous paragraph sits between it and the
  // passage, so it is trimmed off before looking for the one before that.
  const head = chars
    .slice(Math.max(0, from - max * 2), from)
    .join("")
    .replace(/\s+$/, "");
  const tail = chars
    .slice(to, to + max * 2)
    .join("")
    .replace(/^\s+/, "");

  // Everything after the last blank line before the passage, and everything
  // up to the first blank line after it.
  const breakBefore = head.lastIndexOf("\n\n");
  const before = breakBefore === -1 ? head : head.slice(breakBefore + 2);
  const breakAfter = tail.indexOf("\n\n");
  const after = breakAfter === -1 ? tail : tail.slice(0, breakAfter);

  const beforeChars = Array.from(before);
  const afterChars = Array.from(after);
  return {
    before: beforeChars
      .slice(Math.max(0, beforeChars.length - max))
      .join("")
      .trim(),
    after: afterChars.slice(0, max).join("").trim(),
  };
}
