use std::path::{Path, PathBuf};

use misket_core::db::documents;
use misket_core::models::{Document, DocumentSummary, NewDocument};
use misket_core::{AppError, Result};
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn create_document(state: State<'_, AppState>, input: NewDocument) -> Result<Document> {
    state.with_project(|p| documents::create(&p.conn, input))
}

#[tauri::command]
pub fn list_documents(state: State<'_, AppState>) -> Result<Vec<DocumentSummary>> {
    state.with_project(|p| documents::list(&p.conn))
}

#[tauri::command]
pub fn get_document(state: State<'_, AppState>, id: String) -> Result<Document> {
    state.with_project(|p| documents::get(&p.conn, &id))
}

#[tauri::command]
pub fn rename_document(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<DocumentSummary> {
    state.with_project(|p| documents::rename(&p.conn, &id, &name))
}

#[tauri::command]
pub fn reorder_documents(state: State<'_, AppState>, ids: Vec<String>) -> Result<()> {
    state.with_project(|p| documents::reorder(&p.conn, &ids))
}

#[tauri::command]
pub fn delete_document(state: State<'_, AppState>, id: String) -> Result<()> {
    state.with_project(|p| documents::delete(&p.conn, &id))
}

/// Extensions the importers in `src/core/importers` can parse. Keep in sync
/// with `SUPPORTED_EXTENSIONS` there.
const IMPORTABLE_EXTENSIONS: [&str; 5] = ["txt", "md", "markdown", "docx", "pdf"];

fn is_importable(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            IMPORTABLE_EXTENSIONS
                .iter()
                .any(|s| e.eq_ignore_ascii_case(s))
        })
        .unwrap_or(false)
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with('.'))
        .unwrap_or(false)
}

fn collect(dir: &Path, recursive: bool, out: &mut Vec<PathBuf>) -> Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if is_hidden(&path) {
            continue;
        }
        // `file_type` does not follow symlinks, so a link back up the tree
        // is neither descended into nor imported.
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            if recursive {
                collect(&path, recursive, out)?;
            }
        } else if file_type.is_file() && is_importable(&path) {
            out.push(path);
        }
    }
    Ok(())
}

/// Every file in `dir` an importer can read, sorted by file name (then by full
/// path, so a recursive walk stays stable). Hidden files and folders are
/// skipped; the frontend feeds the result through the normal import pipeline.
#[tauri::command]
pub fn list_importable_files(dir: String, recursive: bool) -> Result<Vec<String>> {
    let root = Path::new(&dir);
    if !root.is_dir() {
        return Err(AppError::NotFound(format!("no folder at {dir}")));
    }
    let mut paths = vec![];
    collect(root, recursive, &mut paths)?;
    paths.sort_by_cached_key(|p| {
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        (name, p.to_string_lossy().to_lowercase())
    });
    Ok(paths
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_supported_files_sorted_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for name in ["b.txt", "a.md", "C.PDF", "notes.rtf", ".hidden.txt"] {
            std::fs::write(root.join(name), b"x").unwrap();
        }
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/deep.docx"), b"x").unwrap();
        std::fs::create_dir(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/config.md"), b"x").unwrap();

        let names = |recursive: bool| -> Vec<String> {
            list_importable_files(root.to_string_lossy().into_owned(), recursive)
                .unwrap()
                .into_iter()
                .map(|p| {
                    Path::new(&p)
                        .file_name()
                        .unwrap()
                        .to_string_lossy()
                        .into_owned()
                })
                .collect()
        };
        assert_eq!(names(false), ["a.md", "b.txt", "C.PDF"]);
        assert_eq!(names(true), ["a.md", "b.txt", "C.PDF", "deep.docx"]);
        assert!(matches!(
            list_importable_files("/definitely/not/here".into(), false),
            Err(AppError::NotFound(_))
        ));
    }
}
