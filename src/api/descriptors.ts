import { invoke } from "./client";
import type {
  DescriptorField,
  DescriptorFieldPatch,
  DescriptorMatrix,
  DescriptorValue,
  NewDescriptorField,
} from "./types";

export const listDescriptorFields = () => invoke<DescriptorField[]>("list_descriptor_fields");
export const createDescriptorField = (input: NewDescriptorField) =>
  invoke<DescriptorField>("create_descriptor_field", { input });
export const updateDescriptorField = (id: string, patch: DescriptorFieldPatch) =>
  invoke<DescriptorField>("update_descriptor_field", { id, patch });
export const deleteDescriptorField = (id: string) =>
  invoke<DescriptorField>("delete_descriptor_field", { id });
export const reorderDescriptorFields = (ids: string[]) =>
  invoke<DescriptorField[]>("reorder_descriptor_fields", { ids });
export const setDescriptorValue = (documentId: string, fieldId: string, value: string | null) =>
  invoke<DescriptorValue | null>("set_descriptor_value", { documentId, fieldId, value });
export const listDocumentDescriptorValues = (documentId: string) =>
  invoke<DescriptorValue[]>("list_document_descriptor_values", { documentId });
export const getDescriptorMatrix = () => invoke<DescriptorMatrix>("get_descriptor_matrix");
