import { invoke } from "./client";
import type { ApplyResult, DocumentSummary, TranscriptAnchor } from "./types";

/** The document's alignment points, earliest first. */
export const listTranscriptAnchors = (documentId: string) =>
  invoke<TranscriptAnchor[]>("list_transcript_anchors", { documentId });

/** "Align here": the text at `pos` is heard at `ms` of the recording. */
export const setTranscriptAnchor = (documentId: string, pos: number, ms: number) =>
  invoke<TranscriptAnchor[]>("set_transcript_anchor", { documentId, pos, ms });

/** Forget one anchor. */
export const removeTranscriptAnchor = (documentId: string, pos: number) =>
  invoke<TranscriptAnchor[]>("remove_transcript_anchor", { documentId, pos });

/** Replace every anchor at once. */
export const setTranscriptAnchors = (documentId: string, anchors: TranscriptAnchor[]) =>
  invoke<TranscriptAnchor[]>("set_transcript_anchors", { documentId, anchors });

/** Read every turn's timestamp and make an anchor of it. */
export const buildTranscriptAnchors = (documentId: string) =>
  invoke<TranscriptAnchor[]>("build_transcript_anchors", { documentId });

/** Point a transcript at its recording, or (with `null`) unlink it. */
export const linkMediaDocument = (documentId: string, mediaId: string | null) =>
  invoke<DocumentSummary>("link_media_document", { documentId, mediaId });

/** Code the stretch of the recording a passage was spoken in, with the same
 * codes the passage carries. One undoable step. */
export const codeRecordingForExcerpt = (excerptId: string) =>
  invoke<ApplyResult>("code_recording_for_excerpt", { excerptId });
