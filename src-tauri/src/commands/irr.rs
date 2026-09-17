use std::fs;

use misket_core::db::irr;
use misket_core::models::{IrrReport, IrrRequest};
use misket_core::Result;
use tauri::State;

use crate::state::AppState;

/// Compare two coders; see `misket_core::db::irr` for the unit rule and the
/// formulas.
#[tauri::command]
pub fn irr_compare(state: State<'_, AppState>, request: IrrRequest) -> Result<IrrReport> {
    state.with_project(|p| irr::compare(&p.conn, &request))
}

/// The same comparison as a CSV file: the per-code table, the pooled rows and
/// the parameters that produced them.
#[tauri::command]
pub fn irr_export_csv(state: State<'_, AppState>, request: IrrRequest, path: String) -> Result<()> {
    let csv = state.with_project(|p| irr::export_csv(&p.conn, &request))?;
    Ok(fs::write(&path, csv)?)
}
