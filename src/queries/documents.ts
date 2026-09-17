import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/documents";
import type { NewDocument, NewImageDocument, NewMediaDocument } from "@/api/types";
import { keys } from "./keys";

export function useDocuments() {
  return useQuery({ queryKey: keys.documents, queryFn: api.listDocuments });
}

/** Importable files inside a folder; re-queried when "include subfolders" flips. */
export function useImportableFiles(dir: string, recursive: boolean) {
  return useQuery({
    queryKey: keys.importableFiles(dir, recursive),
    queryFn: () => api.listImportableFiles(dir, recursive),
    staleTime: 0,
    gcTime: 0,
  });
}

export function useDocument(id: string | null) {
  return useQuery({
    queryKey: keys.document(id ?? ""),
    queryFn: () => api.getDocument(id!),
    enabled: !!id,
    staleTime: Infinity, // document text is immutable
  });
}

/** Recordings whose file has moved; polled when the overview is on screen. */
export function useMissingMedia() {
  return useQuery({ queryKey: keys.missingMedia, queryFn: api.listMissingMedia });
}

function useInvalidateDocuments() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: keys.documents });
    qc.invalidateQueries({ queryKey: keys.analysis });
    qc.invalidateQueries({ queryKey: keys.project });
    qc.invalidateQueries({ queryKey: keys.stats });
    qc.invalidateQueries({ queryKey: keys.history });
    qc.invalidateQueries({ queryKey: keys.missingMedia });
  };
}

export function useCreateDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: (input: NewDocument) => api.createDocument(input),
    onSuccess: invalidate,
  });
}

export function useCreateImageDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: (input: NewImageDocument) => api.createImageDocument(input),
    onSuccess: invalidate,
  });
}

export function useCreateMediaDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: (input: NewMediaDocument) => api.createMediaDocument(input),
    onSuccess: invalidate,
  });
}

/** Point a media document at a different file; undo puts the old path back. */
export function useRelinkMediaDocument() {
  const qc = useQueryClient();
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) => api.relinkMediaDocument(id, path),
    onSuccess: (_d, { id }) => {
      invalidate();
      qc.invalidateQueries({ queryKey: keys.document(id) });
    },
  });
}

/**
 * Cache the waveform the viewer computed. A cache, not an edit: it is not
 * undoable and it does not touch the document's `updatedAt`, so only the one
 * document's query is refreshed.
 */
export function useSetMediaPeaks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, peaks }: { id: string; peaks: number[] }) => api.setMediaPeaks(id, peaks),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: keys.document(id) });
      qc.invalidateQueries({ queryKey: keys.documents });
    },
  });
}

/** Store the frame captured at a video excerpt's in-point. */
export function useSetExcerptThumbnail() {
  return useMutation({
    mutationFn: ({
      excerptId,
      mime,
      bytes,
    }: {
      excerptId: string;
      mime: string;
      bytes: number[];
    }) => api.setExcerptThumbnail(excerptId, mime, bytes),
  });
}

export function useRenameDocument() {
  const qc = useQueryClient();
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameDocument(id, name),
    onSuccess: (_d, { id }) => {
      invalidate();
      qc.invalidateQueries({ queryKey: keys.document(id) });
    },
  });
}

export function useReorderDocuments() {
  const invalidate = useInvalidateDocuments();
  return useMutation({ mutationFn: api.reorderDocuments, onSuccess: invalidate });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: api.deleteDocument,
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: keys.excerptQueries });
      qc.invalidateQueries({ queryKey: keys.codes });
    },
  });
}
