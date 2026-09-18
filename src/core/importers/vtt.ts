/**
 * WebVTT (`.vtt`) subtitles as a transcript document.
 *
 * A VTT file opens with a `WEBVTT` line and may carry `NOTE`, `STYLE` and
 * `REGION` blocks between its cues; a cue may have an id line, settings after
 * its timing (`align:start position:10%`), inline markup (`<i>`, `<c.loud>`)
 * and a voice tag naming who is speaking (`<v Alice>`). All of that is
 * dropped or used by the shared cue reader in `core/importers/subtitles.ts`;
 * what comes out is one paragraph per cue and one anchor per cue.
 *
 * The header is not simply skipped by position: a `NOTE` block can sit
 * anywhere, and a block that is not a cue is recognised by not having a
 * timing line rather than by where it is.
 */

import { parseSubtitles, type ParsedSubtitles } from "./subtitles";

const decoder = new TextDecoder("utf-8", { fatal: false });

/** Whether this text looks like a WebVTT file (used to tell a mislabelled
 * `.srt` from a real one is not worth it; this is for messages only). */
export function looksLikeVtt(source: string): boolean {
  return /^\uFEFF?WEBVTT(\s|$)/.test(source);
}

/** Parse a `.vtt` file into document text plus one anchor per cue. */
export function importVtt(bytes: Uint8Array): ParsedSubtitles {
  return parseVtt(decoder.decode(bytes));
}

/** The same, from text already decoded (what the tests exercise). */
export function parseVtt(source: string): ParsedSubtitles {
  return parseSubtitles(source);
}
