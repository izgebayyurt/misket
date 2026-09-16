/**
 * Speaker turns in the document view: keeping coding to the spoken text.
 *
 * A transcript's speaker labels are part of the stored document text —
 * document text is immutable and excerpt offsets are code points into it — so
 * the view only *lays them out* elsewhere (an absolutely positioned gutter).
 * That means a drag can still start inside a label, and "select all" still
 * covers them. This module trims those edges back to what was actually said.
 *
 * Offsets here are code points (what `Turn` carries and what excerpts store),
 * not UTF-16, so callers convert first.
 */

/** The part of a `Turn` this module needs; the API type is a superset. */
export interface TurnRange {
  /** Where the label begins, always the start of its line. */
  labelStart: number;
  /** One past the label, where the spoken text begins. */
  labelEnd: number;
  /** The spoken text, trailing whitespace already trimmed. */
  start: number;
  end: number;
}

export interface Range {
  start: number;
  end: number;
}

function labelAt(turns: TurnRange[], pos: number): number {
  return turns.findIndex((t) => t.labelStart <= pos && pos < t.labelEnd);
}

/**
 * Trim the parts of `range` that lie inside a speaker label.
 *
 * A selection that starts in turn N's label starts at what N said; one whose
 * last character is inside a label ends where the previous turn stopped
 * talking (or at that label, when there is no previous turn). Labels in the
 * *middle* of a multi-turn selection stay: an excerpt is one contiguous range,
 * and the passage really does run across them.
 *
 * Returns `null` when nothing spoken is left — selecting a bare label codes
 * nothing.
 */
export function clipToSpokenText(range: Range, turns: TurnRange[]): Range | null {
  if (turns.length === 0) return range.end > range.start ? range : null;
  let { start, end } = range;

  const startsIn = labelAt(turns, start);
  if (startsIn !== -1) start = turns[startsIn]!.start;

  // `end` is exclusive, so it is the character before it that must be spoken.
  const endsIn = labelAt(turns, end - 1);
  if (endsIn !== -1) {
    const previous = turns[endsIn - 1];
    end = previous ? previous.end : turns[endsIn]!.labelStart;
  }

  return end > start ? { start, end } : null;
}

/**
 * Where a turn's label should be cut so the speaker and the timestamp become
 * two segments — the two lines of the gutter.
 *
 * The cut goes between them, whichever way round the format writes them:
 * `Alice ` / `(00:12): ` for `Name (00:12):`, `[00:12:03] ` / `Alice: ` for
 * `[00:12:03] Name:`. Returns `null` when the label carries no timestamp, or
 * when neither part can be found in it (a custom pattern that rewrites what it
 * captures); the view then renders the label whole and falls back to
 * `data-time`, which is a CSS pseudo-element and not a DOM text node.
 *
 * `text` is the whole document and the offsets are UTF-16, because this runs
 * in DOM space with the rest of the rendering.
 */
export function labelCut(
  text: string,
  label: { start: number; end: number; speaker: string; time?: string | null },
): number | null {
  if (!label.time) return null;
  const raw = text.slice(label.start, label.end);
  const timeAt = raw.indexOf(label.time);
  const speakerAt = raw.indexOf(label.speaker);
  if (timeAt === -1 || speakerAt === -1) return null;
  let cut: number;
  if (timeAt > speakerAt) {
    // Name first: cut just after it, taking the space with the name so the
    // second line starts at the timestamp's own punctuation.
    cut = label.start + speakerAt + label.speaker.length;
    while (cut < label.end && text[cut] === " ") cut++;
  } else {
    cut = label.start + speakerAt;
  }
  return cut > label.start && cut < label.end ? cut : null;
}
