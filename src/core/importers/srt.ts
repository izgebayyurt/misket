/**
 * SubRip (`.srt`) subtitles as a transcript document.
 *
 * An SRT file is numbered cues: an index line, a timing line written with a
 * comma before the milliseconds, and one or more lines of text.
 *
 * ```
 * 1
 * 00:00:04,000 --> 00:00:08,200
 * I had been there before.
 * ```
 *
 * SubRip has no speaker convention of its own, but files exported from
 * transcription services often carry the WebVTT voice tag anyway, so it is
 * read here too (`core/importers/subtitles.ts`). Everything else is shared
 * with the VTT importer, including how a cue becomes a paragraph and where
 * its anchor lands.
 */

import { parseSubtitles, type ParsedSubtitles } from "./subtitles";

const decoder = new TextDecoder("utf-8", { fatal: false });

/** Parse an `.srt` file into document text plus one anchor per cue. */
export function importSrt(bytes: Uint8Array): ParsedSubtitles {
  return parseSrt(decoder.decode(bytes));
}

/** The same, from text already decoded (what the tests exercise). */
export function parseSrt(source: string): ParsedSubtitles {
  return parseSubtitles(source);
}
