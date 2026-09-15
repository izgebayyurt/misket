//! Documents: imported text (milestone 1) and, later, images and video.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::{text, util};
use crate::error::{AppError, Result};
use crate::models::{Document, DocumentSummary, NewDocument};

const SUMMARY_COLUMNS: &str =
    "d.id, d.kind, d.name, d.source_path, d.source_format, d.text_length, d.sort_order,
     (SELECT count(*) FROM excerpts e WHERE e.document_id = d.id) AS excerpt_count,
     d.created_at, d.updated_at";

fn summary_from_row(r: &Row) -> rusqlite::Result<DocumentSummary> {
    Ok(DocumentSummary {
        id: r.get(0)?,
        kind: r.get(1)?,
        name: r.get(2)?,
        source_path: r.get(3)?,
        source_format: r.get(4)?,
        text_length: r.get(5)?,
        sort_order: r.get(6)?,
        excerpt_count: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

/// Import a text document. The text is normalized and hashed; a document with
/// the same hash already in the project is a `Conflict` unless
/// `allow_duplicate` is set.
pub fn create(conn: &Connection, input: NewDocument) -> Result<Document> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("document name is required".into()));
    }
    let text = text::normalize(&input.text);
    let hash = text::sha256_hex(text.as_bytes());
    if !input.allow_duplicate {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM documents WHERE content_hash = ?1",
                [&hash],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            return Err(AppError::Conflict(format!(
                "an identical document already exists ({id})"
            )));
        }
    }
    let id = util::new_id();
    let now = util::now();
    let sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM documents",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO documents (id, kind, name, source_path, source_format, content_hash, text, text_length, sort_order, created_at, updated_at)
         VALUES (?1, 'text', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            name,
            input.source_path,
            input.source_format,
            hash,
            text,
            text::cp_len(&text),
            sort_order,
            now
        ],
    )?;
    get(conn, &id)
}

pub fn list(conn: &Connection) -> Result<Vec<DocumentSummary>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SUMMARY_COLUMNS} FROM documents d ORDER BY d.sort_order, d.created_at"
    ))?;
    let rows = stmt.query_map([], summary_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get_summary(conn: &Connection, id: &str) -> Result<DocumentSummary> {
    conn.query_row(
        &format!("SELECT {SUMMARY_COLUMNS} FROM documents d WHERE d.id = ?1"),
        [id],
        summary_from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("document {id} not found")))
}

pub fn get(conn: &Connection, id: &str) -> Result<Document> {
    let summary = get_summary(conn, id)?;
    let text: Option<String> =
        conn.query_row("SELECT text FROM documents WHERE id = ?1", [id], |r| {
            r.get(0)
        })?;
    Ok(Document { summary, text })
}

pub fn get_text(conn: &Connection, id: &str) -> Result<(String, i64)> {
    conn.query_row(
        "SELECT text, text_length FROM documents WHERE id = ?1 AND kind = 'text'",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("text document {id} not found")))
}

pub fn rename(conn: &Connection, id: &str, name: &str) -> Result<DocumentSummary> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("document name is required".into()));
    }
    let n = conn.execute(
        "UPDATE documents SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name, util::now()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("document {id} not found")));
    }
    get_summary(conn, id)
}

/// Reorder documents; ids not mentioned keep their relative order after the listed ones.
pub fn reorder(conn: &Connection, ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let existing = list(&tx)?;
    let mut order: Vec<String> = ids.to_vec();
    for d in existing {
        if !order.contains(&d.id) {
            order.push(d.id);
        }
    }
    for (i, id) in order.iter().enumerate() {
        tx.execute(
            "UPDATE documents SET sort_order = ?2 WHERE id = ?1",
            params![id, i as i64],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    let n = conn.execute("DELETE FROM documents WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(AppError::NotFound(format!("document {id} not found")));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::OpenProject;

    pub(crate) fn new_doc(text: &str) -> NewDocument {
        NewDocument {
            name: "Interview 1".into(),
            source_path: None,
            source_format: "txt".into(),
            text: text.into(),
            allow_duplicate: false,
        }
    }

    #[test]
    fn create_normalizes_hashes_and_counts_code_points() {
        let p = OpenProject::in_memory("t").unwrap();
        let d = create(&p.conn, new_doc("\u{FEFF}héllo\r\n😀")).unwrap();
        assert_eq!(d.text.as_deref(), Some("héllo\n😀"));
        assert_eq!(d.summary.text_length, Some(7));
        assert_eq!(d.summary.kind, "text");
        assert_eq!(d.summary.excerpt_count, 0);
        assert_eq!(list(&p.conn).unwrap().len(), 1);
    }

    #[test]
    fn duplicate_content_is_a_conflict_unless_allowed() {
        let p = OpenProject::in_memory("t").unwrap();
        create(&p.conn, new_doc("same")).unwrap();
        assert!(matches!(
            create(&p.conn, new_doc("same")),
            Err(AppError::Conflict(_))
        ));
        let mut again = new_doc("same");
        again.allow_duplicate = true;
        create(&p.conn, again).unwrap();
        assert_eq!(list(&p.conn).unwrap().len(), 2);
    }

    #[test]
    fn rename_reorder_delete() {
        let p = OpenProject::in_memory("t").unwrap();
        let a = create(&p.conn, new_doc("a")).unwrap().summary.id;
        let b = create(&p.conn, new_doc("b")).unwrap().summary.id;
        let c = create(&p.conn, new_doc("c")).unwrap().summary.id;
        rename(&p.conn, &a, "  Renamed ").unwrap();
        assert_eq!(get_summary(&p.conn, &a).unwrap().name, "Renamed");
        assert!(matches!(
            rename(&p.conn, &a, " "),
            Err(AppError::Validation(_))
        ));
        reorder(&p.conn, &[c.clone(), a.clone()]).unwrap();
        let ids: Vec<_> = list(&p.conn).unwrap().into_iter().map(|d| d.id).collect();
        assert_eq!(ids, vec![c.clone(), a.clone(), b.clone()]);
        delete(&p.conn, &b).unwrap();
        assert!(matches!(delete(&p.conn, &b), Err(AppError::NotFound(_))));
        assert_eq!(list(&p.conn).unwrap().len(), 2);
        assert!(matches!(get(&p.conn, &b), Err(AppError::NotFound(_))));
    }
}
