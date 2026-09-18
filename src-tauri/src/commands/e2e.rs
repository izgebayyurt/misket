//! Test-only startup configuration, read from environment variables so the
//! smoke test can skip native dialogs. Absent in normal use.

use serde::Serialize;

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct E2eConfig {
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub import_paths: Vec<String>,
    /// A copy to pull from, so the smoke test never opens a native file
    /// chooser (`MISKET_E2E_PULL`).
    pub pull_path: Option<String>,
    /// A `.qdpx` to import, for the same reason (`MISKET_E2E_REFI`).
    pub refi_path: Option<String>,
    /// Throw a frontend error on startup (`MISKET_E2E_CRASH_TEST`), so the
    /// error boundary and the log viewer can be exercised headlessly.
    pub trigger_frontend_error: bool,
    /// A `latest.json` URL (typically `http://127.0.0.1:<port>/latest.json`)
    /// to check against instead of the real updater endpoint, so the
    /// "update available" banner can be exercised without a signed release
    /// (`MISKET_E2E_UPDATE_JSON`; see `commands::updater::e2e_check_update`).
    pub update_json_url: Option<String>,
}

#[tauri::command]
pub fn get_e2e_config() -> E2eConfig {
    // Updates can be checked from the start screen, before any project is
    // open, so this one field is read unconditionally.
    let update_json_url = std::env::var("MISKET_E2E_UPDATE_JSON")
        .ok()
        .filter(|s| !s.is_empty());
    let project_path = std::env::var("MISKET_E2E_PROJECT")
        .ok()
        .filter(|s| !s.is_empty());
    if project_path.is_none() {
        return E2eConfig {
            update_json_url,
            ..E2eConfig::default()
        };
    }
    E2eConfig {
        project_path,
        project_name: std::env::var("MISKET_E2E_NAME").ok(),
        import_paths: std::env::var("MISKET_E2E_IMPORT")
            .ok()
            .map(|s| {
                s.split(',')
                    .filter(|p| !p.is_empty())
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default(),
        pull_path: std::env::var("MISKET_E2E_PULL")
            .ok()
            .filter(|s| !s.is_empty()),
        refi_path: std::env::var("MISKET_E2E_REFI")
            .ok()
            .filter(|s| !s.is_empty()),
        trigger_frontend_error: std::env::var("MISKET_E2E_CRASH_TEST").is_ok(),
        update_json_url,
    }
}
