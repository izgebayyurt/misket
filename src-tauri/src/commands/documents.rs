use misket_core::db::documents;
use misket_core::models::{Document, DocumentSummary, NewDocument, NewImageDocument};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn create_document(state: State<'_, AppState>, input: NewDocument) -> Result<Document> {
    state.with_project(|p| documents::create(&p.conn, input))
}

/// Import an image. The bytes are copied into the project file; when the
/// frontend does not send them they are read from `sourcePath`, which avoids
/// pushing several megabytes back through the IPC bridge.
#[tauri::command]
pub fn create_image_document(
    state: State<'_, AppState>,
    input: NewImageDocument,
) -> Result<Document> {
    state.with_project(|p| documents::create_image(&p.conn, input))
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
