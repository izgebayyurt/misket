/**
 * Time, waveforms and file types for audio and video documents. Pure: no
 * DOM, no React, no Tauri.
 *
 * Positions are **milliseconds**, integers, end-exclusive — the same shape
 * text excerpts use for code points (`excerpts.startPos`/`endPos`, see
 * `docs/DATA_MODEL.md`). Everything a timeline, a keyboard step or an in/out
 * pair needs to be right lives here so it can be tested without a player.
 */

/** Extensions imported as audio documents. */
export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg", "flac"] as const;

/** Extensions imported as video documents. */
export const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "m4v", "mkv"] as const;

/** Every extension imported as a recording, coded with time ranges. */
export const MEDIA_EXTENSIONS = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS] as const;

/**
 * MIME per extension, matching `MEDIA_MIMES` in
 * `crates/misket-core/src/db/media.rs`.
 *
 * These are the types Misket *imports*; whether a given build's webview can
 * decode one is a separate question, answered by actually loading the file
 * (`.mkv` in particular is usually a Matroska container WebKitGTK will not
 * play), which is why the import measures a file before creating a document.
 */
const MEDIA_MIMES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  m4v: "video/x-m4v",
  mkv: "video/x-matroska",
};

/** Extensions whose containers webviews most often cannot decode. */
const RISKY_EXTENSIONS = new Set(["mkv", "flac", "m4v"]);

/** The MIME type for a media extension, or null for anything else. */
export function mediaMimeForExtension(ext: string): string | null {
  return MEDIA_MIMES[ext.toLowerCase()] ?? null;
}

/** Whether a MIME type is a video (as opposed to audio-only) recording. */
export function isVideoMime(mime: string): boolean {
  return mime.startsWith("video/");
}

/**
 * Why a file may not play, as a sentence to show on import, or null when
 * there is no reason to expect trouble. The real answer only comes from
 * trying to load it; this is what to say *once it has failed*.
 */
export function unsupportedHint(fileName: string, ext: string): string {
  const mime = mediaMimeForExtension(ext);
  if (!mime) {
    return `${fileName} is not an audio or video file Misket knows (${MEDIA_EXTENSIONS.join(", ")}).`;
  }
  if (RISKY_EXTENSIONS.has(ext.toLowerCase())) {
    return `${fileName} could not be played. A .${ext} file is a container that may hold codecs this build cannot decode — converting it to MP4 (H.264/AAC) or WAV will work.`;
  }
  return `${fileName} could not be played: its codec is not one this build can decode. Converting it to MP4 (H.264/AAC), WebM or WAV will work.`;
}

/**
 * A position as `m:ss.s`, the unit a coder reads a timeline in; hours appear
 * only once there are any. Mirrors `db::media::timecode` in Rust, which
 * writes the same label into an excerpt's snapshot.
 */
export function formatTimecode(ms: number): string {
  const clamped = Number.isFinite(ms) ? Math.max(0, Math.trunc(ms)) : 0;
  const tenths = Math.trunc((clamped % 1000) / 100);
  const totalSeconds = Math.trunc(clamped / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.trunc(totalSeconds / 60) % 60;
  const hours = Math.trunc(totalSeconds / 3600);
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}.${tenths}`;
  return `${minutes}:${ss}.${tenths}`;
}

/** The `[in–out]` label an excerpt carries, as Rust writes it. */
export function formatRangeLabel(startMs: number, endMs: number): string {
  return `[${formatTimecode(startMs)}–${formatTimecode(endMs)}]`;
}

/** A duration for a document listing: `2:05` or `1:02:05`, no tenths. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.trunc(totalSeconds / 60) % 60;
  const hours = Math.trunc(totalSeconds / 3600);
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}

/** Parse a typed `m:ss.s`, `h:mm:ss.s` or plain-seconds time; null if unreadable. */
export function parseTimecode(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    // Only the last part may have a fraction; the rest are whole numbers.
    if (!/^\d+(\.\d+)?$/.test(part)) return null;
    total = total * 60 + Number(part);
  }
  if (!Number.isFinite(total)) return null;
  return Math.round(total * 1000);
}

/** Keep a position inside `[0, durationMs]`. */
export function clampPosition(ms: number, durationMs: number): number {
  if (!Number.isFinite(ms)) return 0;
  const limit = Math.max(0, Math.trunc(durationMs));
  return Math.min(limit, Math.max(0, Math.round(ms)));
}

/** A pending in/out pair, before it becomes an excerpt. */
export interface MediaRange {
  startMs: number;
  endMs: number;
}

/** The shortest stretch worth coding: below this the player cannot seek to it. */
export const MIN_RANGE_MS = 100;

/**
 * Set the in-point of a pending range, keeping it before the out-point.
 *
 * Pressing `[` twice in a row with no out-point yet, or after the out-point,
 * should not produce an empty or inverted range: the out-point follows the
 * in-point by at least [`MIN_RANGE_MS`].
 */
export function setInPoint(
  range: MediaRange | null,
  ms: number,
  durationMs: number,
): MediaRange | null {
  const startMs = clampPosition(ms, durationMs);
  if (startMs + MIN_RANGE_MS > durationMs) return range;
  const endMs = Math.max(range?.endMs ?? 0, startMs + MIN_RANGE_MS);
  return { startMs, endMs: clampPosition(endMs, durationMs) };
}

/** Set the out-point, keeping it after the in-point. */
export function setOutPoint(
  range: MediaRange | null,
  ms: number,
  durationMs: number,
): MediaRange | null {
  const endMs = clampPosition(ms, durationMs);
  if (endMs < MIN_RANGE_MS) return range;
  const wanted = range?.startMs ?? endMs - MIN_RANGE_MS;
  const startMs = Math.min(wanted, endMs - MIN_RANGE_MS);
  return { startMs: Math.max(0, startMs), endMs };
}

/** Whether a range is worth sending to `applyCodes`. */
export function isCodableRange(range: MediaRange | null, durationMs: number): range is MediaRange {
  if (!range) return false;
  return (
    range.startMs >= 0 &&
    range.endMs > range.startMs &&
    (durationMs <= 0 || range.endMs <= durationMs)
  );
}

/**
 * Reduce raw audio samples to `count` peaks in 0..1.
 *
 * One peak per equal slice of the recording, each the largest absolute
 * sample in its slice: a waveform is read for where the loud parts are, and
 * averaging would flatten exactly that. Fewer samples than peaks (a very
 * short clip) yields one peak per sample rather than empty slices.
 */
export function downsamplePeaks(samples: Float32Array | number[], count: number): number[] {
  const n = samples.length;
  const wanted = Math.max(1, Math.trunc(count));
  if (n === 0) return [];
  const buckets = Math.min(wanted, n);
  const out = new Array<number>(buckets);
  for (let i = 0; i < buckets; i++) {
    const from = Math.floor((i * n) / buckets);
    const to = Math.max(from + 1, Math.floor(((i + 1) * n) / buckets));
    let peak = 0;
    for (let j = from; j < to && j < n; j++) {
      const v = Math.abs(samples[j] ?? 0);
      if (v > peak) peak = v;
    }
    out[i] = Math.min(1, Math.round(peak * 100) / 100);
  }
  return out;
}

/** The peaks covering `[startMs, endMs)`, for an excerpt's waveform slice. */
export function peakSlice(
  peaks: readonly number[] | null | undefined,
  startMs: number,
  endMs: number,
  durationMs: number,
): number[] {
  if (!peaks || peaks.length === 0 || durationMs <= 0 || endMs <= startMs) return [];
  const from = Math.max(0, Math.floor((startMs / durationMs) * peaks.length));
  const to = Math.min(
    peaks.length,
    Math.max(from + 1, Math.ceil((endMs / durationMs) * peaks.length)),
  );
  return peaks.slice(from, to);
}
