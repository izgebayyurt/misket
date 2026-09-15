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
            commands::codes::list_codes,
            commands::codes::create_code,
            commands::codes::update_code,
            commands::codes::move_code,
            commands::codes::delete_code,
            commands::codes::merge_code,
            commands::codes::count_code_impact,
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
            commands::e2e::get_e2e_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Misket");
}
