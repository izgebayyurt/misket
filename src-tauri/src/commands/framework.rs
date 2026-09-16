use misket_core::db::framework;
use misket_core::models::{
    FrameworkMatrix, FrameworkMatrixInput, FrameworkMatrixView, FrameworkMatrixWithCells,
};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn list_framework_matrices(state: State<'_, AppState>) -> Result<Vec<FrameworkMatrix>> {
    state.with_project(|p| framework::list_matrices(&p.conn))
}

/// The grid itself: rows computed from the current documents and descriptors,
/// columns resolved against the current codebook, one cell per pair.
#[tauri::command]
pub fn get_framework_matrix(state: State<'_, AppState>, id: String) -> Result<FrameworkMatrixView> {
    state.with_project(|p| framework::get_matrix(&p.conn, &id))
}

/// `id` lets undo recreate a deleted matrix with its original identity.
#[tauri::command]
pub fn create_framework_matrix(
    state: State<'_, AppState>,
    input: FrameworkMatrixInput,
    id: Option<String>,
) -> Result<FrameworkMatrix> {
    state.with_project(|p| framework::create_matrix(&p.conn, &input, id.as_deref()))
}

/// Replaces the whole configuration, so undo is the same call with the
/// previous one.
#[tauri::command]
pub fn update_framework_matrix(
    state: State<'_, AppState>,
    id: String,
    input: FrameworkMatrixInput,
) -> Result<FrameworkMatrix> {
    state.with_project(|p| framework::update_matrix(&p.conn, &id, &input))
}

#[tauri::command]
pub fn delete_framework_matrix(
    state: State<'_, AppState>,
    id: String,
) -> Result<FrameworkMatrixWithCells> {
    state.with_project(|p| framework::delete_matrix(&p.conn, &id))
}

/// Put a deleted matrix back, summaries included (undo).
#[tauri::command]
pub fn restore_framework_matrix(
    state: State<'_, AppState>,
    saved: FrameworkMatrixWithCells,
) -> Result<FrameworkMatrix> {
    state.with_project(|p| framework::restore_matrix(&p.conn, &saved))
}

/// Write one cell's summary; returns the previous text, for undo.
#[tauri::command]
pub fn set_framework_cell(
    state: State<'_, AppState>,
    matrix_id: String,
    row_key: String,
    code_id: String,
    summary: String,
) -> Result<String> {
    state.with_project(|p| {
        framework::set_cell_summary(&p.conn, &matrix_id, &row_key, &code_id, &summary)
    })
}

/// The grid as CSV: the row label, then one column per code holding that
/// cell's summary.
#[tauri::command]
pub fn export_framework_csv(state: State<'_, AppState>, id: String) -> Result<String> {
    state.with_project(|p| framework::export_csv(&p.conn, &id))
}
