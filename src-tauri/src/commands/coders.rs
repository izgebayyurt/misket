use misket_core::db::{coders, history};
use misket_core::models::CoderSummary;
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

/// Everyone whose work is in the open project, with how much of it is theirs.
/// The local coder is first and carries `isLocal`.
#[tauri::command]
pub fn list_coders(state: State<'_, AppState>) -> Result<Vec<CoderSummary>> {
    state.with_project(|p| coders::list(&p.conn))
}

/// The id this install writes as, for the open project. Empty when no project
/// is open.
#[tauri::command]
pub fn local_coder_id(state: State<'_, AppState>) -> Result<String> {
    state.with_project(|p| Ok(history::local_coder(&p.conn)))
}
