//! Codebook import: read a file, sniff JSON vs CSV, hand it to the core.

use misket_core::db::codebook_import;
use misket_core::models::{CodebookImport, CodebookJsonCode, ImportMode, ImportReport};
use misket_core::{AppError, Result};
use tauri::{AppHandle, State};

use crate::backup_guard;

use crate::state::AppState;

/// A `misket-codebook` JSON export starts with `{`; anything else is
/// treated as CSV (`name,parent,color,description,shortcut`).
fn sniff(text: String) -> Result<CodebookImport> {
    if text.trim_start().starts_with('{') {
        #[derive(serde::Deserialize)]
        struct CodebookDoc {
            #[serde(default)]
            codes: Vec<CodebookJsonCode>,
        }
        let doc: CodebookDoc = serde_json::from_str(&text)
            .map_err(|e| AppError::Validation(format!("invalid codebook JSON: {e}")))?;
        Ok(CodebookImport::Json { codes: doc.codes })
    } else {
        Ok(CodebookImport::Csv { text })
    }
}

#[tauri::command]
pub fn import_codebook(
    state: State<'_, AppState>,
    app: AppHandle,
    path: String,
    mode: String,
    parent_id: Option<String>,
) -> Result<ImportReport> {
    let text = std::fs::read_to_string(&path)?;
    let input = sniff(text)?;
    let mode = match mode.as_str() {
        "merge" => ImportMode::Merge,
        "add-under" => ImportMode::AddUnder { parent_id },
        other => {
            return Err(AppError::Validation(format!(
                "unknown import mode {other:?}"
            )))
        }
    };
    state.with_project(|p| {
        backup_guard::before(&app, p, "import-codebook");
        codebook_import::import_codebook(&p.conn, input, mode)
    })
}
