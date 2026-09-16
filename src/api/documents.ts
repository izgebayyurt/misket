import { invoke } from "./client";
import type { Document, DocumentSummary, NewDocument } from "./types";

export const createDocument = (input: NewDocument) =>
  invoke<Document>("create_document", { input });
export const listDocuments = () => invoke<DocumentSummary[]>("list_documents");
export const getDocument = (id: string) => invoke<Document>("get_document", { id });
export const renameDocument = (id: string, name: string) =>
  invoke<DocumentSummary>("rename_document", { id, name });
export const reorderDocuments = (ids: string[]) => invoke<void>("reorder_documents", { ids });
export const deleteDocument = (id: string) => invoke<void>("delete_document", { id });
/** Importable files inside a folder, sorted by name. */
export const listImportableFiles = (dir: string, recursive: boolean) =>
  invoke<string[]>("list_importable_files", { dir, recursive });
