use misket_core::db::analysis;
use misket_core::models::{
    CoOccurrence, CodeByDocument, CodeFrequency, WordFrequency, WordFrequencyOptions,
    WordFrequencyScope,
};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn code_frequencies(
    state: State<'_, AppState>,
    document_ids: Option<Vec<String>>,
    document_set_ids: Option<Vec<String>>,
) -> Result<Vec<CodeFrequency>> {
    state.with_project(|p| {
        analysis::code_frequencies(
            &p.conn,
            document_ids.as_deref(),
            document_set_ids.as_deref(),
        )
    })
}

#[tauri::command]
pub fn co_occurrence(
    state: State<'_, AppState>,
    document_ids: Option<Vec<String>>,
    document_set_ids: Option<Vec<String>>,
) -> Result<CoOccurrence> {
    state.with_project(|p| {
        analysis::co_occurrence(
            &p.conn,
            document_ids.as_deref(),
            document_set_ids.as_deref(),
        )
    })
}

#[tauri::command]
pub fn code_by_document(state: State<'_, AppState>) -> Result<CodeByDocument> {
    state.with_project(|p| analysis::code_by_document(&p.conn))
}

#[tauri::command]
pub fn word_frequencies(
    state: State<'_, AppState>,
    scope: WordFrequencyScope,
    options: WordFrequencyOptions,
) -> Result<Vec<WordFrequency>> {
    state.with_project(|p| analysis::word_frequencies(&p.conn, &scope, &options))
}

/// The project's custom word-frequency stop words (on top of the built-in list).
#[tauri::command]
pub fn get_stop_words(state: State<'_, AppState>) -> Result<Vec<String>> {
    state.with_project(|p| analysis::stop_words(&p.conn))
}

#[tauri::command]
pub fn set_stop_words(state: State<'_, AppState>, words: Vec<String>) -> Result<()> {
    state.with_project(|p| analysis::set_stop_words(&p.conn, &words))
}

#[tauri::command]
pub fn code_timeline(
    state: State<'_, AppState>,
    code_id: String,
    include_descendants: bool,
    bucket: String,
) -> Result<Vec<(String, i64)>> {
    state.with_project(|p| analysis::code_timeline(&p.conn, &code_id, include_descendants, &bucket))
}
