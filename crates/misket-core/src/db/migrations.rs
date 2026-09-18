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
    (7, include_str!("migrations/0007_code_definitions.sql")),
    (8, include_str!("migrations/0008_history.sql")),
    (9, include_str!("migrations/0009_history_groups.sql")),
    (10, include_str!("migrations/0010_transcripts.sql")),
    (11, include_str!("migrations/0011_coders.sql")),
    (12, include_str!("migrations/0012_sync_points.sql")),
    (13, include_str!("migrations/0013_weights.sql")),
    (14, include_str!("migrations/0014_media_by_reference.sql")),
    (15, include_str!("migrations/0015_transcript_alignment.sql")),
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

    /// Schema 11 rebuilds `excerpt_codes` to put the coder in its primary
    /// key. A rebuild is the one migration shape that can silently lose rows,
    /// so this runs it over a real v10 table and counts what comes out.
    #[test]
    fn schema_11_rebuilds_excerpt_codes_and_keeps_every_coding() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        // Put the table back the way schema 10 had it, with two codings in it.
        conn.execute_batch(
            "DROP TABLE transcript_anchors;
             DROP INDEX documents_linked_media_idx;
             ALTER TABLE documents DROP COLUMN linked_media_id;
             DROP INDEX excerpts_video_range_uq;
             DROP TABLE media_blobs;
             CREATE TABLE media_blobs (
               document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
               mime        TEXT NOT NULL,
               bytes       BLOB NOT NULL
             );
             DROP TABLE sync_points;
             ALTER TABLE codes DROP COLUMN weight_scale_json;
             DROP INDEX excerpt_codes_coder_idx;
             DROP INDEX excerpt_codes_code_idx;
             DROP TABLE excerpt_codes;
             DROP TABLE coders;
             DROP INDEX memos_coder_idx;
             ALTER TABLE memos   DROP COLUMN coder_id;
             ALTER TABLE history DROP COLUMN coder_id;
             CREATE TABLE excerpt_codes (
               excerpt_id TEXT NOT NULL REFERENCES excerpts(id) ON DELETE CASCADE,
               code_id    TEXT NOT NULL REFERENCES codes(id)    ON DELETE CASCADE,
               created_at TEXT NOT NULL,
               PRIMARY KEY (excerpt_id, code_id)
             ) WITHOUT ROWID;
             CREATE INDEX excerpt_codes_code_idx ON excerpt_codes(code_id);
             INSERT INTO documents (id, kind, name, content_hash, text, text_length,
                                    created_at, updated_at)
               VALUES ('d', 'text', 'Interview', 'h', 'one two three', 13, 't', 't');
             INSERT INTO codes (id, name, color, created_at, updated_at)
               VALUES ('c1', 'Alpha', '#D9534F', 't', 't'),
                      ('c2', 'Beta',  '#5CB85C', 't', 't');
             INSERT INTO excerpts (id, document_id, kind, start_pos, end_pos, snapshot,
                                   created_at, updated_at)
               VALUES ('e', 'd', 'text', 0, 3, 'one', 't', 't');
             INSERT INTO excerpt_codes (excerpt_id, code_id, created_at)
               VALUES ('e', 'c1', '2024-01-01T00:00:00Z'),
                      ('e', 'c2', '2024-01-02T00:00:00Z');
             INSERT INTO memos (id, excerpt_id, title, body, created_at, updated_at)
               VALUES ('m', 'e', 'Note', 'body', 't', 't');
             PRAGMA user_version = 10;",
        )
        .unwrap();

        migrate(&conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), latest_version());

        // Both codings survived the rebuild, keeping their own timestamps,
        // and are waiting for an owner.
        let rows: Vec<(String, String, String)> = conn
            .prepare("SELECT code_id, coder_id, created_at FROM excerpt_codes ORDER BY code_id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![
                ("c1".into(), String::new(), "2024-01-01T00:00:00Z".into()),
                ("c2".into(), String::new(), "2024-01-02T00:00:00Z".into()),
            ]
        );
        // The index the browser's code filter leans on is back.
        let indexes: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master
                  WHERE name IN ('excerpt_codes_code_idx', 'excerpt_codes_coder_idx')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(indexes, 2);

        // And the first open claims all of it for whoever is at the keyboard.
        super::super::coders::ensure_local(&conn, "ada", "Ada", "#D9534F").unwrap();
        let mine: i64 = conn
            .query_row(
                "SELECT count(*) FROM excerpt_codes WHERE coder_id = 'ada'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mine, 2);
        let memo_coder: String = conn
            .query_row("SELECT coder_id FROM memos WHERE id = 'm'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(memo_coder, "ada");
    }

    #[test]
    fn history_tables_and_indexes_exist_and_activity_log_is_gone() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master
                 WHERE name IN ('history','history_blobs','history_parent_idx',
                                'history_at_idx','history_target_idx')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 5);
        let gone: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name = 'activity_log'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(gone, 0);
        // Blobs go with their node.
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             INSERT INTO history (id, at, kind, target_kind, summary)
               VALUES (1, 't', 'k', 'project', 's');
             INSERT INTO history_blobs (node_id, name, bytes) VALUES (1, 'text', x'00');
             DELETE FROM history WHERE id = 1;",
        )
        .unwrap();
        let left: i64 = conn
            .query_row("SELECT count(*) FROM history_blobs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    /// The upgrade to 8 has to carry an existing log across: same ids, same
    /// order, chained parent to child, head on the last one, and no payloads
    /// (those entries were written before inverses were recorded).
    #[test]
    fn upgrading_copies_the_activity_log_into_a_linear_chain() {
        let conn = Connection::open_in_memory().unwrap();
        // Stop at 7, where `activity_log` is still the log.
        for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 7) {
            conn.execute_batch(sql).unwrap();
            conn.execute_batch(&format!("PRAGMA user_version = {version}"))
                .unwrap();
        }
        for (i, kind) in ["code.created", "code.updated", "excerpt.created"]
            .iter()
            .enumerate()
        {
            conn.execute(
                "INSERT INTO activity_log (at, actor, kind, target_kind, target_id, summary, detail_json)
                 VALUES (?1, 'Ada', ?2, 'code', 'c1', ?3, '{\"n\":1}')",
                rusqlite::params![format!("2024-01-0{}T00:00:00Z", i + 1), kind, format!("s{i}")],
            )
            .unwrap();
        }
        migrate(&conn).unwrap();

        let mut stmt = conn
            .prepare(
                "SELECT id, parent_id, kind, actor, summary, detail_json,
                        forward_json, inverse_json, preferred_child
                 FROM history ORDER BY id",
            )
            .unwrap();
        type Row = (
            i64,
            Option<i64>,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<i64>,
        );
        let rows: Vec<Row> = stmt
            .query_map([], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                ))
            })
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows.iter().map(|r| r.2.as_str()).collect::<Vec<_>>(),
            vec!["code.created", "code.updated", "excerpt.created"]
        );
        assert_eq!(rows.iter().map(|r| r.0).collect::<Vec<_>>(), vec![1, 2, 3]);
        assert_eq!(
            rows.iter().map(|r| r.1).collect::<Vec<_>>(),
            vec![None, Some(1), Some(2)]
        );
        assert_eq!(
            rows.iter().map(|r| r.8).collect::<Vec<_>>(),
            vec![Some(2), Some(3), None]
        );
        assert!(rows.iter().all(|r| r.3 == "Ada" && r.5 == "{\"n\":1}"));
        // Nothing copied is undoable.
        assert!(rows.iter().all(|r| r.6.is_none() && r.7.is_none()));

        let head: String = conn
            .query_row(
                "SELECT value FROM project_meta WHERE key = 'history_head'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(head, "3");
    }

    /// A project with nothing in its log still gets a head pointer, empty.
    #[test]
    fn upgrading_an_empty_log_leaves_the_head_before_the_first_node() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let head: String = conn
            .query_row(
                "SELECT value FROM project_meta WHERE key = 'history_head'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(head, "");
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

    #[test]
    fn the_transcript_column_exists_at_the_latest_version() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let cols: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('documents')")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(cols.iter().any(|c| c == "transcript_json"));
    }

    #[test]
    fn code_definition_columns_exist_and_example_clears_on_delete() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let cols: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('codes')")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        for wanted in ["inclusion", "exclusion", "example_excerpt_id"] {
            assert!(cols.iter().any(|c| c == wanted), "missing column {wanted}");
        }
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             INSERT INTO documents (id, kind, name, content_hash, text, text_length, created_at, updated_at)
               VALUES ('d', 'text', 'Doc', 'h', 'hello there', 11, 't', 't');
             INSERT INTO excerpts (id, document_id, kind, start_pos, end_pos, snapshot, created_at, updated_at)
               VALUES ('e', 'd', 'text', 0, 5, 'hello', 't', 't');
             INSERT INTO codes (id, name, color, example_excerpt_id, created_at, updated_at)
               VALUES ('c', 'Greeting', '#D9534F', 'e', 't', 't');",
        )
        .unwrap();
        conn.execute_batch("DELETE FROM excerpts WHERE id = 'e';")
            .unwrap();
        // The code survives; only the pointer is cleared.
        let example: Option<String> = conn
            .query_row(
                "SELECT example_excerpt_id FROM codes WHERE id = 'c'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(example, None);
    }
}
