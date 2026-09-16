//! Forward-only schema migrations keyed by `PRAGMA user_version`.

use rusqlite::Connection;

use crate::error::Result;

const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("migrations/0001_init.sql")),
    (2, include_str!("migrations/0002_descriptors.sql")),
    (3, include_str!("migrations/0003_media_blobs.sql")),
    (4, include_str!("migrations/0004_sets.sql")),
    (5, include_str!("migrations/0005_activity_log.sql")),
    (6, include_str!("migrations/0006_framework.sql")),
];

pub fn latest_version() -> i64 {
    MIGRATIONS.last().map(|(v, _)| *v).unwrap_or(0)
}

pub fn current_version(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

/// Apply every migration newer than the file's version, in one transaction.
pub fn migrate(conn: &Connection) -> Result<()> {
    let current = current_version(conn)?;
    let pending: Vec<_> = MIGRATIONS.iter().filter(|(v, _)| *v > current).collect();
    if pending.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    for (version, sql) in pending {
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {version}"))?;
        tx.execute(
            "INSERT INTO project_meta(key, value) VALUES ('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [version.to_string()],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_is_idempotent_and_records_version() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), latest_version());
        let v: String = conn
            .query_row(
                "SELECT value FROM project_meta WHERE key = 'schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, latest_version().to_string());
    }

    #[test]
    fn migrations_are_ordered_and_start_at_one() {
        assert_eq!(MIGRATIONS.first().unwrap().0, 1);
        // Strictly increasing, but not necessarily contiguous: branches
        // developed in parallel claim a number each and a gap is harmless
        // for a forward-only sequence keyed by `PRAGMA user_version`.
        assert!(MIGRATIONS.windows(2).all(|w| w[0].0 < w[1].0));
        assert_eq!(latest_version(), MIGRATIONS.last().unwrap().0);
    }

    #[test]
    fn activity_log_table_and_indexes_exist() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master
                 WHERE name IN ('activity_log','activity_log_at_idx','activity_log_target_idx')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 3);
    }

    #[test]
    fn media_blob_table_and_image_region_index_exist() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let table: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'media_blobs'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(table, 1);
        let index: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'index'
                 AND name = 'excerpts_image_region_uq'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(index, 1);
        // The blob rows go with their document.
        conn.execute_batch(
            "INSERT INTO documents (id, kind, name, content_hash, media_json, created_at, updated_at)
               VALUES ('d', 'image', 'Poster', 'h', '{}', 't', 't');
             INSERT INTO media_blobs (document_id, mime, bytes)
               VALUES ('d', 'image/png', x'89504e47');",
        )
        .unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON; DELETE FROM documents;")
            .unwrap();
        let left: i64 = conn
            .query_row("SELECT count(*) FROM media_blobs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn descriptor_tables_exist_at_the_latest_version() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table'
                 AND name IN ('descriptor_fields','descriptor_values')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn framework_tables_exist_at_the_latest_version() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table'
                 AND name IN ('framework_matrices','framework_cells')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 2);
        // Deleting a code takes its cells with it.
        conn.execute_batch(
            "INSERT INTO codes (id, name, color, sort_order, created_at, updated_at)
               VALUES ('c', 'Access', '#112233', 0, 't', 't');
             INSERT INTO framework_matrices (id, name, row_kind, created_at, updated_at)
               VALUES ('m', 'Wave 1', 'document', 't', 't');
             INSERT INTO framework_cells (matrix_id, row_key, code_id, summary, updated_at)
               VALUES ('m', 'd', 'c', 'Said little about it.', 't');
             DELETE FROM codes WHERE id = 'c';",
        )
        .unwrap();
        let left: i64 = conn
            .query_row("SELECT count(*) FROM framework_cells", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
        // Deleting the matrix cascades to whatever cells are left.
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             INSERT INTO framework_cells (matrix_id, row_key, code_id, summary, updated_at)
               VALUES ('m', 'd', 'gone', 'x', 't');
             DELETE FROM framework_matrices WHERE id = 'm';",
        )
        .unwrap();
        let left: i64 = conn
            .query_row("SELECT count(*) FROM framework_cells", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn set_tables_exist_at_the_latest_version() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table'
                 AND name IN ('sets','set_members','saved_filters')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 3);
        let triggers: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'trigger'
                 AND name IN ('set_members_code_deleted','set_members_document_deleted')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(triggers, 2);
    }
}
