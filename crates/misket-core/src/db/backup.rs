//! Timestamped backups and "save a copy as..." for a project file.
//!
//! `save_copy` is a manual, on-demand copy to a path the user picked.
//! `backup_before` is the automatic, timestamped copy the command layer
//! takes before a destructive change. Both go through `VACUUM INTO`, which
//! SQLite allows while the source database is open (unlike a raw file copy,
//! which could race a concurrent write).

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use time::OffsetDateTime;

use crate::error::{AppError, Result};
use crate::models::BackupInfo;

/// Default number of backups kept per project (mirrors `AppSettings.keep_backups`).
pub const DEFAULT_KEEP_BACKUPS: usize = 20;

const EXT: &str = "misket";

/// Copy the open project to `dest`. Refuses to overwrite the file that is
/// currently open. If `dest` already exists, it is only replaced after the
/// copy has been written to a temporary file next to it and renamed over it,
/// so a failed or interrupted copy never destroys the existing file.
pub fn save_copy(conn: &Connection, dest: &Path) -> Result<()> {
    if let Some(open) = conn.path() {
        if is_same_file(Path::new(open), dest) {
            return Err(AppError::Validation(
                "cannot save a copy over the file that is currently open".into(),
            ));
        }
    }
    if dest.exists() {
        let tmp = sibling_tmp_path(dest)?;
        if let Err(e) = vacuum_into(conn, &tmp) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        std::fs::rename(&tmp, dest)?;
    } else {
        if let Some(parent) = dest.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                return Err(AppError::Io(format!(
                    "folder does not exist: {}",
                    parent.display()
                )));
            }
        }
        vacuum_into(conn, dest)?;
    }
    Ok(())
}

/// Write a timestamped backup into `<project stem>.backups/` next to
/// `project_path`, then prune that directory down to the newest `keep`
/// backups. Returns the path of the backup just written.
pub fn backup_before(
    conn: &Connection,
    project_path: &Path,
    reason: &str,
    keep: usize,
) -> Result<PathBuf> {
    let dir = backups_dir(project_path);
    std::fs::create_dir_all(&dir)?;
    let dest = unique_backup_path(&dir, reason);
    vacuum_into(conn, &dest)?;
    prune_backups(&dir, keep)?;
    Ok(dest)
}

/// Like [`backup_before`], but skipped (returning `Ok(None)`) when the newest
/// backup for the same `reason` is less than 60 seconds old, so a bulk
/// operation (e.g. deleting many excerpts) does not write one copy per item.
pub fn backup_before_throttled(
    conn: &Connection,
    project_path: &Path,
    reason: &str,
    keep: usize,
) -> Result<Option<PathBuf>> {
    if should_skip(project_path, reason) {
        return Ok(None);
    }
    backup_before(conn, project_path, reason, keep).map(Some)
}

/// All backups for `project_path`, newest first.
pub fn list_backups(project_path: &Path) -> Result<Vec<BackupInfo>> {
    let dir = backups_dir(project_path);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut infos = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some((ts, reason)) = parse_backup_filename(name) else {
            continue;
        };
        let Some(created_at) = timestamp_to_rfc3339(&ts) else {
            continue;
        };
        let size_bytes = entry.metadata()?.len();
        infos.push(BackupInfo {
            path: path.to_string_lossy().into_owned(),
            created_at,
            reason,
            size_bytes,
        });
    }
    infos.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.path.cmp(&a.path)));
    Ok(infos)
}

/// True if the newest backup for `reason` is less than 60 seconds old.
fn should_skip(project_path: &Path, reason: &str) -> bool {
    let Ok(backups) = list_backups(project_path) else {
        return false;
    };
    let Some(latest) = backups.iter().find(|b| b.reason == reason) else {
        return false;
    };
    let Ok(created) = OffsetDateTime::parse(
        &latest.created_at,
        &time::format_description::well_known::Rfc3339,
    ) else {
        return false;
    };
    let age: time::Duration = OffsetDateTime::now_utc() - created;
    age.whole_seconds() < 60
}

/// Delete the oldest backups in `dir` until at most `keep` remain.
fn prune_backups(dir: &Path, keep: usize) -> Result<()> {
    let mut names: Vec<String> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|n| parse_backup_filename(n).is_some())
        .collect();
    // Fixed-width `YYYYMMDD-HHMMSS` prefix, so lexicographic order is
    // chronological order.
    names.sort();
    if names.len() > keep {
        for name in &names[..names.len() - keep] {
            let _ = std::fs::remove_file(dir.join(name));
        }
    }
    Ok(())
}

fn backups_dir(project_path: &Path) -> PathBuf {
    let mut name = project_path.file_stem().unwrap_or_default().to_os_string();
    name.push(".backups");
    project_path.with_file_name(name)
}

/// A `<timestamp>-<reason>.misket` path in `dir`, disambiguated with a
/// numeric suffix if that exact name is already taken (two backups with the
/// same reason inside the same second).
fn unique_backup_path(dir: &Path, reason: &str) -> PathBuf {
    let ts = timestamp_now();
    let base = dir.join(format!("{ts}-{reason}.{EXT}"));
    if !base.exists() {
        return base;
    }
    for n in 2..1000 {
        let candidate = dir.join(format!("{ts}-{reason}-{n}.{EXT}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    base
}

fn timestamp_now() -> String {
    let t = OffsetDateTime::now_utc();
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        t.year(),
        t.month() as u8,
        t.day(),
        t.hour(),
        t.minute(),
        t.second()
    )
}

/// Splits `<15-char timestamp>-<reason>.misket` into `(timestamp, reason)`.
fn parse_backup_filename(name: &str) -> Option<(String, String)> {
    let stem = name.strip_suffix(&format!(".{EXT}"))?;
    if stem.len() < 17 {
        return None;
    }
    let (ts, rest) = stem.split_at(15);
    if ts.as_bytes()[8] != b'-'
        || !ts
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 8 || b.is_ascii_digit())
    {
        return None;
    }
    let reason = rest.strip_prefix('-')?;
    if reason.is_empty() {
        return None;
    }
    Some((ts.to_string(), reason.to_string()))
}

/// `YYYYMMDD-HHMMSS` (UTC) -> RFC 3339.
fn timestamp_to_rfc3339(ts: &str) -> Option<String> {
    if ts.len() != 15 {
        return None;
    }
    let y = &ts[0..4];
    let mo = &ts[4..6];
    let d = &ts[6..8];
    let h = &ts[9..11];
    let mi = &ts[11..13];
    let s = &ts[13..15];
    Some(format!("{y}-{mo}-{d}T{h}:{mi}:{s}Z"))
}

fn is_same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn sibling_tmp_path(dest: &Path) -> Result<PathBuf> {
    let file_name = dest
        .file_name()
        .ok_or_else(|| AppError::Io("invalid destination path".into()))?;
    let mut name = file_name.to_os_string();
    name.push(format!(".tmp-{}", crate::db::util::new_id()));
    Ok(dest.with_file_name(name))
}

fn vacuum_into(conn: &Connection, dest: &Path) -> Result<()> {
    let dest_str = dest
        .to_str()
        .ok_or_else(|| AppError::Io("destination path is not valid UTF-8".into()))?;
    conn.execute("VACUUM INTO ?1", [dest_str])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::OpenProject;

    fn project_with_docs(dir: &Path, n: usize) -> (PathBuf, OpenProject) {
        let path = dir.join("study.misket");
        let p = OpenProject::create(&path, "Study", "test").unwrap();
        for i in 0..n {
            crate::db::documents::create(
                &p.conn,
                crate::models::NewDocument {
                    name: format!("Doc {i}"),
                    source_path: None,
                    source_format: "txt".into(),
                    text: format!("text {i}"),
                    allow_duplicate: true,
                },
            )
            .unwrap();
        }
        (path, p)
    }

    #[test]
    fn save_copy_opens_as_a_valid_project_with_same_counts() {
        let dir = tempfile::tempdir().unwrap();
        let (_path, p) = project_with_docs(dir.path(), 3);
        let dest = dir.path().join("copy.misket");
        save_copy(&p.conn, &dest).unwrap();

        let orig_version: i64 = p
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        let orig_app_id: i32 = p
            .conn
            .query_row("PRAGMA application_id", [], |r| r.get(0))
            .unwrap();

        let copy = OpenProject::open(&dest).unwrap();
        let copy_version: i64 = copy
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        let copy_app_id: i32 = copy
            .conn
            .query_row("PRAGMA application_id", [], |r| r.get(0))
            .unwrap();
        assert_eq!(copy_version, orig_version);
        assert_eq!(copy_app_id, orig_app_id);
        assert_eq!(copy.info().unwrap().counts.documents, 3);
    }

    #[test]
    fn save_copy_refuses_to_overwrite_the_open_file() {
        let dir = tempfile::tempdir().unwrap();
        let (path, p) = project_with_docs(dir.path(), 0);
        assert!(matches!(
            save_copy(&p.conn, &path),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn save_copy_overwrites_an_existing_destination_via_a_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let (_path, p) = project_with_docs(dir.path(), 1);
        let dest = dir.path().join("copy.misket");
        std::fs::write(&dest, b"not a real project, should be replaced").unwrap();
        save_copy(&p.conn, &dest).unwrap();
        let copy = OpenProject::open(&dest).unwrap();
        assert_eq!(copy.info().unwrap().counts.documents, 1);
        // No leftover temp file.
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn backup_before_writes_next_to_the_project_and_prunes() {
        let dir = tempfile::tempdir().unwrap();
        let (path, p) = project_with_docs(dir.path(), 2);
        let backup_path = backup_before(&p.conn, &path, "delete-document", 20).unwrap();
        assert!(backup_path.exists());
        assert_eq!(
            backup_path.parent().unwrap(),
            dir.path().join("study.backups")
        );
        let backup = OpenProject::open(&backup_path).unwrap();
        assert_eq!(backup.info().unwrap().counts.documents, 2);

        let listed = list_backups(&path).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].reason, "delete-document");
        assert!(listed[0].size_bytes > 0);
    }

    #[test]
    fn pruning_keeps_the_newest_20() {
        let dir = tempfile::tempdir().unwrap();
        let backups_dir = dir.path().join("study.backups");
        std::fs::create_dir_all(&backups_dir).unwrap();
        for i in 0..25 {
            let name = format!("202501{:02}-000000-manual.misket", i + 1);
            std::fs::write(backups_dir.join(name), b"x").unwrap();
        }
        prune_backups(&backups_dir, 20).unwrap();
        let remaining: Vec<String> = std::fs::read_dir(&backups_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(remaining.len(), 20);
        // The 5 oldest (days 1-5) were removed; day 6 onward survive.
        assert!(!remaining.contains(&"20250101-000000-manual.misket".to_string()));
        assert!(!remaining.contains(&"20250105-000000-manual.misket".to_string()));
        assert!(remaining.contains(&"20250106-000000-manual.misket".to_string()));
        assert!(remaining.contains(&"20250125-000000-manual.misket".to_string()));
    }

    #[test]
    fn throttling_skips_a_second_backup_with_the_same_reason_within_60s() {
        let dir = tempfile::tempdir().unwrap();
        let (path, p) = project_with_docs(dir.path(), 0);
        let first = backup_before_throttled(&p.conn, &path, "delete-code", 20).unwrap();
        assert!(first.is_some());
        let second = backup_before_throttled(&p.conn, &path, "delete-code", 20).unwrap();
        assert!(second.is_none(), "second call within 60s should be skipped");
        let third = backup_before_throttled(&p.conn, &path, "merge-code", 20).unwrap();
        assert!(third.is_some(), "a different reason is not throttled");
        assert_eq!(list_backups(&path).unwrap().len(), 2);
    }

    #[test]
    fn list_backups_is_empty_when_there_is_no_backups_dir() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("study.misket");
        assert_eq!(list_backups(&path).unwrap(), Vec::new());
    }
}
