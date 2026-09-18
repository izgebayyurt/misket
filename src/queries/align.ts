import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/align";
import type { TranscriptAnchor } from "@/api/types";
import { keys } from "./keys";

/**
 * One document's alignment points.
 *
 * Cached for the session and invalidated by every write here: the anchors
 * change only when the coder changes them, and the document view reads them
 * on every `timeupdate` while the recording plays.
 */
export function useTranscriptAnchors(documentId: string | null, enabled = true) {
  return useQuery({
    queryKey: keys.transcriptAnchors(documentId ?? ""),
    queryFn: () => api.listTranscriptAnchors(documentId!),
    enabled: !!documentId && enabled,
    staleTime: Infinity,
  });
}

function useInvalidateAlignment() {
  const qc = useQueryClient();
  return (documentId?: string) => {
    if (documentId) {
      void qc.invalidateQueries({ queryKey: keys.transcriptAnchors(documentId) });
      void qc.invalidateQueries({ queryKey: keys.document(documentId) });
    } else {
      void qc.invalidateQueries({ queryKey: keys.allTranscriptAnchors });
    }
    // `linkedMediaId`, `transcriptId` and `anchorCount` all ride on the
    // document summaries the list and the viewers read.
    void qc.invalidateQueries({ queryKey: keys.documents });
    void qc.invalidateQueries({ queryKey: keys.history });
  };
}

/** "Align here" — undoable in the backend, like every other write. */
export function useSetTranscriptAnchor() {
  const invalidate = useInvalidateAlignment();
  return useMutation({
    mutationFn: ({ documentId, pos, ms }: { documentId: string; pos: number; ms: number }) =>
      api.setTranscriptAnchor(documentId, pos, ms),
    onSuccess: (_a, { documentId }) => invalidate(documentId),
  });
}

export function useRemoveTranscriptAnchor() {
  const invalidate = useInvalidateAlignment();
  return useMutation({
    mutationFn: ({ documentId, pos }: { documentId: string; pos: number }) =>
      api.removeTranscriptAnchor(documentId, pos),
    onSuccess: (_a, { documentId }) => invalidate(documentId),
  });
}

/** Replace every anchor — "Clear the alignment", and a re-read of the cues. */
export function useSetTranscriptAnchors() {
  const invalidate = useInvalidateAlignment();
  return useMutation({
    mutationFn: ({ documentId, anchors }: { documentId: string; anchors: TranscriptAnchor[] }) =>
      api.setTranscriptAnchors(documentId, anchors),
    onSuccess: (_a, { documentId }) => invalidate(documentId),
  });
}

/** Build anchors from the timestamps the transcript format captured. */
export function useBuildTranscriptAnchors() {
  const invalidate = useInvalidateAlignment();
  return useMutation({
    mutationFn: (documentId: string) => api.buildTranscriptAnchors(documentId),
    onSuccess: (_a, documentId) => invalidate(documentId),
  });
}

/** Link a transcript to its recording, or unlink it. */
export function useLinkMediaDocument() {
  const invalidate = useInvalidateAlignment();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, mediaId }: { documentId: string; mediaId: string | null }) =>
      api.linkMediaDocument(documentId, mediaId),
    onSuccess: (_s, { documentId, mediaId }) => {
      invalidate(documentId);
      // The recording's own row carries the other end of the link.
      if (mediaId) void qc.invalidateQueries({ queryKey: keys.document(mediaId) });
    },
  });
}

/** Code the recording for a transcript passage; one undoable step. */
export function useCodeRecordingForExcerpt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (excerptId: string) => api.codeRecordingForExcerpt(excerptId),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: keys.documentExcerpts(result.excerpt.documentId) });
      void qc.invalidateQueries({ queryKey: keys.excerptQueries });
      void qc.invalidateQueries({ queryKey: keys.documents });
      void qc.invalidateQueries({ queryKey: keys.analysis });
      void qc.invalidateQueries({ queryKey: keys.history });
    },
  });
}
