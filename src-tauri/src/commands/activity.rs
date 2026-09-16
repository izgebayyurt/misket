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

/// Record an undo or a redo. The undo stack lives in the frontend, so this is
/// the one activity entry the backend cannot infer: the individual writes the
/// inverse performs are logged by the domain functions as usual, and this
/// entry says they were an undo of "Merge codes", not a fresh edit.
#[tauri::command]
pub fn log_undo(state: State<'_, AppState>, redo: bool, label: String) -> Result<()> {
    state.with_project(|p| {
        activity::record(
            &p.conn,
            if redo { "redo" } else { "undo" },
            "project",
            None,
            format!("{} {label}", if redo { "Redid" } else { "Undid" }),
            serde_json::json!({ "label": label }),
            None,
            None,
        )
    })
}
