//! Transcript formats: which one a document is read with, and what it finds.
//! Thin wrappers over `misket_core::db::transcripts`.

use misket_core::db::transcripts::{self, TranscriptInfo};
use misket_core::text::TranscriptFormat;
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

/// The document's format, its turns and its speakers. Detects and stores a
/// format the first time a document is asked about.
#[tauri::command]
pub fn get_transcript(state: State<'_, AppState>, document_id: String) -> Result<TranscriptInfo> {
    state.with_project(|p| transcripts::get(&p.conn, &document_id))
}

/// What `format` would find, without storing it: the format dialog's live
/// preview, and where a custom pattern is validated.
#[tauri::command]
pub fn preview_transcript(
    state: State<'_, AppState>,
    document_id: String,
    format: TranscriptFormat,
) -> Result<TranscriptInfo> {
    state.with_project(|p| transcripts::preview(&p.conn, &document_id, &format))
}

/// Pin a document to a format, or (with `null`) forget the stored answer so
/// the next read detects one again.
#[tauri::command]
pub fn set_transcript_format(
    state: State<'_, AppState>,
    document_id: String,
    format: Option<TranscriptFormat>,
) -> Result<TranscriptInfo> {
    state.with_project(|p| transcripts::set_format(&p.conn, &document_id, format))
}

/// The project-level default for newly imported documents; `null` is "auto".
#[tauri::command]
pub fn get_transcript_default(state: State<'_, AppState>) -> Result<Option<TranscriptFormat>> {
    state.with_project(|p| transcripts::get_default(&p.conn))
}

#[tauri::command]
pub fn set_transcript_default(
    state: State<'_, AppState>,
    format: Option<TranscriptFormat>,
) -> Result<()> {
    state.with_project(|p| transcripts::set_default(&p.conn, format))
}

/// Every speaker in the project, for the excerpt browser's speaker filter.
#[tauri::command]
pub fn list_project_speakers(state: State<'_, AppState>) -> Result<Vec<String>> {
    state.with_project(|p| transcripts::project_speakers(&p.conn))
}
