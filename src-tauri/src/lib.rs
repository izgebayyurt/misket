mod commands;
mod recent;
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::project::create_project,
            commands::project::open_project,
            commands::project::close_project,
            commands::project::get_project_info,
            commands::project::list_recent_projects,
            commands::project::remove_recent_project,
            commands::project::read_source_file,
            commands::documents::create_document,
            commands::documents::list_documents,
            commands::documents::get_document,
            commands::documents::rename_document,
            commands::documents::reorder_documents,
            commands::documents::delete_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Misket");
}
