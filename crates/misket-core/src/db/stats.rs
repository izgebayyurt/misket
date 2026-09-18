//! Project statistics for the overview screen. Everything here is
//! read-only and returns a single DTO; the frontend does the layout.

use std::collections::HashMap;

use rusqlite::Connection;
use time::{Duration, OffsetDateTime};

use super::util;
use crate::error::Result;
use crate::models::ProjectStats;

const SPARKLINE_DAYS: i64 = 30;
const TOP_CODES_LIMIT: i64 = 8;

pub fn project_stats(conn: &Connection) -> Result<ProjectStats> {
    let one = |sql: &str| -> Result<i64> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };

    let documents = one("SELECT count(*) FROM documents")?;
    let text_documents = one("SELECT count(*) FROM documents WHERE kind = 'text'")?;
    let image_documents = one("SELECT count(*) FROM documents WHERE kind = 'image'")?;
    let media_documents = one("SELECT count(*) FROM documents WHERE kind = 'video'")?;
    let codes = one("SELECT count(*) FROM codes")?;
    let excerpts = one("SELECT count(*) FROM excerpts")?;
    let coded_excerpts = one("SELECT count(DISTINCT excerpt_id) FROM excerpt_codes")?;
    let memos = one("SELECT count(*) FROM memos")?;
    let descriptor_fields = one("SELECT count(*) FROM descriptor_fields")?;
    let total_text_length: i64 = conn.query_row(
        "SELECT COALESCE(SUM(text_length), 0) FROM documents WHERE kind = 'text'",
        [],
        |r| r.get(0),
    )?;
    let last_activity_at: Option<String> = conn.query_row(
        "SELECT MAX(m) FROM (
            SELECT MAX(updated_at) AS m FROM documents
            UNION ALL SELECT MAX(updated_at) FROM codes
            UNION ALL SELECT MAX(updated_at) FROM excerpts
            UNION ALL SELECT MAX(updated_at) FROM memos
        )",
        [],
        |r| r.get(0),
    )?;

    Ok(ProjectStats {
        documents,
        text_documents,
        image_documents,
        media_documents,
        codes,
        excerpts,
        coded_excerpts,
        memos,
        descriptor_fields,
        total_text_length,
        last_activity_at,
        excerpts_per_day: excerpts_per_day(conn)?,
        top_codes: top_codes(conn)?,
        missing_media: super::media::missing(conn)?,
    })
}

/// One row per one of the last `SPARKLINE_DAYS` days (oldest first, today
/// last), zero-filled for days with no excerpts created.
fn excerpts_per_day(conn: &Connection) -> Result<Vec<(String, i64)>> {
    let today = OffsetDateTime::now_utc();
    let days: Vec<String> = (0..SPARKLINE_DAYS)
        .rev()
        .map(|n| util::day_key(today - Duration::days(n)))
        .collect();
    let oldest = days.first().cloned().unwrap_or_else(util::today);

    let mut stmt = conn.prepare(
        "SELECT substr(created_at, 1, 10) AS d, count(*) AS c
         FROM excerpts
         WHERE substr(created_at, 1, 10) >= ?1
         GROUP BY d",
    )?;
    let counts: HashMap<String, i64> = stmt
        .query_map([&oldest], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?
        .collect::<rusqlite::Result<_>>()?;

    Ok(days
        .into_iter()
        .map(|d| {
            let c = counts.get(&d).copied().unwrap_or(0);
            (d, c)
        })
        .collect())
}

/// Top `TOP_CODES_LIMIT` codes by direct-tag count, highest first. Ties break
/// on code id so the result is stable.
fn top_codes(conn: &Connection) -> Result<Vec<(String, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT code_id, count(DISTINCT excerpt_id) AS c
         FROM excerpt_codes
         GROUP BY code_id
         ORDER BY c DESC, code_id
         LIMIT ?1",
    )?;
    let rows = stmt.query_map([TOP_CODES_LIMIT], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::codes::tests::mk as mk_code;
    use crate::db::documents::{self, tests::new_doc};
    use crate::db::excerpts;
    use crate::db::memos;
    use crate::db::OpenProject;
    use crate::models::{ApplyCodesInput, MemoTarget};

    #[test]
    fn empty_project_has_zeroed_stats_and_a_full_zero_sparkline() {
        let p = OpenProject::in_memory("t").unwrap();
        let stats = project_stats(&p.conn).unwrap();
        assert_eq!(stats.documents, 0);
        assert_eq!(stats.text_documents, 0);
        assert_eq!(stats.image_documents, 0);
        assert_eq!(stats.codes, 0);
        assert_eq!(stats.excerpts, 0);
        assert_eq!(stats.coded_excerpts, 0);
        assert_eq!(stats.memos, 0);
        assert_eq!(stats.descriptor_fields, 0);
        assert_eq!(stats.total_text_length, 0);
        assert_eq!(stats.last_activity_at, None);
        assert_eq!(stats.excerpts_per_day.len(), SPARKLINE_DAYS as usize);
        assert!(stats.excerpts_per_day.iter().all(|(_, c)| *c == 0));
        // Oldest-first, ending on today.
        assert_eq!(stats.excerpts_per_day.last().unwrap().0, util::today());
        assert!(stats.top_codes.is_empty());
    }

    #[test]
    fn counts_and_top_codes_reflect_real_activity() {
        let p = OpenProject::in_memory("t").unwrap();
        let doc = documents::create(&p.conn, new_doc("hello world, this is a transcript"))
            .unwrap()
            .summary
            .id;
        let a = mk_code(&p.conn, "A", None);
        let b = mk_code(&p.conn, "B", None);
        excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: doc.clone(),
                start_pos: Some(0),
                end_pos: Some(5),
                code_ids: vec![a.id.clone(), b.id.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: doc.clone(),
                start_pos: Some(6),
                end_pos: Some(11),
                code_ids: vec![a.id.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        memos::create(&p.conn, MemoTarget::default(), "P", "project memo").unwrap();

        let stats = project_stats(&p.conn).unwrap();
        assert_eq!(stats.documents, 1);
        assert_eq!(stats.text_documents, 1);
        assert_eq!(stats.codes, 2);
        assert_eq!(stats.excerpts, 2);
        assert_eq!(stats.coded_excerpts, 2);
        assert_eq!(stats.memos, 1);
        assert_eq!(
            stats.total_text_length,
            "hello world, this is a transcript".chars().count() as i64
        );
        assert!(stats.last_activity_at.is_some());
        // `A` is tagged twice, `B` once; `A` sorts first.
        assert_eq!(stats.top_codes, vec![(a.id.clone(), 2), (b.id.clone(), 1)]);
        // Both excerpts were created today, so today's bucket holds them.
        assert_eq!(stats.excerpts_per_day.last().unwrap(), &(util::today(), 2));
    }
}
