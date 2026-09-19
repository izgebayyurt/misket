/**
 * The built-in transcript formats, as the format dialog shows them.
 *
 * Mirrors `PRESETS` in `crates/misket-core/src/text/transcript.rs`: the ids
 * must match, because that is what gets stored. The patterns themselves live
 * only in Rust — this side never matches anything, it only names the shapes.
 */
import type { TranscriptFormat, TranscriptPreset } from "@/api/types";

export interface PresetInfo {
  id: TranscriptPreset;
  /** How the label is written, as a heading. */
  label: string;
  /** A line in that shape, for the picker. */
  example: string;
}

export const TRANSCRIPT_PRESETS: PresetInfo[] = [
  { id: "name_colon", label: "Name:", example: "Interviewer: So tell me about…" },
  { id: "bracket_name", label: "[Name]", example: "[P1] Well, it started when…" },
  { id: "name_paren_time", label: "Name (00:12):", example: "P1 (00:12): Well, it started…" },
  { id: "bracket_time_name", label: "[00:12:03] Name:", example: "[00:12:03] P1: Well, it…" },
  { id: "time_name", label: "00:12:03 Name:", example: "00:12:03 P1: Well, it started…" },
];

/** A translator, so this module can hand back a localized label without
 * importing react/i18next itself (src/core stays framework-free — see
 * CLAUDE.md). The caller passes `useTranslation()`'s `t`. A preset's own
 * `label` (`"Name:"`, `"[Name]"`, …) is the literal shape of the pattern,
 * not a sentence, so it is never translated. */
export type TranscriptFormatT = (key: string) => string;

/** A format's name for a chip or a heading. */
export function formatLabel(
  format: TranscriptFormat | null | undefined,
  t: TranscriptFormatT,
): string {
  if (!format) return t("documentView.transcript.detectAutomatically");
  if (format.kind === "none") return t("documentView.transcript.notATranscript");
  if (format.kind === "regex") return t("documentView.transcript.customPattern");
  return (
    TRANSCRIPT_PRESETS.find((p) => p.id === format.preset)?.label ??
    t("documentView.transcript.unknownFormat")
  );
}
