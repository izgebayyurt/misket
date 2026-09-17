//! Support for PDF OCR (roadmap #46): where dropped-in Tesseract language
//! files live, and seeding the bundled `eng.traineddata` into that same
//! directory so the webview can reach both through one asset-protocol URL.
//! The actual recognition runs in the webview (tesseract.js); this module
//! only manages the `tessdata` folder on disk.

use std::path::PathBuf;

use base64::Engine;
use misket_core::{AppError, Result};
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Where a person drops additional `<code>.traineddata` files:
/// `<app data dir>/tessdata`. Created on first use.
fn tessdata_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?
        .join("tessdata");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TessdataInfo {
    /// Absolute path to the tessdata folder, shown in Settings so a person
    /// knows where to put files.
    pub dir: String,
    /// Language codes found as `<code>.traineddata` in `dir`, other than
    /// `eng` (bundled with the app, and always offered).
    pub languages: Vec<String>,
}

/// List the extra languages a person has dropped into the tessdata folder.
#[tauri::command]
pub fn list_tessdata_languages(app: AppHandle) -> Result<TessdataInfo> {
    let dir = tessdata_dir(&app)?;
    let mut languages = Vec::new();
    for entry in std::fs::read_dir(&dir)?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("traineddata") {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            if stem != "eng" {
                languages.push(stem.to_string());
            }
        }
    }
    languages.sort();
    Ok(TessdataInfo {
        dir: dir.to_string_lossy().into_owned(),
        languages,
    })
}

/// A bare file name with no path separators or `..` segments — what a
/// tessdata file name must look like, since it is joined onto a directory
/// path without going through a picker or any other validation.
fn is_bare_filename(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..")
}

/// Write `data_base64` to `<tessdata dir>/<filename>`, but only when that
/// file isn't already there. Used once to copy the bundled `eng.traineddata`
/// (fetched by the frontend from its own static asset) into the same
/// directory a dropped-in language file would live in, so OCR can serve
/// every language through a single asset-protocol `langPath`. Never
/// overwrites a file the person put there themselves. Base64 rather than a
/// raw byte array because Tauri's `invoke` JSON-encodes command arguments —
/// a byte array would blow up the ~4 MB `eng.traineddata` to a multi-million-
/// element JSON array; base64 keeps it as a single, much smaller string.
#[tauri::command]
pub fn ensure_tessdata_file(
    app: AppHandle,
    filename: String,
    data_base64: String,
) -> Result<String> {
    if !is_bare_filename(&filename) {
        return Err(AppError::Validation(format!(
            "not a valid tessdata file name: {filename}"
        )));
    }
    let dir = tessdata_dir(&app)?;
    let path = dir.join(&filename);
    if !path.exists() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data_base64)
            .map_err(|e| AppError::Validation(format!("invalid base64 data: {e}")))?;
        std::fs::write(&path, bytes)?;
    }
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_plain_traineddata_filename() {
        assert!(is_bare_filename("eng.traineddata"));
        assert!(is_bare_filename("tur.traineddata"));
    }

    #[test]
    fn rejects_filenames_that_would_escape_the_tessdata_dir() {
        for bad in [
            "../evil.traineddata",
            "a/b.traineddata",
            "a\\b.traineddata",
            "..",
            "",
        ] {
            assert!(!is_bare_filename(bad), "expected {bad:?} to be rejected");
        }
    }
}
