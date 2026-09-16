use misket_core::db::activity;
use misket_core::models::{ActivityEntry, ActivityFilter, ActivityPage};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn list_activity(state: State<'_, AppState>, filter: ActivityFilter) -> Result<ActivityPage> {
    state.with_project(|p| activity::list(&p.conn, &filter))
}

#[tauri::command]
pub fn code_history(state: State<'_, AppState>, id: String) -> Result<Vec<ActivityEntry>> {
    state.with_project(|p| activity::code_history(&p.conn, &id))
}

#[tauri::command]
pub fn excerpt_history(state: State<'_, AppState>, id: String) -> Result<Vec<ActivityEntry>> {
    state.with_project(|p| activity::excerpt_history(&p.conn, &id))
}
