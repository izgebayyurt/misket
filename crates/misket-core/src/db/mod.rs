//! Project database: one SQLite file per project.

pub mod activity;
pub mod analysis;
pub mod backup;
pub mod bulk;
pub mod codebook_import;
pub mod codes;
pub mod descriptors;
pub mod documents;
pub mod excerpts;
pub mod export;
pub mod framework;
pub mod memos;
pub mod migrations;
pub mod query_expr;
pub mod search;
pub mod sets;
pub mod stats;
pub mod text;
pub mod transcripts;
pub mod util;

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use crate::error::{AppError, Result};
use crate::models::{ProjectCounts, ProjectInfo};

/// 'MSKT' in the SQLite header, so tools (and we) can recognise a project file.
pub const APPLICATION_ID: i32 = 0x4D53_4B54;

/// An open project: the file path plus its connection.
pub struct OpenProject {
    pub path: PathBuf,
    pub conn: Connection,
}

impl OpenProject {
    /// Create a brand-new project file. Fails if the file already exists.
    pub fn create(path: &Path, name: &str, app_version: &str) -> Result<Self> {
        if path.exists() {
            return Err(AppError::Conflict(format!(
                "a file already exists at {}",
                path.display()
            )));
        }
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                return Err(AppError::Io(format!(
                    "folder does not exist: {}",
                    parent.display()
                )));
            }
        }
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )?;
        set_pragmas(&conn)?;
        migrations::migrate(&conn)?;
        let now = util::now();
        let tx = conn.unchecked_transaction()?;
        for (k, v) in [
            ("project_id", util::new_id()),
            ("name", name.to_string()),
            ("created_at", now),
            ("created_with_app_version", app_version.to_string()),
        ] {
            tx.execute(
                "INSERT INTO project_meta(key, value) VALUES (?1, ?2)",
                (k, v),
            )?;
        }
        tx.commit()?;
        Ok(Self {
            path: path.to_path_buf(),
            conn,
        })
    }

    /// Open an existing project file, migrating it if it is older than this build.
    pub fn open(path: &Path) -> Result<Self> {
        if !path.is_file() {
            return Err(AppError::NotFound(format!(
                "no project at {}",
                path.display()
            )));
        }
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
        // Inspect the header before touching any pragma so a foreign SQLite
        // file is recognised as such.
        let app_id: i32 = conn.query_row("PRAGMA application_id", [], |r| r.get(0))?;
        let version = migrations::current_version(&conn)?;
        if app_id != APPLICATION_ID {
            return Err(AppError::Validation(format!(
                "{} is not a Misket project",
                path.display()
            )));
        }
        if version > migrations::latest_version() {
            return Err(AppError::NewerSchema(version));
        }
        if version < migrations::latest_version() {
            backup_before_migration(path, version)?;
        }
        set_pragmas(&conn)?;
        migrations::migrate(&conn)?;
        Ok(Self {
            path: path.to_path_buf(),
            conn,
        })
    }

    /// Open an in-memory project (tests only).
    pub fn in_memory(name: &str) -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        set_pragmas(&conn)?;
        migrations::migrate(&conn)?;
        let now = util::now();
        for (k, v) in [
            ("project_id", util::new_id()),
            ("name", name.to_string()),
            ("created_at", now),
            ("created_with_app_version", "test".to_string()),
        ] {
            conn.execute(
                "INSERT INTO project_meta(key, value) VALUES (?1, ?2)",
                (k, v),
            )?;
        }
        Ok(Self {
            path: PathBuf::from(":memory:"),
            conn,
        })
    }

    pub fn info(&self) -> Result<ProjectInfo> {
        let sync_warning = crate::sync::detect_sync_folder(&self.path)
            .map(|provider| crate::sync::warning_message(&provider, &self.path));
        Ok(ProjectInfo {
            path: self.path.to_string_lossy().into_owned(),
            name: meta(&self.conn, "name")?.unwrap_or_default(),
            project_id: meta(&self.conn, "project_id")?.unwrap_or_default(),
            schema_version: migrations::current_version(&self.conn)?,
            counts: counts(&self.conn)?,
            sync_warning,
        })
    }

    /// Rename the project (`project_meta.name`). Trims the name and rejects
    /// an empty one.
    pub fn rename(&self, name: &str) -> Result<ProjectInfo> {
        let name = name.trim();
        if name.is_empty() {
            return Err(AppError::Validation("project name is required".into()));
        }
        self.conn.execute(
            "UPDATE project_meta SET value = ?1 WHERE key = 'name'",
            [name],
        )?;
        self.info()
    }
}

fn set_pragmas(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = DELETE;
         PRAGMA synchronous = NORMAL;
         PRAGMA application_id = {APPLICATION_ID};"
    ))?;
    Ok(())
}

fn backup_before_migration(path: &Path, old_version: i64) -> Result<()> {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".bak-v{old_version}"));
    let backup = path.with_file_name(name);
    if !backup.exists() {
        std::fs::copy(path, &backup)?;
    }
    Ok(())
}

pub fn meta(conn: &Connection, key: &str) -> Result<Option<String>> {
    use rusqlite::OptionalExtension;
    Ok(conn
        .query_row(
            "SELECT value FROM project_meta WHERE key = ?1",
            [key],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn counts(conn: &Connection) -> Result<ProjectCounts> {
    let one = |sql: &str| -> Result<i64> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };
    Ok(ProjectCounts {
        documents: one("SELECT count(*) FROM documents")?,
        codes: one("SELECT count(*) FROM codes")?,
        excerpts: one("SELECT count(*) FROM excerpts")?,
        memos: one("SELECT count(*) FROM memos")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_open_roundtrip_sets_version_and_app_id() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("demo.misket");
        {
            let p = OpenProject::create(&path, "Demo", "0.1.0").unwrap();
            let info = p.info().unwrap();
            assert_eq!(info.name, "Demo");
            assert_eq!(info.schema_version, migrations::latest_version());
            assert_eq!(info.counts, ProjectCounts::default());
        }
        let p = OpenProject::open(&path).unwrap();
        let app_id: i32 = p
            .conn
            .query_row("PRAGMA application_id", [], |r| r.get(0))
            .unwrap();
        assert_eq!(app_id, APPLICATION_ID);
        let journal: String = p
            .conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(journal, "delete");
        // Opening twice is idempotent (migrations do not re-run).
        drop(p);
        let p = OpenProject::open(&path).unwrap();
        assert_eq!(
            p.info().unwrap().schema_version,
            migrations::latest_version()
        );
        assert!(!path.with_file_name("demo.misket.bak-v1").exists());
    }

    #[test]
    fn opening_an_older_file_backs_it_up_then_migrates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.misket");
        {
            // Pretend this file was written by a build that only knew schema 1.
            let p = OpenProject::create(&path, "Old", "0.1.0").unwrap();
            p.conn
                .execute_batch(
                    "DROP TRIGGER framework_cells_code_deleted;
                     DROP TABLE framework_cells;
                     ALTER TABLE documents DROP COLUMN transcript_json;
                     DROP TABLE framework_matrices;
                     DROP TABLE activity_log;
                     DROP TABLE descriptor_values;
                     DROP TABLE descriptor_fields;
                     DROP TABLE media_blobs;
                     DROP INDEX excerpts_image_region_uq;
                     DROP TRIGGER set_members_code_deleted;
                     DROP TRIGGER set_members_document_deleted;
                     DROP TABLE saved_filters;
                     DROP TABLE set_members;
                     DROP TABLE sets;
                     DROP INDEX codes_example_excerpt_idx;
                     ALTER TABLE codes DROP COLUMN example_excerpt_id;
                     ALTER TABLE codes DROP COLUMN exclusion;
                     ALTER TABLE codes DROP COLUMN inclusion;
                     PRAGMA user_version = 1;",
                )
                .unwrap();
        }
        let backup = path.with_file_name("old.misket.bak-v1");
        assert!(!backup.exists());
        let p = OpenProject::open(&path).unwrap();
        assert_eq!(
            p.info().unwrap().schema_version,
            migrations::latest_version()
        );
        assert!(backup.exists(), "the v1 file is kept next to the project");
        let backup_version: i64 = Connection::open(&backup)
            .unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(backup_version, 1);
        // The tables the migrations added are usable again.
        p.conn
            .execute_batch(
                "SELECT count(*) FROM descriptor_fields;
                 SELECT count(*) FROM media_blobs;
                 SELECT count(*) FROM sets;
                 SELECT count(*) FROM activity_log;
                 SELECT count(*) FROM framework_matrices;
                 SELECT count(*) FROM codes WHERE inclusion = '' AND exclusion = ''
                   AND example_excerpt_id IS NULL;
                 SELECT count(*) FROM documents WHERE transcript_json IS NULL;",
            )
            .unwrap();
    }

    #[test]
    fn info_flags_a_project_inside_a_cloud_synced_folder() {
        let dir = tempfile::tempdir().unwrap();
        let synced = dir.path().join("Dropbox");
        std::fs::create_dir_all(&synced).unwrap();
        let path = synced.join("study.misket");
        let p = OpenProject::create(&path, "Study", "test").unwrap();
        let warning = p.info().unwrap().sync_warning.unwrap();
        assert!(warning.contains("inside Dropbox"));
        assert!(warning.contains("study.backups"));
    }

    #[test]
    fn info_has_no_sync_warning_for_a_plain_local_folder() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("study.misket");
        let p = OpenProject::create(&path, "Study", "test").unwrap();
        assert_eq!(p.info().unwrap().sync_warning, None);
    }

    #[test]
    fn rename_trims_and_rejects_empty() {
        let p = OpenProject::in_memory("Old name").unwrap();
        let info = p.rename("  New name  ").unwrap();
        assert_eq!(info.name, "New name");
        assert_eq!(p.info().unwrap().name, "New name");
        assert!(matches!(p.rename(""), Err(AppError::Validation(_))));
        assert!(matches!(p.rename("   "), Err(AppError::Validation(_))));
        // A rejected rename does not touch the stored name.
        assert_eq!(p.info().unwrap().name, "New name");
    }

    #[test]
    fn create_refuses_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.misket");
        std::fs::write(&path, b"").unwrap();
        assert!(matches!(
            OpenProject::create(&path, "x", "0"),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn open_rejects_newer_schema_and_foreign_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("future.misket");
        {
            let p = OpenProject::create(&path, "f", "0").unwrap();
            p.conn.execute_batch("PRAGMA user_version = 9999").unwrap();
        }
        assert!(matches!(
            OpenProject::open(&path),
            Err(AppError::NewerSchema(9999))
        ));

        let other = dir.path().join("other.db");
        {
            let c = Connection::open(&other).unwrap();
            c.execute_batch("PRAGMA user_version = 1; CREATE TABLE t(x);")
                .unwrap();
        }
        assert!(matches!(
            OpenProject::open(&other),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            OpenProject::open(&dir.path().join("missing.misket")),
            Err(AppError::NotFound(_))
        ));
    }
}
