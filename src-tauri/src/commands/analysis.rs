use misket_core::db::analysis;
use misket_core::models::{CoOccurrence, CodeByDocument, CodeFrequency};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn code_frequencies(
    state: State<'_, AppState>,
    document_ids: Option<Vec<String>>,
) -> Result<Vec<CodeFrequency>> {
    state.with_project(|p| analysis::code_frequencies(&p.conn, document_ids.as_deref()))
}

#[tauri::command]
pub fn co_occurrence(
    state: State<'_, AppState>,
    document_ids: Option<Vec<String>>,
) -> Result<CoOccurrence> {
    state.with_project(|p| analysis::co_occurrence(&p.conn, document_ids.as_deref()))
}

#[tauri::command]
pub fn code_by_document(state: State<'_, AppState>) -> Result<CodeByDocument> {
    state.with_project(|p| analysis::code_by_document(&p.conn))
}
