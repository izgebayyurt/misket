//! Transcript alignment: the link between a transcript and its recording,
//! and the anchors that line the two up. Thin wrappers over
//! `misket_core::db::align`.

use misket_core::db::align;
use misket_core::models::{ApplyResult, DocumentSummary};
use misket_core::text::align::Anchor;
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

/// The document's alignment points, earliest first.
#[tauri::command]
pub fn list_transcript_anchors(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<Anchor>> {
    state.with_project(|p| align::list(&p.conn, &document_id))
}

/// "Align here": the text at `pos` is heard at `ms` of the recording.
#[tauri::command]
pub fn set_transcript_anchor(
    state: State<'_, AppState>,
    document_id: String,
    pos: i64,
    ms: i64,
) -> Result<Vec<Anchor>> {
    state.with_project(|p| align::set(&p.conn, &document_id, pos, ms))
}

/// Forget the anchor at `pos`.
#[tauri::command]
pub fn remove_transcript_anchor(
    state: State<'_, AppState>,
    document_id: String,
    pos: i64,
) -> Result<Vec<Anchor>> {
    state.with_project(|p| align::remove(&p.conn, &document_id, pos))
}

/// Replace every anchor at once.
#[tauri::command]
pub fn set_transcript_anchors(
    state: State<'_, AppState>,
    document_id: String,
    anchors: Vec<Anchor>,
) -> Result<Vec<Anchor>> {
    state.with_project(|p| align::set_all(&p.conn, &document_id, &anchors))
}

/// Read every turn's timestamp and make an anchor of it.
#[tauri::command]
pub fn build_transcript_anchors(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<Anchor>> {
    state.with_project(|p| align::build_from_timestamps(&p.conn, &document_id))
}

/// Point a transcript at its recording, or (with `null`) unlink it.
#[tauri::command]
pub fn link_media_document(
    state: State<'_, AppState>,
    document_id: String,
    media_id: Option<String>,
) -> Result<DocumentSummary> {
    state.with_project(|p| align::link(&p.conn, &document_id, media_id.as_deref()))
}

/// Code the stretch of the recording a transcript passage was spoken in, with
/// the same codes the passage carries. One undoable step.
#[tauri::command]
pub fn code_recording_for_excerpt(
    state: State<'_, AppState>,
    excerpt_id: String,
) -> Result<ApplyResult> {
    state.with_project(|p| align::code_recording_for_excerpt(&p.conn, &excerpt_id))
}
