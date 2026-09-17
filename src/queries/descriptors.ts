import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/descriptors";
import type { DescriptorFieldPatch, NewDescriptorField } from "@/api/types";
import { keys } from "./keys";

export function useDescriptorFields() {
  return useQuery({
    queryKey: keys.descriptorFields,
    queryFn: api.listDescriptorFields,
    staleTime: 60_000,
  });
}

export function useDocumentDescriptorValues(documentId: string | null) {
  return useQuery({
    queryKey: keys.descriptorValues(documentId ?? ""),
    queryFn: () => api.listDocumentDescriptorValues(documentId!),
    enabled: !!documentId,
  });
}

export function useDescriptorMatrix(enabled = true) {
  return useQuery({
    queryKey: keys.descriptorMatrix,
    queryFn: api.getDescriptorMatrix,
    enabled,
  });
}

export function useInvalidateDescriptors() {
  const qc = useQueryClient();
  return (documentId?: string) => {
    qc.invalidateQueries({ queryKey: keys.descriptorFields });
    qc.invalidateQueries({ queryKey: keys.descriptorMatrix });
    if (documentId) qc.invalidateQueries({ queryKey: keys.descriptorValues(documentId) });
    else qc.invalidateQueries({ queryKey: keys.allDescriptorValues });
    // Descriptor conditions change what the excerpt browser shows, and
    // descriptor values are the rows of a framework matrix.
    qc.invalidateQueries({ queryKey: keys.excerptQueries });
    qc.invalidateQueries({ queryKey: keys.analysis });
    qc.invalidateQueries({ queryKey: keys.stats });
  };
}

/**
 * Set or clear one document's value for a field. The backend records what
 * was there before, so undo puts it back.
 */
export function useSetDescriptorValue() {
  const invalidate = useInvalidateDescriptors();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      documentId,
      fieldId,
      value,
      previous,
    }: {
      documentId: string;
      fieldId: string;
      value: string | null;
      /** What is stored now. Read from the cache when omitted. */
      previous?: string | null;
      fieldName?: string;
    }) => {
      const before =
        previous ??
        qc
          .getQueryData<Awaited<ReturnType<typeof api.listDocumentDescriptorValues>>>(
            keys.descriptorValues(documentId),
          )
          ?.find((v) => v.fieldId === fieldId)?.value ??
        null;
      // Writing the value it already has would be an empty history entry.
      if ((before ?? "") === (value ?? "")) return;
      await api.setDescriptorValue(documentId, fieldId, value);
    },
    onSuccess: (_r, { documentId }) => invalidate(documentId),
  });
}

/**
 * Rename a field, edit its options or change its type. Changing the type
 * converts the values it can and drops the rest; the backend keeps every one
 * of them, so undo brings the column back as it was.
 */
export function useUpdateDescriptorField() {
  const invalidate = useInvalidateDescriptors();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: DescriptorFieldPatch }) =>
      api.updateDescriptorField(id, patch),
    onSuccess: () => invalidate(),
  });
}

export function useReorderDescriptorFields() {
  const invalidate = useInvalidateDescriptors();
  return useMutation({
    mutationFn: (ids: string[]) => api.reorderDescriptorFields(ids),
    onSuccess: () => invalidate(),
  });
}

export function useCreateDescriptorField() {
  const invalidate = useInvalidateDescriptors();
  return useMutation({
    mutationFn: (input: NewDescriptorField) => api.createDescriptorField(input),
    onSuccess: () => invalidate(),
  });
}

/** Undoable: the field's values are snapshotted before it goes. */
export function useDeleteDescriptorField() {
  const invalidate = useInvalidateDescriptors();
  return useMutation({
    mutationFn: (id: string) => api.deleteDescriptorField(id),
    onSuccess: () => invalidate(),
  });
}
