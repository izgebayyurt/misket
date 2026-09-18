/**
 * Lining a transcript up with the recording it was typed from.
 *
 * The mirror of `crates/misket-core/src/text/align.rs`, and deliberately so:
 * the backend owns the alignment when it writes (coding the recording for a
 * passage, validating an anchor), and the view needs the same answer several
 * times a second while the recording plays — once per `timeupdate`, for the
 * paragraph highlight and the faint band under a coded stretch. An IPC round
 * trip per frame is not that. The two implementations are small, tested on
 * both sides, and the rules they encode are written out once in
 * `docs/DATA_MODEL.md`.
 *
 * Offsets are code points into the document text, the same space excerpts
 * use; times are milliseconds into the recording.
 */

/** One point where the text and the recording are known to meet. */
export interface Anchor {
  /** Code point offset into the document text. */
  pos: number;
  /** Milliseconds into the recording. */
  ms: number;
}

/**
 * Sort by position, drop duplicates and anything before the text, and clamp
 * times so they never run backwards — so the mapping is monotone and
 * `msToPos` has exactly one answer.
 */
export function prepare(anchors: readonly Anchor[]): Anchor[] {
  const out = anchors
    .filter((a) => Number.isFinite(a.pos) && Number.isFinite(a.ms) && a.pos >= 0 && a.ms >= 0)
    .map((a) => ({ pos: Math.round(a.pos), ms: Math.round(a.ms) }))
    .sort((a, b) => a.pos - b.pos);
  const kept: Anchor[] = [];
  let floor = 0;
  for (const a of out) {
    if (kept.length && kept[kept.length - 1]!.pos === a.pos) continue;
    floor = Math.max(floor, a.ms);
    kept.push({ pos: a.pos, ms: floor });
  }
  return kept;
}

/** Milliseconds per code point past the last anchor. */
function tailRate(prepared: readonly Anchor[]): number {
  const last = prepared[prepared.length - 1];
  return last && last.pos > 0 ? last.ms / last.pos : 0;
}

/**
 * Where in the recording the text at `pos` is heard.
 *
 * Linear between anchors; before the first one the recording is assumed to
 * start at 0 ms; past the last one it carries on at the document's average
 * rate. With no anchors at all, everything is at 0 ms.
 */
export function posToMs(anchors: readonly Anchor[], pos: number): number {
  const a = prepare(anchors);
  const at = Math.max(0, pos);
  if (a.length === 0) return 0;
  let prev: Anchor = { pos: 0, ms: 0 };
  for (const next of a) {
    if (at <= next.pos) {
      const span = next.pos - prev.pos;
      if (span <= 0) return next.ms;
      return prev.ms + Math.round(((at - prev.pos) / span) * (next.ms - prev.ms));
    }
    prev = next;
  }
  return prev.ms + Math.round((at - prev.pos) * tailRate(a));
}

/**
 * Where in the text the recording is at `ms`.
 *
 * Across a flat stretch (a pause: two anchors at the same millisecond) it
 * answers with the start of that stretch, so the playhead highlights the
 * passage about to be read rather than the one just finished.
 */
export function msToPos(anchors: readonly Anchor[], ms: number): number {
  const a = prepare(anchors);
  const at = Math.max(0, ms);
  if (a.length === 0) return 0;
  let prev: Anchor = { pos: 0, ms: 0 };
  for (const next of a) {
    if (at <= next.ms) {
      const span = next.ms - prev.ms;
      if (span <= 0) return prev.pos;
      return prev.pos + Math.round(((at - prev.ms) / span) * (next.pos - prev.pos));
    }
    prev = next;
  }
  const rate = tailRate(a);
  if (rate <= 0) return prev.pos;
  return prev.pos + Math.round((at - prev.ms) / rate);
}

/**
 * Parse a transcript or subtitle timestamp into milliseconds: `mm:ss`,
 * `h:mm:ss`, with an optional `.mmm` or `,mmm` fraction, optionally wrapped
 * in `[…]`, `(…)` or `<…>`. `null` for anything that is not a clock.
 */
export function parseTimeMs(raw: string): number | null {
  let t = raw.trim();
  const wrapped = /^\[(.*)\]$|^\((.*)\)$|^<(.*)>$/.exec(t);
  if (wrapped) t = (wrapped[1] ?? wrapped[2] ?? wrapped[3] ?? "").trim();
  if (!t) return null;
  const m = /^(\d+)(?::(\d{2}))(?::(\d{2}))?(?:[.,](\d+))?$/.exec(t);
  if (!m) return null;
  const fields = [m[1]!, m[2]!, ...(m[3] ? [m[3]] : [])].map(Number);
  // Only the leading field may run past 59 (a 100-minute tape).
  if (fields.slice(1).some((v) => v > 59)) return null;
  const seconds = fields.reduce((acc, v) => acc * 60 + v, 0);
  const fraction = m[4] ? Number((m[4] + "00").slice(0, 3)) : 0;
  return seconds * 1000 + fraction;
}
