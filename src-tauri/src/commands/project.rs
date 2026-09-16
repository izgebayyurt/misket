use std::path::{Path, PathBuf};

use misket_core::db::{activity, stats, OpenProject};
use misket_core::models::{ProjectInfo, ProjectStats, RecentProject};
use misket_core::{AppError, Result};
use tauri::{AppHandle, Manager, State};

use crate::recent;
use crate::state::AppState;

pub(crate) fn install(
    state: &AppState,
    app: &AppHandle,
    project: OpenProject,
) -> Result<ProjectInfo> {
    let info = project.info()?;
    // Whoever opened it signs everything they do to it from here on.
    let actor = crate::settings::load(app)
        .map(|s| crate::settings::actor_name(&s))
        .unwrap_or_default();
    activity::set_actor(&project.conn, &actor)?;
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

/// Find a free `Misket sample.misket` (or `Misket sample (2).misket`, …) name
/// in `dir`, so trying the sample more than once never overwrites an earlier
/// copy.
fn unique_sample_path(dir: &Path) -> PathBuf {
    let candidate = dir.join("Misket sample.misket");
    if !candidate.exists() {
        return candidate;
    }
    let mut n = 2;
    loop {
        let candidate = dir.join(format!("Misket sample ({n}).misket"));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// Create the bundled sample project ("Try Misket with sample data") and open
/// it. Defaults to the user's documents folder (falling back to the app's
/// data folder), or `dir` when given.
#[tauri::command]
pub fn create_sample_project(
    state: State<'_, AppState>,
    app: AppHandle,
    dir: Option<String>,
) -> Result<ProjectInfo> {
    let base = match dir {
        Some(d) => PathBuf::from(d),
        None => app
            .path()
            .document_dir()
            .or_else(|_| app.path().app_data_dir())
            .map_err(|e| AppError::Io(e.to_string()))?,
    };
    std::fs::create_dir_all(&base)?;
    let path = unique_sample_path(&base);
    misket_core::sample::create_sample_project(&path)?;
    let project = OpenProject::open(&path)?;
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

/// Rename the open project and refresh its entry in the recent list.
#[tauri::command]
pub fn rename_project(
    state: State<'_, AppState>,
    app: AppHandle,
    name: String,
) -> Result<ProjectInfo> {
    let info = state.with_project(|p| p.rename(&name))?;
    recent::touch(&app, &info.path, &info.name)?;
    Ok(info)
}

#[tauri::command]
pub fn get_project_stats(state: State<'_, AppState>) -> Result<ProjectStats> {
    state.with_project(|p| stats::project_stats(&p.conn))
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

/// Write text the frontend produced (a CSV export) to a path the user picked
/// in the save dialog, so the webview never needs filesystem permissions.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<()> {
    std::fs::write(&path, contents)?;
    Ok(())
}
