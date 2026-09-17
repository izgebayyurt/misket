//! Pull from another copy of the project (`misket_core::db::merge`).

use std::path::Path;

use misket_core::db::merge;
use misket_core::models::{MergeDecision, MergePlan, MergeReport};
use misket_core::Result;
use tauri::{AppHandle, State};

use crate::backup_guard;
use crate::state::AppState;

/// What pulling from `path` would do. Reads both files and writes neither.
#[tauri::command]
pub fn merge_preview(state: State<'_, AppState>, path: String) -> Result<MergePlan> {
    state.with_project(|p| merge::preview(&p.conn, Path::new(&path)))
}

/// Do it. `decisions` answers the conflicts the preview listed; anything
/// left unanswered takes the default the preview proposed.
#[tauri::command]
pub fn merge_apply(
    state: State<'_, AppState>,
    app: AppHandle,
    path: String,
    decisions: Vec<MergeDecision>,
) -> Result<MergeReport> {
    state.with_project(|p| {
        backup_guard::before(&app, p, "pull-merge");
        merge::apply(&p.conn, Path::new(&path), &decisions)
    })
}
