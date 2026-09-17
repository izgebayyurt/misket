use misket_core::db::{bulk, excerpts};
use misket_core::models::{
    ApplyCodesInput, ApplyResult, AutoCodeHit, AutoCodeReport, BulkCodeReport, ExcerptDetail,
    ExcerptFilter, ExcerptPage, ExcerptSnapshot, ExcerptWithCodes, InVivoResult, MergeResult,
    RetagReport, SplitResult,
};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn apply_codes(state: State<'_, AppState>, input: ApplyCodesInput) -> Result<ApplyResult> {
    state.with_project(|p| excerpts::apply_codes(&p.conn, input))
}

/// Create a code named after the selected text and apply it to that
/// selection: one command, so it is one step in the history.
#[tauri::command]
pub fn in_vivo_code(
    state: State<'_, AppState>,
    document_id: String,
    start_pos: i64,
    end_pos: i64,
    name: String,
    parent_id: Option<String>,
) -> Result<InVivoResult> {
    state.with_project(|p| {
        excerpts::in_vivo_code(
            &p.conn,
            &document_id,
            start_pos,
            end_pos,
            &name,
            parent_id.as_deref(),
        )
    })
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

/// Take a code off an excerpt. `coder_id` is `None` for "mine", which is what
/// the inspector's × does; pass an id to remove somebody else's coding.
#[tauri::command]
pub fn remove_excerpt_code(
    state: State<'_, AppState>,
    id: String,
    code_id: String,
    coder_id: Option<String>,
) -> Result<ExcerptWithCodes> {
    state.with_project(|p| excerpts::remove_code(&p.conn, &id, &code_id, coder_id.as_deref()))
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

#[tauri::command]
pub fn update_excerpt_range(
    state: State<'_, AppState>,
    id: String,
    start_pos: i64,
    end_pos: i64,
) -> Result<ExcerptWithCodes> {
    state.with_project(|p| excerpts::update_range(&p.conn, &id, start_pos, end_pos))
}

#[tauri::command]
pub fn split_excerpt(state: State<'_, AppState>, id: String, at: i64) -> Result<SplitResult> {
    state.with_project(|p| {
        let (left, right) = excerpts::split(&p.conn, &id, at)?;
        Ok(SplitResult { left, right })
    })
}

#[tauri::command]
pub fn merge_excerpts(
    state: State<'_, AppState>,
    left_id: String,
    right_id: String,
) -> Result<MergeResult> {
    state.with_project(|p| excerpts::merge_adjacent(&p.conn, &left_id, &right_id))
}

// ------------------------------------------------------- bulk operations

#[tauri::command]
pub fn delete_excerpts(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Vec<ExcerptSnapshot>> {
    state.with_project(|p| bulk::delete_many(&p.conn, &ids))
}

#[tauri::command]
pub fn add_codes_to_excerpts(
    state: State<'_, AppState>,
    ids: Vec<String>,
    code_ids: Vec<String>,
) -> Result<BulkCodeReport> {
    state.with_project(|p| bulk::add_codes_many(&p.conn, &ids, &code_ids))
}

#[tauri::command]
pub fn remove_codes_from_excerpts(
    state: State<'_, AppState>,
    ids: Vec<String>,
    code_ids: Vec<String>,
) -> Result<BulkCodeReport> {
    state.with_project(|p| bulk::remove_codes_many(&p.conn, &ids, &code_ids))
}

/// Move every excerpt tagged `from_code_id` onto `to_code_id`, leaving the
/// source code in the codebook.
#[tauri::command]
pub fn retag_code(
    state: State<'_, AppState>,
    from_code_id: String,
    to_code_id: String,
) -> Result<RetagReport> {
    state.with_project(|p| bulk::retag_code(&p.conn, &from_code_id, &to_code_id))
}

/// Auto-code every hit (a search match, or one already expanded to its
/// sentence/paragraph by the caller) with `code_id`.
#[tauri::command]
pub fn auto_code(
    state: State<'_, AppState>,
    hits: Vec<AutoCodeHit>,
    code_id: String,
) -> Result<AutoCodeReport> {
    state.with_project(|p| bulk::auto_code(&p.conn, &hits, &code_id))
}
