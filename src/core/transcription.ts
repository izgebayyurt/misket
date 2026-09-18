/**
 * Pure helpers for the transcription UI: how a duration, a download size or a
 * paragraph setting reads to a person. No React, no Tauri — see `src/core`.
 */

/** A download or model size, the way the whisper.cpp table writes them. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MiB";
  const gib = 1024 * 1024 * 1024;
  if (bytes >= gib) return `${(bytes / gib).toFixed(1)} GiB`;
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

/**
 * "about 3 min left" — rounded, and vague on purpose. An estimate that reads
 * to the second invites people to believe it.
 */
export function formatEta(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 20) return "less than a minute left";
  if (seconds < 90) return "about a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `about ${hours} h left` : `about ${hours} h ${rest} min left`;
}

/** How long a finished run took, for the "done" toast. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

/** The paragraph choices the Transcribe dialog offers. */
export const PARAGRAPH_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "One per segment" },
  { value: 15, label: "Every 15 seconds" },
  { value: 30, label: "Every 30 seconds" },
  { value: 60, label: "Every minute" },
];

/**
 * Whether a model can be asked for a particular language. English-only models
 * are not multilingual and must not be offered Turkish, nor the translate
 * task, which only exists for the multilingual ones.
 */
export function modelSupportsLanguage(multilingual: boolean, language: string | null): boolean {
  if (multilingual) return true;
  return language === null || language === "auto" || language === "en";
}
