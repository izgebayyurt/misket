import { invoke } from "./client";
import type {
  Document,
  DocumentSummary,
  NewDocument,
  NewImageDocument,
  SpeakerTurn,
} from "./types";

export const createDocument = (input: NewDocument) =>
  invoke<Document>("create_document", { input });
export const createImageDocument = (input: NewImageDocument) =>
  invoke<Document>("create_image_document", { input });
export const listDocuments = () => invoke<DocumentSummary[]>("list_documents");
export const getDocument = (id: string) => invoke<Document>("get_document", { id });
export const renameDocument = (id: string, name: string) =>
  invoke<DocumentSummary>("rename_document", { id, name });
export const reorderDocuments = (ids: string[]) => invoke<void>("reorder_documents", { ids });
/** Speaker turns detected in a text document, for the "Speakers" menu. */
export const detectSpeakerTurns = (id: string) =>
  invoke<SpeakerTurn[]>("detect_speaker_turns", { id });
export const deleteDocument = (id: string) => invoke<void>("delete_document", { id });
/** Importable files inside a folder, sorted by name. */
export const listImportableFiles = (dir: string, recursive: boolean) =>
  invoke<string[]>("list_importable_files", { dir, recursive });
