use misket_core::db::history;
use misket_core::models::{CompactReport, HistoryNode, HistoryNodeDetail, HistoryNodeSummary};
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

/// One step with its detail and its references resolved as they read now:
/// what the history view's detail panel shows when a step is selected.
#[tauri::command]
pub fn history_node(state: State<'_, AppState>, id: i64) -> Result<HistoryNodeDetail> {
    state.with_project(|p| history::node_detail(&p.conn, id))
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

/// Open a compound step: every write until `history_end_group` becomes one
/// step to undo, labelled `summary`. Used where the frontend has to make
/// several calls for what the user did once, such as importing a folder.
#[tauri::command]
pub fn history_begin_group(state: State<'_, AppState>, summary: String) -> Result<()> {
    state.with_project(|p| history::begin_group(&p.conn, &summary))
}

/// Close the step `history_begin_group` opened. Safe to call when none is
/// open, so it belongs in a `finally`.
#[tauri::command]
pub fn history_end_group(state: State<'_, AppState>) -> Result<()> {
    state.with_project(|p| history::end_group(&p.conn))
}
