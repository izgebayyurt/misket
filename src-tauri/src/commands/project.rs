use std::path::Path;

use misket_core::db::OpenProject;
use misket_core::models::{ProjectInfo, RecentProject};
use misket_core::{AppError, Result};
use tauri::{AppHandle, State};

use crate::recent;
use crate::state::AppState;

fn install(state: &AppState, app: &AppHandle, project: OpenProject) -> Result<ProjectInfo> {
    let info = project.info()?;
    recent::touch(app, &info.path, &info.name)?;
    let mut guard = state
        .project
        .lock()
        .map_err(|_| AppError::Db("project lock poisoned".into()))?;
    *guard = Some(project);
    Ok(info)
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    app: AppHandle,
    path: String,
    name: String,
) -> Result<ProjectInfo> {
    let version = app.package_info().version.to_string();
    let project = OpenProject::create(Path::new(&path), &name, &version)?;
    install(&state, &app, project)
}

#[tauri::command]
pub fn open_project(
    state: State<'_, AppState>,
    app: AppHandle,
    path: String,
) -> Result<ProjectInfo> {
    let project = OpenProject::open(Path::new(&path))?;
    install(&state, &app, project)
}

#[tauri::command]
pub fn close_project(state: State<'_, AppState>) -> Result<()> {
    let mut guard = state
        .project
        .lock()
        .map_err(|_| AppError::Db("project lock poisoned".into()))?;
    *guard = None;
    Ok(())
}

#[tauri::command]
pub fn get_project_info(state: State<'_, AppState>) -> Result<Option<ProjectInfo>> {
    match state.with_project(|p| p.info()) {
        Ok(info) => Ok(Some(info)),
        Err(AppError::NoProjectOpen) => Ok(None),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn list_recent_projects(app: AppHandle) -> Result<Vec<RecentProject>> {
    recent::list(&app)
}

#[tauri::command]
pub fn remove_recent_project(app: AppHandle, path: String) -> Result<()> {
    recent::remove(&app, &path)
}

/// The project path the OS asked us to open at launch, if any (consumed once).
#[tauri::command]
pub fn take_pending_open_path(state: State<'_, AppState>) -> Result<Option<String>> {
    let mut pending = state
        .pending_open
        .lock()
        .map_err(|_| AppError::Db("pending-open lock poisoned".into()))?;
    Ok(pending.take())
}

/// Raw bytes of a file the user picked in a dialog; importers parse them in TS.
#[tauri::command]
pub fn read_source_file(path: String) -> Result<tauri::ipc::Response> {
    let bytes = std::fs::read(&path)?;
    Ok(tauri::ipc::Response::new(bytes))
}
