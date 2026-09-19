/**
 * Pure helpers for the transcription UI: how a duration, a download size or a
 * paragraph setting reads to a person. No React, no Tauri — see `src/core`.
 */

/** `src/core` stays framework-free (see CLAUDE.md), so `formatEta` and
 * `formatElapsed` take a translator instead of importing `react-i18next`. */
export type TranscriptionT = (key: string, params?: Record<string, unknown>) => string;

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
export function formatEta(seconds: number | null | undefined, t: TranscriptionT): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 20) return t("documents.transcribe.etaLessThanAMinute");
  if (seconds < 90) return t("documents.transcribe.etaAboutAMinute");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("documents.transcribe.etaAboutMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? t("documents.transcribe.etaAboutHours", { count: hours })
    : t("documents.transcribe.etaAboutHoursMinutes", { hours, minutes: rest });
}

/** How long a finished run took, for the "done" toast. */
export function formatElapsed(ms: number, t: TranscriptionT): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  // "Transcribed in 0s" reads like a bug even when it is the truth.
  if (seconds < 1) return t("documents.transcribe.underASecond");
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

/** The paragraph choices the Transcribe dialog offers. */
export const PARAGRAPH_OPTIONS: { value: number | null; labelKey: string }[] = [
  { value: null, labelKey: "documents.transcribe.paragraphOnePerSegment" },
  { value: 15, labelKey: "documents.transcribe.paragraphEvery15Seconds" },
  { value: 30, labelKey: "documents.transcribe.paragraphEvery30Seconds" },
  { value: 60, labelKey: "documents.transcribe.paragraphEveryMinute" },
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
