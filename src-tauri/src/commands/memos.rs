use misket_core::db::memos;
use misket_core::models::{Memo, MemoTarget};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn list_memos(state: State<'_, AppState>, target: MemoTarget) -> Result<Vec<Memo>> {
    state.with_project(|p| memos::list(&p.conn, &target))
}

#[tauri::command]
pub fn create_memo(
    state: State<'_, AppState>,
    target: MemoTarget,
    title: String,
    body: String,
) -> Result<Memo> {
    state.with_project(|p| memos::create(&p.conn, target, &title, &body))
}

#[tauri::command]
pub fn update_memo(
    state: State<'_, AppState>,
    id: String,
    title: String,
    body: String,
) -> Result<Memo> {
    state.with_project(|p| memos::update(&p.conn, &id, &title, &body))
}

#[tauri::command]
pub fn delete_memo(state: State<'_, AppState>, id: String) -> Result<Memo> {
    state.with_project(|p| memos::delete(&p.conn, &id))
}

#[tauri::command]
pub fn restore_memo(state: State<'_, AppState>, memo: Memo) -> Result<Memo> {
    state.with_project(|p| memos::restore(&p.conn, &memo))
}
