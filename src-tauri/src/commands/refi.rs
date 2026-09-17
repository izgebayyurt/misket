//! REFI-QDA (`.qdpx`) interchange (`misket_core::db::refi`).

use std::path::Path;

use misket_core::db::refi;
use misket_core::models::{RefiExportReport, RefiImportMode, RefiImportReport, RefiPreview};
use misket_core::{AppError, Result};
use tauri::{AppHandle, State};

use crate::backup_guard;
use crate::state::AppState;

/// Write the whole project as a `.qdpx` for NVivo, ATLAS.ti, MAXQDA and the
/// rest.
#[tauri::command]
pub fn export_refi(state: State<'_, AppState>, path: String) -> Result<RefiExportReport> {
    state.with_project(|p| refi::export_refi(&p.conn, Path::new(&path)))
}

/// What importing `path` would bring in. Reads the file and writes nothing.
#[tauri::command]
pub fn refi_preview(state: State<'_, AppState>, path: String) -> Result<RefiPreview> {
    state.with_project(|p| refi::preview_refi(&p.conn, Path::new(&path)))
}

/// Do it, as one undoable step. `mode` is `merge` or `replace`.
#[tauri::command]
pub fn import_refi(
    state: State<'_, AppState>,
    app: AppHandle,
    path: String,
    mode: String,
) -> Result<RefiImportReport> {
    let mode = match mode.as_str() {
        "merge" => RefiImportMode::Merge,
        "replace" => RefiImportMode::Replace,
        other => {
            return Err(AppError::Validation(format!(
                "unknown import mode {other:?}"
            )))
        }
    };
    state.with_project(|p| {
        backup_guard::before(&app, p, "import-refi");
        refi::import_refi(&p.conn, Path::new(&path), mode)
    })
}
