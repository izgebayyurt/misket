use misket_core::db::history;
use misket_core::models::{CompactReport, HistoryNode, HistoryNodeSummary};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

/// Take back the step at the head and move it to the parent. `None` means
/// there was nothing left to undo.
#[tauri::command]
pub fn history_undo(state: State<'_, AppState>) -> Result<Option<HistoryNode>> {
    state.with_project(|p| history::undo(&p.conn))
}

/// Step forward again: onto `child` if given, else the branch redo followed
/// last, else the newest.
#[tauri::command]
pub fn history_redo(state: State<'_, AppState>, child: Option<i64>) -> Result<Option<HistoryNode>> {
    state.with_project(|p| history::redo(&p.conn, child))
}

/// Move the project to any node in the tree, in one transaction.
#[tauri::command]
pub fn history_checkout(state: State<'_, AppState>, id: i64) -> Result<HistoryNode> {
    state.with_project(|p| history::checkout(&p.conn, id))
}

#[tauri::command]
pub fn history_tree(state: State<'_, AppState>) -> Result<Vec<HistoryNodeSummary>> {
    state.with_project(|p| history::tree(&p.conn))
}

/// Name the current node, so the branch growing from it can be found again.
#[tauri::command]
pub fn history_fork(state: State<'_, AppState>, name: String) -> Result<HistoryNode> {
    state.with_project(|p| history::fork_here(&p.conn, &name))
}

#[tauri::command]
pub fn history_rename_branch(
    state: State<'_, AppState>,
    id: i64,
    name: Option<String>,
) -> Result<HistoryNode> {
    state.with_project(|p| history::rename_branch(&p.conn, id, name.as_deref()))
}

/// Throw away everything before `id`, making it the new root.
#[tauri::command]
pub fn history_compact(state: State<'_, AppState>, id: i64) -> Result<CompactReport> {
    state.with_project(|p| history::compact_before(&p.conn, id))
}
