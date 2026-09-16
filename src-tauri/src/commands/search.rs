use misket_core::db::search;
use misket_core::models::SearchHit;
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn search_project(
    state: State<'_, AppState>,
    query: String,
    limit: usize,
    regex: bool,
) -> Result<Vec<SearchHit>> {
    state.with_project(|p| search::search_project(&p.conn, &query, limit, regex))
}
