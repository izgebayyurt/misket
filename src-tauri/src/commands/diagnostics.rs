//! Frontend logging, the log viewer, and manual crash reports. See
//! `crate::logging` and `crate::reporting` for the pieces this wires
//! together.

use serde::Serialize;
use tauri::AppHandle;

use misket_core::{AppError, Result};

use crate::{logging, reporting};

/// One batch entry from `src/core/log.ts`. `context` is whatever small,
/// already-redacted object the frontend attached (see `src/api/log.ts`,
/// which hashes anything path-shaped before it gets here); it is logged
/// as-is and never interpreted.
#[tauri::command]
pub fn frontend_log(level: String, message: String, context: Option<serde_json::Value>) {
    match level.as_str() {
        "error" => tracing::error!(target: "frontend", context = ?context, "{message}"),
        "warn" => tracing::warn!(target: "frontend", context = ?context, "{message}"),
        _ => tracing::info!(target: "frontend", context = ?context, "{message}"),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogViewerData {
    /// Shown in the viewer so a person can find the folder themselves too.
    pub dir: String,
    /// The current log file's own path, if anything has been logged yet —
    /// what "Reveal file in folder" points at.
    pub file: Option<String>,
    pub lines: Vec<String>,
}

/// Every line currently on disk (today's file, plus anything not yet
/// rotated away), for the log viewer's own filtering and search.
#[tauri::command]
pub fn read_logs(app: AppHandle) -> Result<LogViewerData> {
    let dir = logging::log_dir(&app)?;
    let file = logging::latest_log_file(&dir).map(|p| p.to_string_lossy().into_owned());
    let lines = logging::read_all(&dir)?;
    Ok(LogViewerData {
        dir: dir.to_string_lossy().into_owned(),
        file,
        lines,
    })
}

#[tauri::command]
pub fn clear_logs(app: AppHandle) -> Result<()> {
    logging::clear(&logging::log_dir(&app)?)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub app_version: String,
    pub os: String,
    pub webview: String,
    pub log_dir: String,
    /// The last 50 log lines, redacted the same way a crash report is (see
    /// `reporting::redact_log_line`) — safe to put on the clipboard.
    pub log_tail: Vec<String>,
}

fn app_identity(app: &AppHandle) -> (String, String, String) {
    let version = app.package_info().version.to_string();
    let os = std::env::consts::OS.to_string();
    let webview = tauri::webview_version().unwrap_or_else(|_| "unknown".into());
    (version, os, webview)
}

/// The redacted bundle "Copy diagnostics" (About dialog) puts on the
/// clipboard: never document text, codes, memos or file names, only what a
/// crash report would also carry.
#[tauri::command]
pub fn get_diagnostics(app: AppHandle) -> Result<Diagnostics> {
    let (app_version, os, webview) = app_identity(&app);
    let dir = logging::log_dir(&app)?;
    let log_tail = logging::tail_lines(&dir, 50)?
        .iter()
        .map(|l| reporting::redact_log_line(l))
        .collect();
    Ok(Diagnostics {
        app_version,
        os,
        webview,
        log_dir: dir.to_string_lossy().into_owned(),
        log_tail,
    })
}

/// "Send a report now": build a report from the current logs and try to
/// send it right away, queuing it first so a failed send still goes out on
/// the next launch. Refuses outright if reporting is off or no endpoint is
/// set — nothing is ever sent without both.
#[tauri::command]
pub fn send_report_now(app: AppHandle) -> Result<()> {
    let settings = crate::settings::load(&app)?;
    if !settings.send_crash_reports {
        return Err(AppError::Validation(
            "turn on \"Send anonymous crash reports\" first".into(),
        ));
    }
    if settings.report_endpoint.trim().is_empty() {
        return Err(AppError::Validation(
            "set a report endpoint in Settings first".into(),
        ));
    }
    let (app_version, os, _) = app_identity(&app);
    let dir = logging::log_dir(&app)?;
    let tail = logging::tail_lines(&dir, 50)?;
    let report = reporting::build_report(&app_version, &os, "Manual report", None, &tail);
    let queue_dir = reporting::queue_dir(&app)?;
    reporting::enqueue(&queue_dir, &report)?;
    match reporting::send(&settings.report_endpoint, settings.report_format, &report) {
        Ok(()) => reporting::dequeue(&queue_dir, &report.event_id),
        Err(e) => {
            tracing::warn!(error = %e, "queued crash report; will retry next launch");
            Ok(())
        }
    }
}
