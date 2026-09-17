import { invoke } from "./client";
import type { TranscriptFormat, TranscriptInfo } from "./types";

/** The document's transcript: format, turns and speakers. */
export const getTranscript = (documentId: string) =>
  invoke<TranscriptInfo>("get_transcript", { documentId });

/** What `format` would find, without storing it — the dialog's live preview,
 * and where a custom pattern is validated. */
export const previewTranscript = (documentId: string, format: TranscriptFormat) =>
  invoke<TranscriptInfo>("preview_transcript", { documentId, format });

/** Pin a document to a format, or (with `null`) go back to detecting one. */
export const setTranscriptFormat = (documentId: string, format: TranscriptFormat | null) =>
  invoke<TranscriptInfo>("set_transcript_format", { documentId, format });

/** The project-level default for new imports; `null` is "detect". */
export const getTranscriptDefault = () => invoke<TranscriptFormat | null>("get_transcript_default");
export const setTranscriptDefault = (format: TranscriptFormat | null) =>
  invoke<void>("set_transcript_default", { format });

/** Every speaker in the project, for the excerpt browser's speaker filter. */
export const listProjectSpeakers = () => invoke<string[]>("list_project_speakers");
