//! Memos: free-text notes on a document, a code, an excerpt, or the project.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util;
use crate::error::{AppError, Result};
use crate::models::{Memo, MemoTarget};

const COLUMNS: &str = "id, document_id, code_id, excerpt_id, title, body, created_at, updated_at";

fn from_row(r: &Row) -> rusqlite::Result<Memo> {
    Ok(Memo {
        id: r.get(0)?,
        document_id: r.get(1)?,
        code_id: r.get(2)?,
        excerpt_id: r.get(3)?,
        title: r.get(4)?,
        body: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

fn validate_target(target: &MemoTarget) -> Result<()> {
    let n = [
        target.document_id.is_some(),
        target.code_id.is_some(),
        target.excerpt_id.is_some(),
    ]
    .iter()
    .filter(|b| **b)
    .count();
    if n > 1 {
        return Err(AppError::Validation("a memo has at most one target".into()));
    }
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> Result<Memo> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM memos WHERE id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("memo {id} not found")))
}

pub fn list(conn: &Connection, target: &MemoTarget) -> Result<Vec<Memo>> {
    validate_target(target)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM memos
         WHERE document_id IS ?1 AND code_id IS ?2 AND excerpt_id IS ?3
         ORDER BY created_at"
    ))?;
    let rows = stmt.query_map(
        params![target.document_id, target.code_id, target.excerpt_id],
        from_row,
    )?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn list_for_excerpt(conn: &Connection, excerpt_id: &str) -> Result<Vec<Memo>> {
    list(
        conn,
        &MemoTarget {
            excerpt_id: Some(excerpt_id.to_string()),
            ..Default::default()
        },
    )
}

pub fn create(conn: &Connection, target: MemoTarget, title: &str, body: &str) -> Result<Memo> {
    validate_target(&target)?;
    let id = util::new_id();
    let now = util::now();
    conn.execute(
        &format!("INSERT INTO memos ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)"),
        params![
            id,
            target.document_id,
            target.code_id,
            target.excerpt_id,
            title,
            body,
            now
        ],
    )
    .map_err(|e| {
        if e.to_string().contains("FOREIGN KEY") {
            AppError::NotFound("memo target does not exist".into())
        } else {
            AppError::from(e)
        }
    })?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, title: &str, body: &str) -> Result<Memo> {
    let n = conn.execute(
        "UPDATE memos SET title = ?2, body = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, title, body, util::now()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("memo {id} not found")));
    }
    get(conn, id)
}

/// Delete a memo and return it (for undo).
pub fn delete(conn: &Connection, id: &str) -> Result<Memo> {
    let memo = get(conn, id)?;
    conn.execute("DELETE FROM memos WHERE id = ?1", [id])?;
    Ok(memo)
}

/// Reinsert a deleted memo with its original id (for undo).
pub fn restore(conn: &Connection, memo: &Memo) -> Result<Memo> {
    conn.execute(
        &format!("INSERT INTO memos ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
        params![
            memo.id,
            memo.document_id,
            memo.code_id,
            memo.excerpt_id,
            memo.title,
            memo.body,
            memo.created_at,
            memo.updated_at
        ],
    )
    .map_err(|e| {
        if e.to_string().contains("FOREIGN KEY") {
            AppError::NotFound("memo target no longer exists".into())
        } else {
            AppError::from(e)
        }
    })?;
    get(conn, &memo.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::codes::tests::mk as mk_code;
    use crate::db::documents::{self, tests::new_doc};
    use crate::db::OpenProject;

    #[test]
    fn crud_on_each_target_and_cascade() {
        let p = OpenProject::in_memory("t").unwrap();
        let doc = documents::create(&p.conn, new_doc("abc"))
            .unwrap()
            .summary
            .id;
        let code = mk_code(&p.conn, "C", None).id;
        let project_memo = create(&p.conn, MemoTarget::default(), "P", "project-level").unwrap();
        let doc_memo = create(
            &p.conn,
            MemoTarget {
                document_id: Some(doc.clone()),
                ..Default::default()
            },
            "D",
            "doc",
        )
        .unwrap();
        let code_memo = create(
            &p.conn,
            MemoTarget {
                code_id: Some(code.clone()),
                ..Default::default()
            },
            "C",
            "code",
        )
        .unwrap();
        assert_eq!(
            list(&p.conn, &MemoTarget::default()).unwrap(),
            vec![project_memo.clone()]
        );
        assert_eq!(
            list(
                &p.conn,
                &MemoTarget {
                    document_id: Some(doc.clone()),
                    ..Default::default()
                }
            )
            .unwrap()
            .len(),
            1
        );
        assert!(matches!(
            create(
                &p.conn,
                MemoTarget {
                    document_id: Some(doc.clone()),
                    code_id: Some(code.clone()),
                    ..Default::default()
                },
                "",
                ""
            ),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            create(
                &p.conn,
                MemoTarget {
                    excerpt_id: Some("nope".into()),
                    ..Default::default()
                },
                "",
                ""
            ),
            Err(AppError::NotFound(_))
        ));
        let updated = update(&p.conn, &doc_memo.id, "D2", "changed").unwrap();
        assert_eq!(
            (updated.title.as_str(), updated.body.as_str()),
            ("D2", "changed")
        );
        let deleted = delete(&p.conn, &code_memo.id).unwrap();
        assert!(matches!(
            get(&p.conn, &code_memo.id),
            Err(AppError::NotFound(_))
        ));
        restore(&p.conn, &deleted).unwrap();
        assert_eq!(get(&p.conn, &code_memo.id).unwrap().body, "code");
        documents::delete(&p.conn, &doc).unwrap();
        assert!(matches!(
            get(&p.conn, &doc_memo.id),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            restore(&p.conn, &updated),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            update(&p.conn, "nope", "", ""),
            Err(AppError::NotFound(_))
        ));
    }
}
