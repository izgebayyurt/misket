use misket_core::db::excerpts;
use misket_core::models::{
    ApplyCodesInput, ApplyResult, ExcerptDetail, ExcerptFilter, ExcerptPage, ExcerptSnapshot,
    ExcerptWithCodes,
};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn apply_codes(state: State<'_, AppState>, input: ApplyCodesInput) -> Result<ApplyResult> {
    state.with_project(|p| excerpts::apply_codes(&p.conn, input))
}

#[tauri::command]
pub fn list_document_excerpts(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<ExcerptWithCodes>> {
    state.with_project(|p| excerpts::list_for_document(&p.conn, &document_id))
}

#[tauri::command]
pub fn get_excerpt(state: State<'_, AppState>, id: String) -> Result<ExcerptDetail> {
    state.with_project(|p| excerpts::detail(&p.conn, &id))
}

#[tauri::command]
pub fn add_excerpt_codes(
    state: State<'_, AppState>,
    id: String,
    code_ids: Vec<String>,
) -> Result<ExcerptWithCodes> {
    state.with_project(|p| excerpts::add_codes(&p.conn, &id, &code_ids))
}

#[tauri::command]
pub fn remove_excerpt_code(
    state: State<'_, AppState>,
    id: String,
    code_id: String,
) -> Result<ExcerptWithCodes> {
    state.with_project(|p| excerpts::remove_code(&p.conn, &id, &code_id))
}

#[tauri::command]
pub fn delete_excerpt(state: State<'_, AppState>, id: String) -> Result<ExcerptSnapshot> {
    state.with_project(|p| excerpts::delete(&p.conn, &id))
}

#[tauri::command]
pub fn restore_excerpt(
    state: State<'_, AppState>,
    snapshot: ExcerptSnapshot,
) -> Result<ExcerptWithCodes> {
    state.with_project(|p| excerpts::restore(&p.conn, &snapshot))
}

#[tauri::command]
pub fn query_excerpts(state: State<'_, AppState>, filter: ExcerptFilter) -> Result<ExcerptPage> {
    state.with_project(|p| excerpts::query(&p.conn, &filter))
}
