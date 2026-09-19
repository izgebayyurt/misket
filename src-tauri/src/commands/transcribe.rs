//! Commands for offline transcription (roadmap 26): the model library in
//! Settings, and running a recording through Whisper.
//!
//! Both the download and the transcription itself are long jobs, so both run
//! on their own thread and report back with events rather than blocking an
//! `invoke`. The frontend starts them, listens, and can cancel; the cancel
//! flags live in [`AppState`].

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;

use misket_core::db::{align, documents, history, OpenProject};
use misket_core::models::{Document, NewDocument};
use misket_core::{AppError, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::settings;
use crate::state::AppState;
use crate::transcribe::{self, models, Anchor, Layout, Progress, Support, TranscribeRequest};

/// `{documentId, percent, segmentsDone, eta}` while a transcription runs.
const PROGRESS_EVENT: &str = "transcription:progress";
/// `{documentId, status, ...}` once it has stopped, however it stopped.
const DONE_EVENT: &str = "transcription:done";
const MODEL_PROGRESS_EVENT: &str = "whisper-model:progress";
const MODEL_DONE_EVENT: &str = "whisper-model:done";

/// The source format a transcript document is recorded under, so the document
/// list badges it and an export says where the text came from.
const TRANSCRIPT_FORMAT: &str = "whisper";

/// Set to any non-empty value to run transcription against a stand-in engine
/// instead of a real model. Only the headless smoke test does this; see
/// `transcribe::engine::StubEngine`.
const STUB_ENV: &str = "MISKET_E2E_WHISPER_STUB";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    document_id: String,
    percent: u8,
    segments_done: u32,
    /// Seconds still to go, once there is enough done to guess. `None` until
    /// then, rather than a wild number that jumps around.
    eta: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoneEvent {
    document_id: String,
    /// `done`, `cancelled` or `failed`.
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    transcript_document_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transcript_name: Option<String>,
    /// The segment anchors (`{pos, ms}`). Nothing stores them yet — the
    /// column that will is coming with transcript alignment (roadmap 18) —
    /// so they are handed to the frontend, which is where the seek-on-click
    /// behaviour will want them.
    #[serde(skip_serializing_if = "Option::is_none")]
    anchors: Option<Vec<Anchor>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelProgressEvent {
    id: String,
    received: u64,
    total: u64,
    percent: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDoneEvent {
    id: String,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn app_models_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    models::models_dir(&base)
}

/// What this build can do: whether it was compiled with transcription at all,
/// whether ffmpeg is around for video, the thread default, and the languages
/// the dialog offers.
#[tauri::command]
pub fn transcription_support() -> Support {
    transcribe::support()
}

/// The model table in Settings → Transcription.
#[tauri::command]
pub fn list_whisper_models(app: AppHandle) -> Result<models::ModelLibrary> {
    let dir = app_models_dir(&app)?;
    let selected = settings::load(&app)
        .ok()
        .and_then(|s| s.whisper_model)
        .filter(|s| !s.is_empty());
    models::library(&dir, selected.as_deref())
}

/// Start downloading `id`. Returns at once; watch `whisper-model:progress`
/// and `whisper-model:done`.
#[tauri::command]
pub fn download_whisper_model(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<()> {
    if models::spec(&id).is_none() {
        return Err(AppError::Validation(format!(
            "\"{id}\" is not a model Misket knows how to download"
        )));
    }
    let dir = app_models_dir(&app)?;
    let cancel = state.start_job(&state.model_downloads, &id)?;
    let handle = app.clone();
    std::thread::spawn(move || {
        let emit = {
            let handle = handle.clone();
            let id = id.clone();
            move |received: u64, total: u64| {
                let percent = (received.min(total) * 100).checked_div(total).unwrap_or(0) as u8;
                let _ = handle.emit(
                    MODEL_PROGRESS_EVENT,
                    ModelProgressEvent {
                        id: id.clone(),
                        received,
                        total,
                        percent,
                    },
                );
            }
        };
        let flag = cancel.clone();
        let outcome = models::download(&dir, &id, emit, &move || flag.load(Ordering::Relaxed));
        let state = handle.state::<AppState>();
        state.finish_job(&state.model_downloads, &id);
        let event = match outcome {
            Ok(_) => ModelDoneEvent {
                id: id.clone(),
                status: "done",
                message: None,
            },
            Err(e) if cancel.load(Ordering::Relaxed) => ModelDoneEvent {
                id: id.clone(),
                status: "cancelled",
                message: Some(e.to_string()),
            },
            Err(e) => {
                tracing::warn!(model = %id, error = %e, "whisper model download failed");
                ModelDoneEvent {
                    id: id.clone(),
                    status: "failed",
                    message: Some(e.to_string()),
                }
            }
        };
        let _ = handle.emit(MODEL_DONE_EVENT, event);
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_whisper_model_download(state: State<'_, AppState>, id: String) {
    state.cancel_job(&state.model_downloads, &id);
}

/// Delete an installed model and, if it was the chosen one, forget the
/// choice.
#[tauri::command]
pub fn delete_whisper_model(app: AppHandle, id: String) -> Result<()> {
    let dir = app_models_dir(&app)?;
    models::remove(&dir, &id)?;
    if let Ok(mut s) = settings::load(&app) {
        if s.whisper_model.as_deref() == Some(id.as_str()) {
            s.whisper_model = None;
            let _ = settings::save(&app, &s);
        }
    }
    Ok(())
}

/// Copy a model file a person picked into the models folder ("Add model
/// file…"), for a machine that cannot reach Hugging Face. Returns the id it
/// is now known by.
#[tauri::command]
pub fn add_whisper_model_file(app: AppHandle, path: String) -> Result<String> {
    let dir = app_models_dir(&app)?;
    models::add_from_file(&dir, Path::new(&path))
}

/// Re-check an installed model against its published digest. `None` for a
/// hand-added model, which has no digest to check against.
#[tauri::command]
pub fn verify_whisper_model(app: AppHandle, id: String) -> Result<Option<bool>> {
    let dir = app_models_dir(&app)?;
    models::verify(&dir, &id)
}

/// Where the recording behind `document_id` actually is, or a clear error.
fn recording_path(state: &AppState, document_id: &str) -> Result<(String, PathBuf)> {
    state.with_project(|p| {
        let doc = documents::get_summary(&p.conn, document_id)?;
        if doc.kind != documents::MEDIA_KIND {
            return Err(AppError::Validation(
                "only audio and video documents can be transcribed".into(),
            ));
        }
        let path = doc
            .source_path
            .clone()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::NotFound("this recording has no file".into()))?;
        if doc.media_missing {
            return Err(AppError::NotFound(format!(
                "the file for \"{}\" is not where Misket left it; relink it first",
                doc.name
            )));
        }
        Ok((doc.name, PathBuf::from(path)))
    })
}

/// Build the engine this run should use: the stub when the headless smoke
/// test asks for it, otherwise the chosen model.
fn engine_for(app: &AppHandle, request: &TranscribeRequest) -> Result<Box<dyn transcribe::Engine>> {
    if std::env::var(STUB_ENV).is_ok_and(|v| !v.is_empty()) {
        return Ok(Box::new(transcribe::engine::StubEngine::default()));
    }
    let chosen = request
        .model
        .clone()
        .or_else(|| settings::load(app).ok().and_then(|s| s.whisper_model))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::NotFound(
                "no transcription model is installed. Open Settings → Transcription and \
                 download one (Tiny is 75 MiB and enough to try it), or add a ggml model \
                 file you already have."
                    .into(),
            )
        })?;
    let dir = app_models_dir(app)?;
    let path = models::installed_path(&dir, &chosen)?;
    transcribe::engine::load(&path)
}

/// Write a finished transcription into the project: the text document, its
/// anchors, and the link back to the recording.
///
/// All three are **one step in the undo tree**. A transcript sitting in the
/// project unlinked from the recording it came from is not a state anyone
/// asked for, so undo should not stop there — one `Ctrl`/`⌘`+`Z` takes the
/// whole transcription back, and one redo brings it back linked.
fn save_transcript(
    project: &OpenProject,
    recording_id: &str,
    recording_name: &str,
    source_path: Option<String>,
    result: &transcribe::TranscriptionResult,
) -> Result<Document> {
    history::group(
        &project.conn,
        &format!("Transcribed \"{recording_name}\""),
        |conn| {
            let document = documents::create(
                conn,
                NewDocument {
                    name: transcribe::format::transcript_name(recording_name),
                    source_path,
                    source_format: TRANSCRIPT_FORMAT.into(),
                    text: result.text.clone(),
                    // Two recordings of the same words would otherwise collide on
                    // the content hash.
                    allow_duplicate: true,
                    // Segment starts, so the transcript is aligned to its
                    // recording from the moment it exists (`db::align`).
                    anchors: result.anchors.clone(),
                },
            )?;
            align::link(conn, &document.summary.id, Some(recording_id))?;
            Ok(document)
        },
    )
}

/// Start transcribing a recording. Returns at once; watch
/// `transcription:progress` and `transcription:done`.
#[tauri::command]
pub fn start_transcription(
    app: AppHandle,
    state: State<'_, AppState>,
    request: TranscribeRequest,
) -> Result<()> {
    let (name, path) = recording_path(&state, &request.document_id)?;
    // Fail here, not on the worker thread, so the dialog can show why.
    let mut engine = engine_for(&app, &request)?;
    let cancel = state.start_job(&state.transcriptions, &request.document_id)?;

    let handle = app.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        let document_id = request.document_id.clone();
        let progress: Progress = {
            let handle = handle.clone();
            let document_id = document_id.clone();
            Arc::new(move |percent, segments_done| {
                let elapsed = started.elapsed().as_secs_f64();
                // Below a few percent the estimate is noise, so no estimate.
                let eta = (5..100)
                    .contains(&percent)
                    .then(|| (elapsed * (100.0 - percent as f64) / percent as f64).round() as u64);
                let _ = handle.emit(
                    PROGRESS_EVENT,
                    ProgressEvent {
                        document_id: document_id.clone(),
                        percent,
                        segments_done,
                        eta,
                    },
                );
            })
        };

        let outcome = transcribe::run(
            &path,
            engine.as_mut(),
            &request.run_options(),
            request.layout,
            progress,
            cancel.clone(),
        )
        .and_then(|result| {
            let state = handle.state::<AppState>();
            let document = state.with_project(|p| {
                save_transcript(
                    p,
                    &document_id,
                    &name,
                    path.to_str().map(str::to_owned),
                    &result,
                )
            })?;
            Ok((document, result.anchors))
        });

        let state = handle.state::<AppState>();
        state.finish_job(&state.transcriptions, &document_id);
        let elapsed_ms = started.elapsed().as_millis() as u64;
        let event = match outcome {
            Ok((document, anchors)) => {
                tracing::info!(
                    segments = anchors.len(),
                    elapsed_ms,
                    "transcription finished"
                );
                done(&document_id, document, anchors, elapsed_ms)
            }
            Err(e) if transcribe::is_cancelled(&e) => DoneEvent {
                document_id: document_id.clone(),
                status: "cancelled",
                transcript_document_id: None,
                transcript_name: None,
                anchors: None,
                message: None,
                elapsed_ms,
            },
            Err(e) => {
                tracing::warn!(error = %e, "transcription failed");
                DoneEvent {
                    document_id: document_id.clone(),
                    status: "failed",
                    transcript_document_id: None,
                    transcript_name: None,
                    anchors: None,
                    message: Some(e.to_string()),
                    elapsed_ms,
                }
            }
        };
        let _ = handle.emit(DONE_EVENT, event);
    });
    Ok(())
}

fn done(document_id: &str, document: Document, anchors: Vec<Anchor>, elapsed_ms: u64) -> DoneEvent {
    DoneEvent {
        document_id: document_id.to_string(),
        status: "done",
        transcript_document_id: Some(document.summary.id),
        transcript_name: Some(document.summary.name),
        anchors: Some(anchors),
        message: None,
        elapsed_ms,
    }
}

#[tauri::command]
pub fn cancel_transcription(state: State<'_, AppState>, document_id: String) {
    state.cancel_job(&state.transcriptions, &document_id);
}

/// The layout the Transcribe dialog should open with, from Settings.
#[tauri::command]
pub fn transcription_defaults(app: AppHandle) -> Layout {
    settings::load(&app)
        .map(|s| Layout {
            timestamps: s.whisper_timestamps,
            group_seconds: s.whisper_group_seconds,
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[test]
    fn a_job_key_can_only_be_claimed_once() {
        let state = AppState::default();
        let flag = state.start_job(&state.transcriptions, "doc-1").unwrap();
        assert!(state.start_job(&state.transcriptions, "doc-1").is_err());
        // A different recording is fine.
        assert!(state.start_job(&state.transcriptions, "doc-2").is_ok());

        assert!(!flag.load(Ordering::Relaxed));
        state.cancel_job(&state.transcriptions, "doc-1");
        assert!(flag.load(Ordering::Relaxed));

        state.finish_job(&state.transcriptions, "doc-1");
        assert!(state.start_job(&state.transcriptions, "doc-1").is_ok());
    }

    #[test]
    fn cancelling_something_that_is_not_running_does_nothing() {
        let state = AppState::default();
        state.cancel_job(&state.transcriptions, "nothing");
        state.finish_job(&state.transcriptions, "nothing");
    }

    #[test]
    fn downloads_and_transcriptions_do_not_share_a_keyspace() {
        let state = AppState::default();
        state.start_job(&state.transcriptions, "tiny").unwrap();
        assert!(
            state.start_job(&state.model_downloads, "tiny").is_ok(),
            "a download named like a document must not be blocked by it"
        );
    }

    /// The events are what the frontend contract says they are.
    #[test]
    fn progress_and_done_events_serialize_in_the_documented_shape() {
        let progress = serde_json::to_value(ProgressEvent {
            document_id: "d1".into(),
            percent: 42,
            segments_done: 7,
            eta: Some(12),
        })
        .unwrap();
        assert_eq!(
            progress,
            serde_json::json!({
                "documentId": "d1",
                "percent": 42,
                "segmentsDone": 7,
                "eta": 12
            })
        );

        let cancelled = serde_json::to_value(DoneEvent {
            document_id: "d1".into(),
            status: "cancelled",
            transcript_document_id: None,
            transcript_name: None,
            anchors: None,
            message: None,
            elapsed_ms: 900,
        })
        .unwrap();
        assert_eq!(
            cancelled,
            serde_json::json!({
                "documentId": "d1",
                "status": "cancelled",
                "elapsedMs": 900
            })
        );

        let finished = serde_json::to_value(done(
            "d1",
            sample_document("d2", "Talk (transcript)"),
            vec![Anchor::new(0, 0), Anchor::new(21, 4000)],
            1234,
        ))
        .unwrap();
        assert_eq!(finished["status"], "done");
        assert_eq!(finished["transcriptDocumentId"], "d2");
        assert_eq!(finished["transcriptName"], "Talk (transcript)");
        assert_eq!(finished["anchors"][1]["ms"], 4000);
    }

    #[test]
    fn a_model_download_event_carries_a_percentage() {
        let e = serde_json::to_value(ModelProgressEvent {
            id: "tiny".into(),
            received: 50,
            total: 200,
            percent: 25,
        })
        .unwrap();
        assert_eq!(e["percent"], 25);
        assert_eq!(e["id"], "tiny");
    }

    /// Keeps the two registries honest about being separate maps.
    #[test]
    fn the_registries_start_empty() {
        let state = AppState::default();
        let empty = |m: &Mutex<HashMap<String, transcribe::Cancel>>| m.lock().unwrap().is_empty();
        assert!(empty(&state.transcriptions));
        assert!(empty(&state.model_downloads));
    }

    /// A recording in a throwaway project, so the save path can be exercised
    /// against the real schema.
    fn project_with_recording() -> (tempfile::TempDir, OpenProject, String) {
        let dir = tempfile::tempdir().unwrap();
        let project = OpenProject::in_memory("transcription").unwrap();
        let wav = dir.path().join("Interview 3.wav");
        std::fs::copy(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/sample.wav"),
            &wav,
        )
        .unwrap();
        let recording = misket_core::db::media::create(
            &project.conn,
            None,
            misket_core::models::NewMediaDocument {
                name: "Interview 3".into(),
                source_path: wav.to_string_lossy().into_owned(),
                mime: "audio/wav".into(),
                media: misket_core::models::MediaInfo {
                    duration_ms: Some(3_000),
                    ..Default::default()
                },
                copy_into_project: false,
                allow_duplicate: false,
            },
        )
        .unwrap()
        .summary
        .id;
        (dir, project, recording)
    }

    fn stub_result() -> transcribe::TranscriptionResult {
        transcribe::format::render(
            &[
                transcribe::format::Segment {
                    start_ms: 0,
                    end_ms: 2_000,
                    text: " Hello there.".into(),
                },
                transcribe::format::Segment {
                    start_ms: 2_000,
                    end_ms: 3_000,
                    text: " And goodbye.".into(),
                },
            ],
            transcribe::Layout::default(),
        )
    }

    /// The whole point of the save step: a text document with `[mm:ss]`
    /// paragraphs, its anchors written, and linked to the recording.
    #[test]
    fn saving_a_transcript_writes_anchors_and_links_the_recording() {
        let (_dir, project, recording) = project_with_recording();
        let result = stub_result();
        let document = save_transcript(&project, &recording, "Interview 3", None, &result).unwrap();

        assert_eq!(document.summary.name, "Interview 3 (transcript)");
        assert_eq!(document.summary.kind, "text");
        assert_eq!(
            document.summary.source_format.as_deref(),
            Some(TRANSCRIPT_FORMAT)
        );
        assert_eq!(
            document.text.as_deref(),
            Some("[00:00] Hello there.\n\n[00:02] And goodbye.")
        );

        let summary = documents::get_summary(&project.conn, &document.summary.id).unwrap();
        assert_eq!(summary.linked_media_id.as_deref(), Some(recording.as_str()));
        assert_eq!(
            align::list(&project.conn, &document.summary.id).unwrap(),
            vec![Anchor::new(0, 0), Anchor::new(22, 2_000)]
        );
    }

    /// The import and the link are one step, so one undo takes both back and
    /// one redo brings them both again.
    #[test]
    fn a_transcription_is_a_single_undoable_step() {
        let (_dir, project, recording) = project_with_recording();
        let before = documents::list(&project.conn).unwrap().len();
        let document =
            save_transcript(&project, &recording, "Interview 3", None, &stub_result()).unwrap();
        assert_eq!(documents::list(&project.conn).unwrap().len(), before + 1);

        history::undo(&project.conn)
            .unwrap()
            .expect("something to undo");
        assert_eq!(
            documents::list(&project.conn).unwrap().len(),
            before,
            "one undo must take the whole transcription back, not leave it unlinked"
        );

        history::redo(&project.conn, None)
            .unwrap()
            .expect("something to redo");
        let summary = documents::get_summary(&project.conn, &document.summary.id).unwrap();
        assert_eq!(
            summary.linked_media_id.as_deref(),
            Some(recording.as_str()),
            "redo must bring the link back too"
        );
        assert_eq!(
            align::list(&project.conn, &document.summary.id)
                .unwrap()
                .len(),
            2
        );
    }

    /// Transcribing the same recording twice is allowed (a different model, a
    /// different language) and must not trip the content-hash duplicate check.
    #[test]
    fn the_same_words_can_be_transcribed_twice() {
        let (_dir, project, recording) = project_with_recording();
        save_transcript(&project, &recording, "Interview 3", None, &stub_result()).unwrap();
        let second =
            save_transcript(&project, &recording, "Interview 3", None, &stub_result()).unwrap();
        assert_eq!(second.summary.name, "Interview 3 (transcript)");
    }

    fn sample_document(id: &str, name: &str) -> Document {
        Document {
            summary: misket_core::models::DocumentSummary {
                id: id.into(),
                kind: "text".into(),
                name: name.into(),
                source_path: None,
                source_format: Some(TRANSCRIPT_FORMAT.into()),
                text_length: Some(0),
                media: None,
                media_missing: false,
                linked_media_id: None,
                transcript_id: None,
                anchor_count: 0,
                sort_order: 0,
                excerpt_count: 0,
                speakers: Vec::new(),
                created_at: String::new(),
                updated_at: String::new(),
            },
            text: None,
        }
    }
}
