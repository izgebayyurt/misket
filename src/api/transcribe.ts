import { listen } from "@tauri-apps/api/event";
import { invoke } from "./client";
import type { TranscriptAnchor } from "./types";

/** Mirrors `transcribe::Language`. */
export interface TranscriptionLanguage {
  code: string;
  name: string;
}

/** Mirrors `transcribe::Support`: what this build can actually do. */
export interface TranscriptionSupport {
  /** False in a build compiled without the optional `whisper` feature. */
  available: boolean;
  /** Whether ffmpeg is on PATH. Audio never needs it; some video containers do. */
  ffmpeg: boolean;
  defaultThreads: number;
  languages: TranscriptionLanguage[];
  engineVersion: string | null;
}

/** Mirrors `transcribe::models::ModelStatus`. */
export interface WhisperModel {
  id: string;
  label: string;
  sizeLabel: string;
  multilingual: boolean;
  note: string;
  installed: boolean;
  path: string | null;
  /** Bytes of a half-finished download waiting to be resumed. */
  partialBytes: number;
  /** False for a file added by hand, which has no published digest to check. */
  known: boolean;
}

export interface WhisperModelLibrary {
  dir: string;
  models: WhisperModel[];
  selected: string | null;
}

/** Mirrors `transcribe::Layout`. */
export interface TranscriptLayout {
  /** Open each paragraph with `[mm:ss]`. */
  timestamps: boolean;
  /** `null` is one paragraph per segment; a number groups segments into
   * paragraphs of at least that many seconds. */
  groupSeconds: number | null;
}

/** Mirrors `transcribe::TranscribeRequest`. */
export interface TranscribeRequest {
  documentId: string;
  model?: string | null;
  language?: string | null;
  translate?: boolean;
  threads?: number | null;
  layout: TranscriptLayout;
}

export interface TranscriptionProgress {
  documentId: string;
  percent: number;
  segmentsDone: number;
  /** Seconds still to go, once there is enough done to guess. */
  eta: number | null;
}

export interface TranscriptionDone {
  /** The recording that was transcribed. */
  documentId: string;
  status: "done" | "cancelled" | "failed";
  transcriptDocumentId?: string;
  transcriptName?: string;
  /** The segment anchors written with the transcript (`db::align`). */
  anchors?: TranscriptAnchor[];
  message?: string;
  elapsedMs: number;
}

export interface ModelDownloadProgress {
  id: string;
  received: number;
  total: number;
  percent: number;
}

export interface ModelDownloadDone {
  id: string;
  status: "done" | "cancelled" | "failed";
  message?: string;
}

export const transcriptionSupport = () => invoke<TranscriptionSupport>("transcription_support");

export const transcriptionDefaults = () => invoke<TranscriptLayout>("transcription_defaults");

export const listWhisperModels = () => invoke<WhisperModelLibrary>("list_whisper_models");

export const downloadWhisperModel = (id: string) => invoke<void>("download_whisper_model", { id });

export const cancelWhisperModelDownload = (id: string) =>
  invoke<void>("cancel_whisper_model_download", { id });

export const deleteWhisperModel = (id: string) => invoke<void>("delete_whisper_model", { id });

/** Copy a ggml `.bin` a person picked into the models folder. */
export const addWhisperModelFile = (path: string) =>
  invoke<string>("add_whisper_model_file", { path });

/** Re-check an installed model against its published digest; `null` for a
 * hand-added model, which has none. */
export const verifyWhisperModel = (id: string) =>
  invoke<boolean | null>("verify_whisper_model", { id });

/** Start a transcription. Returns as soon as the job is running; watch the
 * events below. */
export const startTranscription = (request: TranscribeRequest) =>
  invoke<void>("start_transcription", { request });

export const cancelTranscription = (documentId: string) =>
  invoke<void>("cancel_transcription", { documentId });

export const onTranscriptionProgress = (fn: (e: TranscriptionProgress) => void) =>
  listen<TranscriptionProgress>("transcription:progress", (e) => fn(e.payload));

export const onTranscriptionDone = (fn: (e: TranscriptionDone) => void) =>
  listen<TranscriptionDone>("transcription:done", (e) => fn(e.payload));

export const onModelDownloadProgress = (fn: (e: ModelDownloadProgress) => void) =>
  listen<ModelDownloadProgress>("whisper-model:progress", (e) => fn(e.payload));

export const onModelDownloadDone = (fn: (e: ModelDownloadDone) => void) =>
  listen<ModelDownloadDone>("whisper-model:done", (e) => fn(e.payload));
