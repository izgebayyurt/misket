/**
 * Split a paragraph into segments at excerpt boundaries. Each segment knows
 * which excerpts cover it and which code colors to draw as underline lanes.
 * All offsets here are UTF-16 code units (DOM space).
 */
export interface RenderableExcerpt {
  id: string;
  start: number;
  end: number;
  codeIds: string[];
}

export interface Segment {
  start: number;
  end: number;
  excerptIds: string[];
  /** Distinct code ids covering this segment, in first-seen order. */
  codeIds: string[];
}

export const MAX_LANES = 4;

/**
 * `cuts` are extra boundaries the caller wants segments to break at, whether
 * or not an excerpt does — the document view passes the ends of a turn's
 * speaker label, so the label is a segment (or two) of its own and can be
 * lifted into the gutter. Cuts outside the paragraph are ignored, and the
 * invariant holds either way: the segments' text, concatenated, is the
 * paragraph's text.
 */
export function segmentParagraph(
  paraStart: number,
  paraEnd: number,
  excerpts: RenderableExcerpt[],
  cuts: number[] = [],
): Segment[] {
  if (paraEnd < paraStart) return [];
  if (paraEnd === paraStart)
    return [{ start: paraStart, end: paraEnd, excerptIds: [], codeIds: [] }];
  const covering = excerpts.filter(
    (e) => e.start < paraEnd && e.end > paraStart && e.end > e.start,
  );
  if (covering.length === 0 && cuts.length === 0)
    return [{ start: paraStart, end: paraEnd, excerptIds: [], codeIds: [] }];

  const bounds = new Set<number>([paraStart, paraEnd]);
  for (const e of covering) {
    if (e.start > paraStart && e.start < paraEnd) bounds.add(e.start);
    if (e.end > paraStart && e.end < paraEnd) bounds.add(e.end);
  }
  for (const c of cuts) if (c > paraStart && c < paraEnd) bounds.add(c);
  const points = [...bounds].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    const here = covering.filter((e) => e.start <= start && e.end >= end);
    const codeIds: string[] = [];
    for (const e of here) for (const c of e.codeIds) if (!codeIds.includes(c)) codeIds.push(c);
    out.push({ start, end, excerptIds: here.map((e) => e.id), codeIds });
  }
  return out;
}

/** Split text into paragraphs on "\n", remembering each paragraph's UTF-16 start. */
export function splitParagraphs(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  let start = 0;
  for (const p of text.split("\n")) {
    out.push({ start, end: start + p.length, text: p });
    start += p.length + 1;
  }
  return out;
}
