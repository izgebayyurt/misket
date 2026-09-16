use misket_core::db::sets;
use misket_core::models::{ExcerptFilter, SavedFilter, SetInfo, SetWithMembers};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn list_sets(state: State<'_, AppState>, kind: String) -> Result<Vec<SetInfo>> {
    state.with_project(|p| sets::list_sets(&p.conn, &kind))
}

/// `id` lets undo recreate a deleted set with its original identity.
#[tauri::command]
pub fn create_set(
    state: State<'_, AppState>,
    kind: String,
    name: String,
    member_ids: Option<Vec<String>>,
    id: Option<String>,
) -> Result<SetInfo> {
    let members = member_ids.unwrap_or_default();
    state.with_project(|p| sets::create_set(&p.conn, &kind, &name, &members, id.as_deref()))
}

#[tauri::command]
pub fn rename_set(state: State<'_, AppState>, id: String, name: String) -> Result<SetInfo> {
    state.with_project(|p| sets::rename_set(&p.conn, &id, &name))
}

#[tauri::command]
pub fn delete_set(state: State<'_, AppState>, id: String) -> Result<SetWithMembers> {
    state.with_project(|p| sets::delete_set(&p.conn, &id))
}

#[tauri::command]
pub fn list_set_members(state: State<'_, AppState>, set_id: String) -> Result<Vec<String>> {
    state.with_project(|p| sets::set_members(&p.conn, &set_id))
}

#[tauri::command]
pub fn set_set_members(
    state: State<'_, AppState>,
    set_id: String,
    member_ids: Vec<String>,
) -> Result<Vec<String>> {
    state.with_project(|p| sets::set_set_members(&p.conn, &set_id, &member_ids))
}

#[tauri::command]
pub fn add_to_set(
    state: State<'_, AppState>,
    set_id: String,
    member_id: String,
) -> Result<Vec<String>> {
    state.with_project(|p| sets::add_to_set(&p.conn, &set_id, &member_id))
}

#[tauri::command]
pub fn remove_from_set(
    state: State<'_, AppState>,
    set_id: String,
    member_id: String,
) -> Result<Vec<String>> {
    state.with_project(|p| sets::remove_from_set(&p.conn, &set_id, &member_id))
}

#[tauri::command]
pub fn list_saved_filters(state: State<'_, AppState>) -> Result<Vec<SavedFilter>> {
    state.with_project(|p| sets::list_saved_filters(&p.conn))
}

#[tauri::command]
pub fn save_filter(
    state: State<'_, AppState>,
    name: String,
    filter: ExcerptFilter,
) -> Result<SavedFilter> {
    state.with_project(|p| sets::save_filter(&p.conn, &name, &filter))
}

#[tauri::command]
pub fn delete_saved_filter(state: State<'_, AppState>, id: String) -> Result<SavedFilter> {
    state.with_project(|p| sets::delete_saved_filter(&p.conn, &id))
}
