//! Audio and video documents: import by reference, relink, and the two
//! caches the viewer fills in (waveform peaks, excerpt frames).

use misket_core::db::media;
use misket_core::models::{Document, DocumentSummary, MissingMedia, NewMediaDocument};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

/// Import an audio or video document. The file is **not** copied into the
/// project file: the row keeps its path and what the frontend measured by
/// loading it in a hidden media element. With `copyIntoProject` the file is
/// first copied into `<project>.media/` beside the `.misket`, so a project
/// folder can be moved between machines as one piece.
#[tauri::command]
pub fn create_media_document(
    state: State<'_, AppState>,
    input: NewMediaDocument,
) -> Result<Document> {
    state.with_project(|p| media::create(&p.conn, Some(&p.path), input))
}

/// Point a media document at a different file, undoably.
#[tauri::command]
pub fn relink_media_document(
    state: State<'_, AppState>,
    id: String,
    path: String,
) -> Result<DocumentSummary> {
    state.with_project(|p| media::relink(&p.conn, &id, &path))
}

/// Cache the waveform the viewer computed, so the timeline draws instantly
/// the next time the document is opened.
#[tauri::command]
pub fn set_media_peaks(
    state: State<'_, AppState>,
    id: String,
    peaks: Vec<f64>,
) -> Result<DocumentSummary> {
    state.with_project(|p| media::set_peaks(&p.conn, &id, &peaks))
}

/// Store the frame captured at a video excerpt's in-point, shown in the
/// excerpt browser and the inspector.
#[tauri::command]
pub fn set_excerpt_thumbnail(
    state: State<'_, AppState>,
    excerpt_id: String,
    mime: String,
    bytes: Vec<u8>,
) -> Result<()> {
    state.with_project(|p| media::set_thumbnail(&p.conn, &excerpt_id, &mime, &bytes))
}

/// Every audio or video document whose file is not where it was imported from.
#[tauri::command]
pub fn list_missing_media(state: State<'_, AppState>) -> Result<Vec<MissingMedia>> {
    state.with_project(|p| media::missing(&p.conn))
}
