import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/documents";
import type { NewDocument } from "@/api/types";
import { keys } from "./keys";

export function useDocuments() {
  return useQuery({ queryKey: keys.documents, queryFn: api.listDocuments });
}

export function useDocument(id: string | null) {
  return useQuery({
    queryKey: keys.document(id ?? ""),
    queryFn: () => api.getDocument(id!),
    enabled: !!id,
    staleTime: Infinity, // document text is immutable
  });
}

function useInvalidateDocuments() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: keys.documents });
    qc.invalidateQueries({ queryKey: keys.project });
  };
}

export function useCreateDocument() {
  const invalidate = useInvalidateDocuments();
  return useMutation({
    mutationFn: (input: NewDocument) => api.createDocument(input),
    onSuccess: invalidate,
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
