//! Structured logging: a daily-rotating, 7-day-retained log file in the
//! app's log directory (`misket.<date>.log`), plus stderr in debug builds.
//! Every line is one JSON object (`timestamp`, `level`, `target`, `fields`),
//! which is what both the in-app log viewer and [`crate::reporting`] parse.
//!
//! Frontend errors arrive through the `frontend_log` command
//! (`commands::diagnostics`) and are logged the same way, under the
//! `"frontend"` target, so nothing in the app writes its own separate log.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{Builder, Rotation};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter};

const FILENAME_PREFIX: &str = "misket";
const FILENAME_SUFFIX: &str = "log";
/// How many days of rotated files `tracing_appender` keeps around; older
/// ones are deleted as new ones are created.
const KEEP_DAYS: usize = 7;

/// Holds the non-blocking writer's background thread alive for as long as
/// the app runs. Dropping it would silently stop new lines being flushed to
/// disk, so [`init`] hands it to Tauri's state and it is never read again.
pub struct LogGuard(#[allow(dead_code)] WorkerGuard);

/// The directory logs live in, creating it if this is the first run.
pub fn log_dir(app: &AppHandle) -> misket_core::Result<PathBuf> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| misket_core::AppError::Io(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Install the tracing subscriber: a JSON-lines file layer, plus a plain
/// stderr layer in debug builds. Call once, at startup, before anything else
/// logs — the returned guard must be kept alive for the app's lifetime.
pub fn init(app: &AppHandle) -> misket_core::Result<LogGuard> {
    let dir = log_dir(app)?;
    let appender = Builder::new()
        .rotation(Rotation::DAILY)
        .filename_prefix(FILENAME_PREFIX)
        .filename_suffix(FILENAME_SUFFIX)
        .max_log_files(KEEP_DAYS)
        .build(&dir)
        .map_err(|e| misket_core::AppError::Io(e.to_string()))?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let file_layer = fmt::layer().with_writer(writer).with_ansi(false).json();
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let registry = tracing_subscriber::registry().with(filter).with(file_layer);
    if cfg!(debug_assertions) {
        registry
            .with(fmt::layer().with_writer(std::io::stderr))
            .init();
    } else {
        registry.init();
    }
    Ok(LogGuard(guard))
}

/// The most recently written log file (today's, in the common case), if any
/// have been written yet.
pub fn latest_log_file(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| is_log_file(p))
        .max_by_key(|p| {
            std::fs::metadata(p)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        })
}

fn is_log_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with(FILENAME_PREFIX) && n.ends_with(FILENAME_SUFFIX))
        .unwrap_or(false)
}

/// The last `max_lines` lines of the latest log file, oldest first. Reads
/// the whole file rather than seeking from the end — log files are small
/// (one day of a desktop app) so this is simple and fast enough.
pub fn tail_lines(dir: &Path, max_lines: usize) -> misket_core::Result<Vec<String>> {
    let Some(path) = latest_log_file(dir) else {
        return Ok(Vec::new());
    };
    let content = std::fs::read_to_string(path)?;
    let lines: Vec<String> = content.lines().map(String::from).collect();
    let start = lines.len().saturating_sub(max_lines);
    Ok(lines[start..].to_vec())
}

/// Every line of every log file currently on disk, oldest file first. Used
/// by the log viewer, which does its own level filtering and search.
pub fn read_all(dir: &Path) -> misket_core::Result<Vec<String>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| is_log_file(p))
        .collect();
    files.sort();
    let mut lines = Vec::new();
    for path in files {
        if let Ok(content) = std::fs::read_to_string(&path) {
            lines.extend(content.lines().map(String::from));
        }
    }
    Ok(lines)
}

/// Delete every log file. Used by "Clear logs" in the viewer; a fresh file
/// is created the next time something logs.
pub fn clear(dir: &Path) -> misket_core::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if is_log_file(&path) {
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latest_log_file_picks_the_most_recently_written() {
        let dir = tempfile::tempdir().unwrap();
        let older = dir.path().join("misket.2026-01-01.log");
        let newer = dir.path().join("misket.2026-01-02.log");
        std::fs::write(&older, "old\n").unwrap();
        // Ensure a distinct mtime even on filesystems with coarse resolution.
        std::thread::sleep(std::time::Duration::from_millis(10));
        std::fs::write(&newer, "new\n").unwrap();
        assert_eq!(latest_log_file(dir.path()), Some(newer));
    }

    #[test]
    fn latest_log_file_ignores_unrelated_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), "{}").unwrap();
        assert_eq!(latest_log_file(dir.path()), None);
    }

    #[test]
    fn tail_lines_returns_only_the_last_n() {
        let dir = tempfile::tempdir().unwrap();
        let content = (1..=10)
            .map(|n| format!("line {n}"))
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(dir.path().join("misket.2026-01-01.log"), content).unwrap();
        let tail = tail_lines(dir.path(), 3).unwrap();
        assert_eq!(tail, vec!["line 8", "line 9", "line 10"]);
    }

    #[test]
    fn read_all_concatenates_every_file_in_order() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("misket.2026-01-01.log"), "a\nb").unwrap();
        std::fs::write(dir.path().join("misket.2026-01-02.log"), "c").unwrap();
        assert_eq!(read_all(dir.path()).unwrap(), vec!["a", "b", "c"]);
    }

    #[test]
    fn clear_removes_log_files_but_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("misket.2026-01-01.log");
        let settings = dir.path().join("settings.json");
        std::fs::write(&log, "x").unwrap();
        std::fs::write(&settings, "{}").unwrap();
        clear(dir.path()).unwrap();
        assert!(!log.exists());
        assert!(settings.exists());
    }
}
