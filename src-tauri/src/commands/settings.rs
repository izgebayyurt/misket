use misket_core::db::activity;
use misket_core::{AppError, Result};
use tauri::{AppHandle, State};

use crate::settings::AppSettings;
use crate::state::AppState;

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<AppSettings> {
    crate::settings::load(&app)
}

#[tauri::command]
pub fn set_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<()> {
    crate::settings::save(&app, &settings)?;
    // A renamed coder signs the rest of this session, without reopening.
    match state
        .with_project(|p| activity::set_actor(&p.conn, &crate::settings::actor_name(&settings)))
    {
        Ok(()) | Err(AppError::NoProjectOpen) => Ok(()),
        Err(e) => Err(e),
    }
}
