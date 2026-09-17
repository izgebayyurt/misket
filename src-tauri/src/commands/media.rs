//! Audio and video documents: import by reference, relink, and the two
//! caches the viewer fills in (waveform peaks, excerpt frames).

use std::path::PathBuf;

use misket_core::db::{media, util};
use misket_core::models::{Document, DocumentSummary, MediaProbe, MissingMedia, NewMediaDocument};
use misket_core::{AppError, Result};
use tauri::State;

use crate::state::AppState;

/// The loopback origin and token the page builds media URLs from.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaServerInfo {
    pub origin: String,
    pub token: String,
}

/// Where a media element can reach this project's recordings.
///
/// A recording cannot be played from a custom URI scheme on Linux, so it is
/// served over a loopback HTTP listener bound at startup; this hands the page
/// that listener's origin and this run's token (`crate::media`). `None` means
/// the listener could not be bound, and the viewer says so rather than
/// showing a player that will never start.
#[tauri::command]
pub fn media_server(state: State<'_, AppState>) -> Option<MediaServerInfo> {
    let found = state.media_server.lock().ok().and_then(|slot| slot.clone());
    found.map(|(origin, token)| MediaServerInfo { origin, token })
}

/// Stage a picked file so the webview can measure it before importing.
///
/// A recording's duration only a decoder knows, and the file is not a
/// document yet, so the media protocol cannot serve it by id. This hands back
/// an opaque token the protocol will answer `/probe/<token>` for — the page
/// never names a path — plus what can be read without decoding anything.
#[tauri::command]
pub fn stage_media_probe(state: State<'_, AppState>, path: String) -> Result<MediaProbe> {
    let path = PathBuf::from(path);
    let mime = media::mime_for_path(&path).ok_or_else(|| {
        AppError::Validation(format!(
            "{} is not an audio or video file Misket imports",
            path.display()
        ))
    })?;
    let meta = std::fs::metadata(&path)?;
    if !meta.is_file() {
        return Err(AppError::NotFound(format!("no file at {}", path.display())));
    }
    let token = util::new_id();
    state.stage_probe(token.clone(), path)?;
    Ok(MediaProbe {
        token,
        mime: mime.to_string(),
        size_bytes: meta.len() as i64,
    })
}

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

/// Fill in a duration (and, for video, a pixel size) the import could not
/// measure — a REFI-QDA package names a file but records no duration.
#[tauri::command]
pub fn set_media_measurements(
    state: State<'_, AppState>,
    id: String,
    duration_ms: i64,
    width: i64,
    height: i64,
) -> Result<DocumentSummary> {
    state.with_project(|p| media::set_measured(&p.conn, &id, duration_ms, width, height))
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
