use std::fs::File;
use std::io::BufWriter;

use misket_core::db::export;
use misket_core::models::ExcerptFilter;
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

#[tauri::command]
pub fn export_codebook_csv(state: State<'_, AppState>, path: String) -> Result<()> {
    state.with_project(|p| export::codebook_csv(&p.conn, BufWriter::new(File::create(&path)?)))
}

#[tauri::command]
pub fn export_excerpts_csv(
    state: State<'_, AppState>,
    path: String,
    filter: ExcerptFilter,
) -> Result<()> {
    state.with_project(|p| {
        export::excerpts_csv(&p.conn, &filter, BufWriter::new(File::create(&path)?))
    })
}

#[tauri::command]
pub fn export_project_json(state: State<'_, AppState>, path: String) -> Result<()> {
    state.with_project(|p| export::project_json(&p.conn, BufWriter::new(File::create(&path)?)))
}

#[tauri::command]
pub fn export_codebook_json(state: State<'_, AppState>, path: String) -> Result<()> {
    state.with_project(|p| export::codebook_json(&p.conn, BufWriter::new(File::create(&path)?)))
}
