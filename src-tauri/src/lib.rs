mod commands;
mod recent;
mod state;

use state::AppState;
use tauri::{Emitter, Manager};

/// Event name for "open this project file" requests arriving while running.
pub const OPEN_FILE_EVENT: &str = "misket://open-file";

fn is_project_path(p: &str) -> bool {
    std::path::Path::new(p)
        .extension()
        .map(|e| e.eq_ignore_ascii_case("misket"))
        .unwrap_or(false)
}

/// Queue a project path to open; the frontend picks it up on startup, or
/// receives an event if it is already running.
fn request_open(app: &tauri::AppHandle, path: String) {
    let state = app.state::<AppState>();
    if let Ok(mut pending) = state.pending_open.lock() {
        *pending = Some(path.clone());
    }
    let _ = app.emit(OPEN_FILE_EVENT, path);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            // Windows and Linux pass a double-clicked file as the first argument.
            if let Some(arg) = std::env::args().nth(1) {
                if is_project_path(&arg) {
                    request_open(app.handle(), arg);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::create_project,
            commands::project::open_project,
            commands::project::close_project,
            commands::project::get_project_info,
            commands::project::list_recent_projects,
            commands::project::remove_recent_project,
            commands::project::read_source_file,
            commands::project::take_pending_open_path,
            commands::documents::create_document,
            commands::documents::list_documents,
            commands::documents::get_document,
            commands::documents::rename_document,
            commands::documents::reorder_documents,
            commands::documents::delete_document,
            commands::codes::list_codes,
            commands::codes::create_code,
            commands::codes::update_code,
            commands::codes::move_code,
            commands::codes::delete_code,
            commands::codes::merge_code,
            commands::codes::count_code_impact,
            commands::descriptors::list_descriptor_fields,
            commands::descriptors::create_descriptor_field,
            commands::descriptors::update_descriptor_field,
            commands::descriptors::delete_descriptor_field,
            commands::descriptors::reorder_descriptor_fields,
            commands::descriptors::set_descriptor_value,
            commands::descriptors::list_document_descriptor_values,
            commands::descriptors::get_descriptor_matrix,
            commands::excerpts::apply_codes,
            commands::excerpts::list_document_excerpts,
            commands::excerpts::get_excerpt,
            commands::excerpts::add_excerpt_codes,
            commands::excerpts::remove_excerpt_code,
            commands::excerpts::delete_excerpt,
            commands::excerpts::restore_excerpt,
            commands::excerpts::query_excerpts,
            commands::memos::list_memos,
            commands::memos::create_memo,
            commands::memos::update_memo,
            commands::memos::delete_memo,
            commands::memos::restore_memo,
            commands::export::export_codebook_csv,
            commands::export::export_excerpts_csv,
            commands::export::export_project_json,
            commands::e2e::get_e2e_config,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Misket");

    app.run(|app_handle, event| {
        // macOS delivers double-clicked / "Open with" files here, both at
        // launch and while the app is already running.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let path = path.to_string_lossy().into_owned();
                    if is_project_path(&path) {
                        request_open(app_handle, path);
                    }
                }
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        let _ = (app_handle, event);
    });
}
