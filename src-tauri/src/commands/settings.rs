use misket_core::db::{activity, coders};
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
    // A renamed or recoloured coder signs the rest of this session, and the
    // open project's `coders` row follows, without reopening.
    let (_, me) = crate::settings::coder(&app, &settings);
    match state.with_project(|p| {
        activity::set_actor(&p.conn, &me.name)?;
        coders::ensure_local(&p.conn, &me.id, &me.name, &me.color)?;
        Ok(())
    }) {
        Ok(()) | Err(AppError::NoProjectOpen) => Ok(()),
        Err(e) => Err(e),
    }
}
