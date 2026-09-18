import { invoke } from "./client";
import type {
  Document,
  DocumentSummary,
  MediaProbe,
  MissingMedia,
  NewDocument,
  NewImageDocument,
  NewMediaDocument,
} from "./types";

export const createDocument = (input: NewDocument) =>
  invoke<Document>("create_document", { input });
export const createImageDocument = (input: NewImageDocument) =>
  invoke<Document>("create_image_document", { input });
/**
 * Stage a picked file so the webview can measure it. The returned token is
 * served at `misket-media://…/probe/<token>` until the next few imports push
 * it out; see `stage_media_probe` in `src-tauri/src/commands/media.rs`.
 */
export const stageMediaProbe = (path: string) => invoke<MediaProbe>("stage_media_probe", { path });
/** Import an audio or video document; the file stays where it is. */
export const createMediaDocument = (input: NewMediaDocument) =>
  invoke<Document>("create_media_document", { input });
/** Point a media document at a different file (undoable). */
export const relinkMediaDocument = (id: string, path: string) =>
  invoke<DocumentSummary>("relink_media_document", { id, path });
/** Cache the waveform the viewer computed for a recording. */
export const setMediaPeaks = (id: string, peaks: number[]) =>
  invoke<DocumentSummary>("set_media_peaks", { id, peaks });
/** Fill in a duration (and pixel size) the import could not measure. */
export const setMediaMeasurements = (
  id: string,
  durationMs: number,
  width: number,
  height: number,
) => invoke<DocumentSummary>("set_media_measurements", { id, durationMs, width, height });
/** Store the frame captured at a video excerpt's in-point. */
export const setExcerptThumbnail = (excerptId: string, mime: string, bytes: number[]) =>
  invoke<void>("set_excerpt_thumbnail", { excerptId, mime, bytes });
/** Recordings whose file is not where it was imported from. */
export const listMissingMedia = () => invoke<MissingMedia[]>("list_missing_media");
export const listDocuments = () => invoke<DocumentSummary[]>("list_documents");
export const getDocument = (id: string) => invoke<Document>("get_document", { id });
export const renameDocument = (id: string, name: string) =>
  invoke<DocumentSummary>("rename_document", { id, name });
export const reorderDocuments = (ids: string[]) => invoke<void>("reorder_documents", { ids });
export const deleteDocument = (id: string) => invoke<void>("delete_document", { id });
/** Importable files inside a folder, sorted by name. */
export const listImportableFiles = (dir: string, recursive: boolean) =>
  invoke<string[]>("list_importable_files", { dir, recursive });
