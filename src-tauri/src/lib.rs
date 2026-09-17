mod backup_guard;
mod commands;
mod media;
mod recent;
mod settings;
mod state;

use media::MEDIA_PROTOCOL;
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
        .register_asynchronous_uri_scheme_protocol(MEDIA_PROTOCOL, |ctx, request, responder| {
            // Reading a blob locks the project and reading a slice of a
            // recording touches the disk, so answer off the UI thread.
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            let range = request
                .headers()
                .get(tauri::http::header::RANGE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            std::thread::spawn(move || {
                responder.respond(media::response(&app, &path, range.as_deref()))
            });
        })
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
            commands::project::create_sample_project,
            commands::project::open_project,
            commands::project::close_project,
            commands::project::get_project_info,
            commands::project::rename_project,
            commands::project::get_project_stats,
            commands::project::list_recent_projects,
            commands::project::remove_recent_project,
            commands::project::read_source_file,
            commands::project::write_text_file,
            commands::project::write_binary_file,
            commands::project::take_pending_open_path,
            commands::documents::create_document,
            commands::documents::create_image_document,
            commands::media::stage_media_probe,
            commands::media::create_media_document,
            commands::media::relink_media_document,
            commands::media::set_media_peaks,
            commands::media::set_excerpt_thumbnail,
            commands::media::list_missing_media,
            commands::documents::list_documents,
            commands::documents::get_document,
            commands::documents::rename_document,
            commands::documents::reorder_documents,
            commands::transcripts::get_transcript,
            commands::transcripts::preview_transcript,
            commands::transcripts::set_transcript_format,
            commands::transcripts::get_transcript_default,
            commands::transcripts::set_transcript_default,
            commands::transcripts::list_project_speakers,
            commands::documents::delete_document,
            commands::documents::list_importable_files,
            commands::coders::list_coders,
            commands::coders::local_coder_id,
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
            commands::excerpts::in_vivo_code,
            commands::excerpts::list_document_excerpts,
            commands::excerpts::get_excerpt,
            commands::excerpts::add_excerpt_codes,
            commands::excerpts::remove_excerpt_code,
            commands::excerpts::delete_excerpt,
            commands::excerpts::restore_excerpt,
            commands::excerpts::query_excerpts,
            commands::excerpts::update_excerpt_range,
            commands::excerpts::split_excerpt,
            commands::excerpts::merge_excerpts,
            commands::excerpts::delete_excerpts,
            commands::excerpts::add_codes_to_excerpts,
            commands::excerpts::remove_codes_from_excerpts,
            commands::excerpts::retag_code,
            commands::excerpts::auto_code,
            commands::analysis::code_frequencies,
            commands::analysis::co_occurrence,
            commands::analysis::code_by_document,
            commands::analysis::word_frequencies,
            commands::analysis::get_stop_words,
            commands::analysis::set_stop_words,
            commands::analysis::code_timeline,
            commands::framework::list_framework_matrices,
            commands::framework::get_framework_matrix,
            commands::framework::create_framework_matrix,
            commands::framework::update_framework_matrix,
            commands::framework::delete_framework_matrix,
            commands::framework::set_framework_cell,
            commands::framework::export_framework_csv,
            commands::analysis::code_by_descriptor,
            commands::irr::irr_compare,
            commands::irr::irr_export_csv,
            commands::search::search_project,
            commands::sets::list_sets,
            commands::sets::create_set,
            commands::sets::rename_set,
            commands::sets::delete_set,
            commands::sets::list_set_members,
            commands::sets::set_set_members,
            commands::sets::add_to_set,
            commands::sets::remove_from_set,
            commands::sets::list_saved_filters,
            commands::sets::save_filter,
            commands::sets::delete_saved_filter,
            commands::memos::list_memos,
            commands::memos::create_memo,
            commands::memos::update_memo,
            commands::memos::delete_memo,
            commands::memos::restore_memo,
            commands::activity::list_activity,
            commands::activity::code_history,
            commands::activity::excerpt_history,
            commands::history::history_undo,
            commands::history::history_redo,
            commands::history::history_checkout,
            commands::history::history_tree,
            commands::history::history_fork,
            commands::history::history_rename_branch,
            commands::history::history_compact,
            commands::history::history_begin_group,
            commands::history::history_end_group,
            commands::export::export_activity_csv,
            commands::export::export_codebook_csv,
            commands::export::export_excerpts_csv,
            commands::export::export_project_json,
            commands::export::export_codebook_json,
            commands::codebook::import_codebook,
            commands::refi::export_refi,
            commands::refi::refi_preview,
            commands::refi::import_refi,
            commands::merge::merge_preview,
            commands::merge::merge_apply,
            commands::e2e::get_e2e_config,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::backup::save_project_copy,
            commands::backup::list_backups,
            commands::backup::restore_backup,
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
