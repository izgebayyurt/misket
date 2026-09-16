use misket_core::Result;
use tauri::AppHandle;

use crate::settings::AppSettings;

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<AppSettings> {
    crate::settings::load(&app)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: AppSettings) -> Result<()> {
    crate::settings::save(&app, &settings)
}
