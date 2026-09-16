use misket_core::db::descriptors;
use misket_core::models::{
    DescriptorField, DescriptorFieldPatch, DescriptorMatrix, DescriptorValue, NewDescriptorField,
};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn list_descriptor_fields(state: State<'_, AppState>) -> Result<Vec<DescriptorField>> {
    state.with_project(|p| descriptors::list_fields(&p.conn))
}

#[tauri::command]
pub fn create_descriptor_field(
    state: State<'_, AppState>,
    input: NewDescriptorField,
) -> Result<DescriptorField> {
    state.with_project(|p| descriptors::create_field(&p.conn, input))
}

#[tauri::command]
pub fn update_descriptor_field(
    state: State<'_, AppState>,
    id: String,
    patch: DescriptorFieldPatch,
) -> Result<DescriptorField> {
    state.with_project(|p| descriptors::update_field(&p.conn, &id, patch))
}

#[tauri::command]
pub fn delete_descriptor_field(state: State<'_, AppState>, id: String) -> Result<DescriptorField> {
    state.with_project(|p| descriptors::delete_field(&p.conn, &id))
}

#[tauri::command]
pub fn reorder_descriptor_fields(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Vec<DescriptorField>> {
    state.with_project(|p| descriptors::reorder_fields(&p.conn, &ids))
}

#[tauri::command]
pub fn set_descriptor_value(
    state: State<'_, AppState>,
    document_id: String,
    field_id: String,
    value: Option<String>,
) -> Result<Option<DescriptorValue>> {
    state.with_project(|p| {
        descriptors::set_value(&p.conn, &document_id, &field_id, value.as_deref())
    })
}

#[tauri::command]
pub fn list_document_descriptor_values(
    state: State<'_, AppState>,
    document_id: String,
) -> Result<Vec<DescriptorValue>> {
    state.with_project(|p| descriptors::values_for_document(&p.conn, &document_id))
}

#[tauri::command]
pub fn get_descriptor_matrix(state: State<'_, AppState>) -> Result<DescriptorMatrix> {
    state.with_project(|p| descriptors::values_matrix(&p.conn))
}
