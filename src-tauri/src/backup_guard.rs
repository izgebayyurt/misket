//! Wires timestamped backups into destructive commands.
//!
//! A backup here is best-effort: it must never turn a successful operation
//! into a failed one, so any error is logged and swallowed.

use misket_core::db::{backup, OpenProject};
use tauri::AppHandle;

/// Back up the open project (throttled to at most one per `reason` every 60
/// seconds) before a destructive change. Never fails the caller.
pub fn before(app: &AppHandle, project: &OpenProject, reason: &str) {
    let keep = crate::settings::load(app)
        .map(|s| s.keep_backups as usize)
        .unwrap_or(backup::DEFAULT_KEEP_BACKUPS);
    match backup::backup_before_throttled(&project.conn, &project.path, reason, keep) {
        Ok(Some(path)) => {
            eprintln!("backup: wrote {} before '{reason}'", path.display());
        }
        Ok(None) => {}
        Err(e) => {
            eprintln!("backup: skipped before '{reason}': {e}");
        }
    }
}
