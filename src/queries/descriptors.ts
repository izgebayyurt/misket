import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/api/descriptors";
import type { DescriptorFieldPatch, NewDescriptorField } from "@/api/types";
import { keys } from "./keys";
import { useUndoStore } from "@/state/undoStore";

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
 * Set or clear one document's value for a field. Undo puts back whatever was
 * there before (or clears it again).
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
      fieldName,
    }: {
      documentId: string;
      fieldId: string;
      value: string | null;
      /** What is stored now, so undo can put it back. Read from the cache when omitted. */
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
      if ((before ?? "") === (value ?? "")) return;
      await useUndoStore.getState().run({
        label: `Set ${fieldName ?? "descriptor"}`,
        redo: async () => {
          await api.setDescriptorValue(documentId, fieldId, value);
          invalidate(documentId);
        },
        undo: async () => {
          await api.setDescriptorValue(documentId, fieldId, before);
          invalidate(documentId);
        },
      });
    },
  });
}

/** Rename a field or edit its options; undoable. Changing kind is not undoable. */
export function useUpdateDescriptorField() {
  const invalidate = useInvalidateDescriptors();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: DescriptorFieldPatch }) => {
      const before = qc
        .getQueryData<Awaited<ReturnType<typeof api.listDescriptorFields>>>(keys.descriptorFields)
        ?.find((f) => f.id === id);
      const changesKind = patch.kind !== undefined && patch.kind !== before?.kind;
      if (changesKind || !before) {
        await api.updateDescriptorField(id, patch);
        useUndoStore.getState().clear();
        invalidate();
        return;
      }
      const inverse: DescriptorFieldPatch = { name: before.name, options: before.options };
      await useUndoStore.getState().run({
        label: `Edit descriptor "${before.name}"`,
        redo: async () => {
          await api.updateDescriptorField(id, patch);
          invalidate();
        },
        undo: async () => {
          await api.updateDescriptorField(id, inverse);
          invalidate();
        },
      });
    },
  });
}

export function useReorderDescriptorFields() {
  const invalidate = useInvalidateDescriptors();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const before = (
        qc.getQueryData<Awaited<ReturnType<typeof api.listDescriptorFields>>>(
          keys.descriptorFields,
        ) ?? []
      ).map((f) => f.id);
      await useUndoStore.getState().run({
        label: "Reorder descriptors",
        redo: async () => {
          await api.reorderDescriptorFields(ids);
          invalidate();
        },
        undo: async () => {
          await api.reorderDescriptorFields(before);
          invalidate();
        },
      });
    },
  });
}

/** Not undoable: clears the stack, as adding a code to the codebook does. */
export function useCreateDescriptorField() {
  const invalidate = useInvalidateDescriptors();
  return useMutation({
    mutationFn: (input: NewDescriptorField) => api.createDescriptorField(input),
    onSuccess: () => {
      useUndoStore.getState().clear();
      invalidate();
    },
  });
}

/** Not undoable: the field's values go with it. Confirm first. */
export function useDeleteDescriptorField() {
  const invalidate = useInvalidateDescriptors();
  return useMutation({
    mutationFn: (id: string) => api.deleteDescriptorField(id),
    onSuccess: () => {
      useUndoStore.getState().clear();
      invalidate();
    },
  });
}
