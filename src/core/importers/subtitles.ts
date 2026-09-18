/**
 * What SRT and VTT parsing have in common.
 *
 * Both formats are a list of cues: a time range and some lines of text. Both
 * become the same thing in Misket — a plain text document, one paragraph per
 * cue, opening with the cue's start time so the ordinary transcript detection
 * (`crates/misket-core/src/text/transcript.rs`) reads it as a timestamped
 * transcript — plus one alignment anchor per cue, so the document is lined up
 * with its recording the moment the two are linked.
 *
 * Document text is immutable once imported, so the shape below is the shape
 * forever; it is deliberately the plainest thing a coder would have typed:
 *
 * ```
 * [0:04] Alice: I had been there before.
 * [0:09] Bob: How long before?
 * [0:12] Nothing was said for a while.
 * ```
 *
 * A cue with a voice tag (`<v Alice>` in VTT, and the same tag where an SRT
 * has picked it up) gets the `Speaker:` form, which the `[00:12] Name:`
 * preset recognises; a cue without one keeps just its timestamp.
 */

import type { Anchor } from "../align";

/** One parsed cue, before it becomes a paragraph. */
export interface Cue {
  startMs: number;
  endMs: number;
  /** The voice tag's name, when the cue carried one. */
  speaker: string | null;
  /** The cue's lines, joined with a space; never empty. */
  text: string;
}

/** A subtitle file turned into a document: text plus the cue anchors. */
export interface ParsedSubtitles {
  text: string;
  anchors: Anchor[];
  /** How many cues made it in — what the import toast counts. */
  cueCount: number;
}

/** `00:01:02,500 --> 00:01:05,000`, in either format's punctuation. */
const TIMING = /^\s*(\S+)\s*-->\s*(\S+)/;

/** `<v Alice>`, `<v.loud Alice>`, and the `<v Alice>` some SRT writers emit. */
const VOICE = /^\s*<v(?:\.[^\s>]*)*\s+([^>]*)>\s*/i;

/**
 * Parse one `hh:mm:ss,mmm` / `mm:ss.mmm` cue time. Stricter than the
 * transcript-label parser in `core/align.ts`: a cue time is machine-written
 * and always has a fraction, and accepting less would let a stray line of
 * dialogue pass for a timing line.
 */
export function parseCueTime(raw: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(raw.trim());
  if (!m) return null;
  const hours = m[1] ? Number(m[1]) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  if (minutes > 59 || seconds > 59) return null;
  const millis = Number((m[4]! + "00").slice(0, 3));
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

/** Strip the markup a cue may carry: `<i>`, `<c.yellow>`, `{\an8}`, `&amp;`. */
export function stripCueMarkup(line: string): string {
  return line
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a subtitle file into blocks separated by blank lines, with the
 * line endings and BOM already dealt with.
 */
export function blocksOf(source: string): string[][] {
  const lines = source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/**
 * Turn one block into a cue, or `null` when it is not one: a WEBVTT header, a
 * `NOTE`/`STYLE`/`REGION` block, a cue whose timing line will not parse, or a
 * cue with a timing line and nothing under it. Skipping rather than failing is
 * the point — a subtitle file with one broken cue still imports.
 */
export function cueOf(block: string[]): Cue | null {
  // An SRT cue opens with its number; a VTT cue may open with an id.
  let i = 0;
  let timing: RegExpExecArray | null = null;
  for (; i < block.length; i++) {
    const m = TIMING.exec(block[i]!);
    if (m && parseCueTime(m[1]!) !== null) {
      timing = m;
      break;
    }
    // Only one line of preamble (the number or id) is allowed before the
    // timing, so a paragraph of prose is never read as a cue.
    if (i >= 1) return null;
  }
  if (!timing) return null;
  const startMs = parseCueTime(timing[1]!);
  const endMs = parseCueTime(timing[2]!);
  if (startMs === null || endMs === null || endMs < startMs) return null;

  const body = block.slice(i + 1);
  if (body.length === 0) return null;
  let speaker: string | null = null;
  const parts: string[] = [];
  for (const [n, line] of body.entries()) {
    let rest = line;
    if (n === 0) {
      const voice = VOICE.exec(rest);
      if (voice) {
        const name = stripCueMarkup(voice[1]!);
        // A speaker label is short, like every other one Misket believes in.
        if (name && name.length <= 40) speaker = name;
        rest = rest.slice(voice[0].length);
      }
    }
    const clean = stripCueMarkup(rest);
    if (clean) parts.push(clean);
  }
  const text = parts.join(" ").trim();
  if (!text) return null;
  return { startMs, endMs, speaker, text };
}

/**
 * `mm:ss` under an hour, `h:mm:ss` from an hour on — the two shapes the
 * `[00:12] Name:` transcript preset reads.
 */
export function cueTimecode(ms: number): string {
  // Truncated, not rounded: a cue at 12.5 s is in second 12.
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

/**
 * Lay the cues out as a document and record where each paragraph starts.
 *
 * The anchor for a cue is its paragraph's first code point — the `[` of the
 * timestamp — because that is where the cue's text begins on the page, label
 * and all. Offsets are counted in code points, and the text is NFC-normalized
 * here, so they are the offsets the backend will store (`db::text::normalize`
 * does the same, and normalizing twice changes nothing).
 */
export function layOutCues(cues: Cue[]): ParsedSubtitles {
  const paragraphs: string[] = [];
  const anchors: Anchor[] = [];
  let pos = 0;
  for (const cue of cues) {
    const label = cue.speaker
      ? `[${cueTimecode(cue.startMs)}] ${cue.speaker}: `
      : `[${cueTimecode(cue.startMs)}] `;
    const paragraph = (label + cue.text).normalize("NFC");
    anchors.push({ pos, ms: cue.startMs });
    paragraphs.push(paragraph);
    // +1 for the newline that follows every paragraph.
    pos += [...paragraph].length + 1;
  }
  return {
    text: paragraphs.length ? paragraphs.join("\n") + "\n" : "",
    anchors,
    cueCount: cues.length,
  };
}

/** Parse a subtitle file (SRT or VTT — the block shapes are the same). */
export function parseSubtitles(source: string): ParsedSubtitles {
  const cues: Cue[] = [];
  for (const block of blocksOf(source)) {
    const cue = cueOf(block);
    if (cue) cues.push(cue);
  }
  cues.sort((a, b) => a.startMs - b.startMs);
  return layOutCues(cues);
}
