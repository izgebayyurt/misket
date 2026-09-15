//! Test-only startup configuration, read from environment variables so the
//! smoke test can skip native dialogs. Absent in normal use.

use serde::Serialize;

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct E2eConfig {
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub import_paths: Vec<String>,
}

#[tauri::command]
pub fn get_e2e_config() -> E2eConfig {
    let project_path = std::env::var("MISKET_E2E_PROJECT")
        .ok()
        .filter(|s| !s.is_empty());
    if project_path.is_none() {
        return E2eConfig::default();
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
    }
}
