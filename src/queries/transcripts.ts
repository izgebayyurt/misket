import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/transcripts";
import type { TranscriptFormat } from "@/api/types";
import { keys } from "./keys";

/**
 * One document's transcript. Not `staleTime: Infinity` like the document
 * text: the text never changes, but the *format* it is read with can.
 */
export function useTranscript(documentId: string | null) {
  return useQuery({
    queryKey: keys.transcript(documentId ?? ""),
    queryFn: () => api.getTranscript(documentId!),
    enabled: !!documentId,
    staleTime: 60_000,
  });
}

/** The project-level default for newly imported documents. */
export function useTranscriptDefault() {
  return useQuery({
    queryKey: keys.transcriptDefault,
    queryFn: api.getTranscriptDefault,
    staleTime: 60_000,
  });
}

/** Every speaker in the project, for the excerpt browser's speaker filter. */
export function useProjectSpeakers() {
  return useQuery({
    queryKey: keys.projectSpeakers,
    queryFn: api.listProjectSpeakers,
    staleTime: 60_000,
  });
}

function useInvalidateTranscripts() {
  const qc = useQueryClient();
  return (documentId?: string) => {
    if (documentId) qc.invalidateQueries({ queryKey: keys.transcript(documentId) });
    else qc.invalidateQueries({ queryKey: keys.allTranscripts });
    qc.invalidateQueries({ queryKey: keys.projectSpeakers });
    // Speakers show up on document summaries, on excerpt rows and as the
    // columns of the speaker cross-tab.
    qc.invalidateQueries({ queryKey: keys.documents });
    qc.invalidateQueries({ queryKey: keys.excerptQueries });
    qc.invalidateQueries({ queryKey: keys.analysis });
  };
}

/**
 * Change which format a document is read with; `null` goes back to detecting
 * one. Nothing registers an inverse here: the backend records the previous
 * format into the history tree as it writes, so undo puts it back and is
 * still there tomorrow.
 */
export function useSetTranscriptFormat() {
  const invalidate = useInvalidateTranscripts();
  return useMutation({
    mutationFn: ({ documentId, format }: { documentId: string; format: TranscriptFormat | null }) =>
      api.setTranscriptFormat(documentId, format),
    onSuccess: (_info, { documentId }) => invalidate(documentId),
  });
}

/** The project default, undoable the same way. */
export function useSetTranscriptDefault() {
  const invalidate = useInvalidateTranscripts();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (format: TranscriptFormat | null) => api.setTranscriptDefault(format),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.transcriptDefault });
      invalidate();
    },
  });
}
