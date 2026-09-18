use misket_core::db::codes;
use misket_core::models::{
    ChildrenStrategy, Code, CodeImpact, CodePatch, DeleteCodeReport, NewCode,
};
use misket_core::Result;
use tauri::{AppHandle, State};

use crate::assist::AssistedRef;
use crate::backup_guard;
use crate::state::AppState;

#[tauri::command]
pub fn list_codes(state: State<'_, AppState>) -> Result<Vec<Code>> {
    state.with_project(|p| codes::list(&p.conn))
}

/// Create a code. `assisted` marks one whose name or definition came out of a
/// draft the person accepted; everything else about it is ordinary.
#[tauri::command]
pub fn create_code(
    state: State<'_, AppState>,
    input: NewCode,
    assisted: Option<AssistedRef>,
) -> Result<Code> {
    state.with_project(|p| {
        crate::assist::with_assist(p, assisted.as_ref(), || codes::create(&p.conn, input))
    })
}

/// Edit a code. `assisted` marks a save where the person kept some of a
/// drafted definition; the fields saved are whatever is in the dialog when
/// they press Save, drafted or typed.
#[tauri::command]
pub fn update_code(
    state: State<'_, AppState>,
    id: String,
    patch: CodePatch,
    assisted: Option<AssistedRef>,
) -> Result<Code> {
    state.with_project(|p| {
        crate::assist::with_assist(p, assisted.as_ref(), || codes::update(&p.conn, &id, patch))
    })
}

#[tauri::command]
pub fn move_code(
    state: State<'_, AppState>,
    id: String,
    new_parent_id: Option<String>,
    index: i64,
) -> Result<Code> {
    state.with_project(|p| codes::move_code(&p.conn, &id, new_parent_id.as_deref(), index))
}

#[tauri::command]
pub fn delete_code(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    children: ChildrenStrategy,
) -> Result<DeleteCodeReport> {
    state.with_project(|p| {
        // Only worth a backup if it would actually destroy coding, not for
        // an empty or lightly-used code.
        if codes::impact(&p.conn, &id)?.excerpt_count > 0 {
            backup_guard::before(&app, p, "delete-code");
        }
        codes::delete(&p.conn, &id, children)
    })
}

#[tauri::command]
pub fn merge_code(
    state: State<'_, AppState>,
    app: AppHandle,
    source_id: String,
    target_id: String,
) -> Result<Code> {
    state.with_project(|p| {
        backup_guard::before(&app, p, "merge-code");
        codes::merge(&p.conn, &source_id, &target_id)
    })
}

#[tauri::command]
pub fn count_code_impact(state: State<'_, AppState>, id: String) -> Result<CodeImpact> {
    state.with_project(|p| codes::impact(&p.conn, &id))
}
