use std::path::{Path, PathBuf};

use misket_core::db::backup;
use misket_core::db::OpenProject;
use misket_core::models::{BackupInfo, ProjectInfo};
use misket_core::{AppError, Result};
use tauri::{AppHandle, State};

use crate::state::AppState;

/// "Save a copy as…": a manual, on-demand copy of the open project to `path`.
#[tauri::command]
pub fn save_project_copy(state: State<'_, AppState>, path: String) -> Result<()> {
    state.with_project(|p| backup::save_copy(&p.conn, Path::new(&path)))
}

/// Every backup next to the open project, newest first.
#[tauri::command]
pub fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupInfo>> {
    state.with_project(|p| backup::list_backups(&p.path))
}

/// Replace the open project with `path` (one of its own backups): back up
/// the current state first (reason `pre-restore`), close, copy the backup
/// over the project file, then reopen.
#[tauri::command]
pub fn restore_backup(
    state: State<'_, AppState>,
    app: AppHandle,
    path: String,
) -> Result<ProjectInfo> {
    let backup_path = PathBuf::from(&path);
    let project_path = state.with_project(|p| {
        if same_file(&backup_path, &p.path) {
            return Err(AppError::Validation(
                "cannot restore a backup onto the project file itself".into(),
            ));
        }
        let keep = crate::settings::load(&app)
            .map(|s| s.keep_backups as usize)
            .unwrap_or(backup::DEFAULT_KEEP_BACKUPS);
        backup::backup_before(&p.conn, &p.path, "pre-restore", keep)?;
        Ok(p.path.clone())
    })?;

    // Close so the file handle is released before it is overwritten.
    {
        let mut guard = state
            .project
            .lock()
            .map_err(|_| AppError::Db("project lock poisoned".into()))?;
        *guard = None;
    }

    std::fs::copy(&backup_path, &project_path)?;
    let project = OpenProject::open(&project_path)?;
    super::project::install(&state, &app, project)
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}
