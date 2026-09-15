//! Recently opened projects, stored as JSON in the app config directory.

use std::path::PathBuf;

use misket_core::models::RecentProject;
use misket_core::Result;
use tauri::{AppHandle, Manager};

const MAX_RECENT: usize = 12;

fn file(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| misket_core::AppError::Io(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("recent.json"))
}

pub fn list(app: &AppHandle) -> Result<Vec<RecentProject>> {
    let path = file(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn save(app: &AppHandle, items: &[RecentProject]) -> Result<()> {
    std::fs::write(file(app)?, serde_json::to_string_pretty(items)?)?;
    Ok(())
}

pub fn touch(app: &AppHandle, path: &str, name: &str) -> Result<()> {
    let mut items: Vec<RecentProject> = list(app)?.into_iter().filter(|r| r.path != path).collect();
    items.insert(
        0,
        RecentProject {
            path: path.to_string(),
            name: name.to_string(),
            last_opened_at: misket_core::db::util::now(),
        },
    );
    items.truncate(MAX_RECENT);
    save(app, &items)
}

pub fn remove(app: &AppHandle, path: &str) -> Result<()> {
    let items: Vec<RecentProject> = list(app)?.into_iter().filter(|r| r.path != path).collect();
    save(app, &items)
}
