//! Bulk operations: the same edit applied to many excerpts in one
//! transaction, plus moving every tag from one code to another.
//!
//! Every function reports exactly what it changed — the deleted snapshots, the
//! `(excerpt, code)` pairs it actually inserted or removed, the excerpts whose
//! tag moved — so the frontend can register a precise inverse on the undo
//! stack instead of guessing.

use std::collections::HashSet;

use rusqlite::{params, Connection};

use super::{codes, excerpts, memos, util};
use crate::error::{AppError, Result};
use crate::models::{BulkCodeReport, ExcerptSnapshot, RetagReport};

/// De-duplicate while keeping the caller's order.
fn unique(ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.iter()
        .filter(|id| seen.insert(id.as_str()))
        .cloned()
        .collect()
}

/// Fail with `NotFound` if any id is not an excerpt, in one query.
fn ensure_excerpts_exist(conn: &Connection, ids: &[String]) -> Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT id FROM excerpts WHERE id IN ({placeholders})"
    ))?;
    let found: HashSet<String> = stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    match ids.iter().find(|id| !found.contains(*id)) {
        Some(missing) => Err(AppError::NotFound(format!("excerpt {missing} not found"))),
        None => Ok(()),
    }
}

fn ensure_codes_exist(conn: &Connection, code_ids: &[String]) -> Result<()> {
    for id in code_ids {
        codes::get(conn, id)?;
    }
    Ok(())
}

/// Delete many excerpts in one transaction, returning a snapshot of each in the
/// order given so undo can `restore` them one by one. An unknown id aborts the
/// whole thing: nothing is deleted.
pub fn delete_many(conn: &Connection, ids: &[String]) -> Result<Vec<ExcerptSnapshot>> {
    let ids = unique(ids);
    ensure_excerpts_exist(conn, &ids)?;
    let tx = conn.unchecked_transaction()?;
    let mut snapshots = Vec::with_capacity(ids.len());
    for id in &ids {
        let excerpt = excerpts::get(&tx, id)?;
        let memos = memos::list_for_excerpt(&tx, id)?;
        tx.execute("DELETE FROM excerpts WHERE id = ?1", [id])?;
        snapshots.push(ExcerptSnapshot { excerpt, memos });
    }
    tx.commit()?;
    Ok(snapshots)
}

/// Tag every excerpt with every code, skipping pairs that already exist.
/// `pairs` holds only the tags actually inserted, so undoing is
/// `remove_codes_many` over exactly those.
pub fn add_codes_many(
    conn: &Connection,
    ids: &[String],
    code_ids: &[String],
) -> Result<BulkCodeReport> {
    let ids = unique(ids);
    let code_ids = unique(code_ids);
    ensure_excerpts_exist(conn, &ids)?;
    ensure_codes_exist(conn, &code_ids)?;
    let now = util::now();
    let tx = conn.unchecked_transaction()?;
    let mut report = BulkCodeReport::default();
    for id in &ids {
        let before = report.pairs.len();
        for code_id in &code_ids {
            let inserted = tx.execute(
                "INSERT OR IGNORE INTO excerpt_codes (excerpt_id, code_id, created_at) VALUES (?1, ?2, ?3)",
                params![id, code_id, now],
            )?;
            if inserted > 0 {
                report.pairs.push((id.clone(), code_id.clone()));
            }
        }
        if report.pairs.len() > before {
            report.affected += 1;
            tx.execute(
                "UPDATE excerpts SET updated_at = ?2 WHERE id = ?1",
                params![id, now],
            )?;
        }
    }
    tx.commit()?;
    Ok(report)
}

/// Drop every listed code from every listed excerpt. `pairs` holds only the
/// tags that were really there, so undoing is `add_codes_many` over exactly
/// those.
pub fn remove_codes_many(
    conn: &Connection,
    ids: &[String],
    code_ids: &[String],
) -> Result<BulkCodeReport> {
    let ids = unique(ids);
    let code_ids = unique(code_ids);
    ensure_excerpts_exist(conn, &ids)?;
    let now = util::now();
    let tx = conn.unchecked_transaction()?;
    let mut report = BulkCodeReport::default();
    for id in &ids {
        let before = report.pairs.len();
        for code_id in &code_ids {
            let removed = tx.execute(
                "DELETE FROM excerpt_codes WHERE excerpt_id = ?1 AND code_id = ?2",
                params![id, code_id],
            )?;
            if removed > 0 {
                report.pairs.push((id.clone(), code_id.clone()));
            }
        }
        if report.pairs.len() > before {
            report.affected += 1;
            tx.execute(
                "UPDATE excerpts SET updated_at = ?2 WHERE id = ?1",
                params![id, now],
            )?;
        }
    }
    tx.commit()?;
    Ok(report)
}

/// Move every excerpt tagged `from_code_id` onto `to_code_id`.
///
/// Unlike [`codes::merge`], the source code survives (with no excerpts left)
/// and its sub-codes and memos stay where they are. Excerpts that already
/// carried the target keep their existing tag — they only lose the source —
/// and are reported separately so undo can put the source back without
/// stripping a target tag the user never added.
pub fn retag_code(conn: &Connection, from_code_id: &str, to_code_id: &str) -> Result<RetagReport> {
    if from_code_id == to_code_id {
        return Err(AppError::Validation(
            "cannot move a code's excerpts onto itself".into(),
        ));
    }
    codes::get(conn, from_code_id)?;
    codes::get(conn, to_code_id)?;

    let tx = conn.unchecked_transaction()?;
    let mut stmt = tx.prepare(
        "SELECT ec.excerpt_id,
                EXISTS (SELECT 1 FROM excerpt_codes t
                        WHERE t.excerpt_id = ec.excerpt_id AND t.code_id = ?2)
         FROM excerpt_codes ec JOIN excerpts e ON e.id = ec.excerpt_id
         WHERE ec.code_id = ?1
         ORDER BY e.document_id, e.start_pos, ec.excerpt_id",
    )?;
    let targets: Vec<(String, bool)> = stmt
        .query_map(params![from_code_id, to_code_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let now = util::now();
    let mut report = RetagReport::default();
    for (excerpt_id, already_tagged) in targets {
        if already_tagged {
            report.already_had.push(excerpt_id.clone());
        } else {
            tx.execute(
                "INSERT INTO excerpt_codes (excerpt_id, code_id, created_at) VALUES (?1, ?2, ?3)",
                params![excerpt_id, to_code_id, now],
            )?;
            report.moved.push(excerpt_id.clone());
        }
        tx.execute(
            "DELETE FROM excerpt_codes WHERE excerpt_id = ?1 AND code_id = ?2",
            params![excerpt_id, from_code_id],
        )?;
        tx.execute(
            "UPDATE excerpts SET updated_at = ?2 WHERE id = ?1",
            params![excerpt_id, now],
        )?;
    }
    tx.commit()?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::codes::tests::mk as mk_code;
    use crate::db::documents::tests::new_doc;
    use crate::db::{documents, OpenProject};
    use crate::models::{ApplyCodesInput, MemoTarget};

    struct Fixture {
        p: OpenProject,
        doc: String,
        a: String,
        b: String,
    }

    fn setup() -> Fixture {
        let p = OpenProject::in_memory("t").unwrap();
        let doc = documents::create(&p.conn, new_doc("one two three four five six seven"))
            .unwrap()
            .summary
            .id;
        let a = mk_code(&p.conn, "A", None).id;
        let b = mk_code(&p.conn, "B", None).id;
        Fixture { p, doc, a, b }
    }

    fn apply(f: &Fixture, start: i64, end: i64, code_ids: &[&str]) -> String {
        excerpts::apply_codes(
            &f.p.conn,
            ApplyCodesInput {
                document_id: f.doc.clone(),
                start_pos: start,
                end_pos: end,
                code_ids: code_ids.iter().map(|c| c.to_string()).collect(),
            },
        )
        .unwrap()
        .excerpt
        .id
    }

    fn codes_of(f: &Fixture, id: &str) -> Vec<String> {
        excerpts::get(&f.p.conn, id).unwrap().code_ids
    }

    fn count(f: &Fixture) -> i64 {
        f.p.conn
            .query_row("SELECT count(*) FROM excerpts", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn delete_many_is_atomic_and_restores() {
        let f = setup();
        let e1 = apply(&f, 0, 3, &[&f.a]);
        let e2 = apply(&f, 4, 7, &[&f.a, &f.b]);
        let e3 = apply(&f, 8, 13, &[]);
        memos::create(
            &f.p.conn,
            MemoTarget {
                excerpt_id: Some(e2.clone()),
                ..Default::default()
            },
            "note",
            "body",
        )
        .unwrap();

        // An unknown id aborts before anything is deleted.
        let ids = vec![e1.clone(), "nope".to_string()];
        assert!(matches!(
            delete_many(&f.p.conn, &ids),
            Err(AppError::NotFound(_))
        ));
        assert_eq!(count(&f), 3);

        // Duplicates collapse to one snapshot each.
        let snaps =
            delete_many(&f.p.conn, &[e1.clone(), e2.clone(), e1.clone(), e3.clone()]).unwrap();
        assert_eq!(
            snaps
                .iter()
                .map(|s| s.excerpt.id.clone())
                .collect::<Vec<_>>(),
            vec![e1.clone(), e2.clone(), e3.clone()]
        );
        assert_eq!(snaps[1].memos.len(), 1);
        assert_eq!(count(&f), 0);

        // Undo: restore each snapshot with its original id, codes and memos.
        for s in &snaps {
            excerpts::restore(&f.p.conn, s).unwrap();
        }
        assert_eq!(count(&f), 3);
        assert_eq!(codes_of(&f, &e2), vec![f.a.clone(), f.b.clone()]);
        assert_eq!(excerpts::get(&f.p.conn, &e2).unwrap().memo_count, 1);
        assert!(codes_of(&f, &e3).is_empty());
    }

    #[test]
    fn add_codes_many_reports_only_new_pairs_and_undoes_cleanly() {
        let f = setup();
        let e1 = apply(&f, 0, 3, &[&f.a]);
        let e2 = apply(&f, 4, 7, &[]);
        let e3 = apply(&f, 8, 13, &[]);

        let report = add_codes_many(
            &f.p.conn,
            &[e1.clone(), e2.clone(), e3.clone()],
            &[f.a.clone(), f.b.clone()],
        )
        .unwrap();
        // e1 already had A, so only five of the six pairs are new.
        assert_eq!(report.affected, 3);
        assert_eq!(report.pairs.len(), 5);
        assert!(!report.pairs.contains(&(e1.clone(), f.a.clone())));
        assert_eq!(codes_of(&f, &e2), vec![f.a.clone(), f.b.clone()]);

        // Re-running changes nothing.
        let again = add_codes_many(
            &f.p.conn,
            &[e1.clone(), e2.clone()],
            std::slice::from_ref(&f.a),
        )
        .unwrap();
        assert_eq!(again.affected, 0);
        assert!(again.pairs.is_empty());

        // Undo: remove exactly the pairs that were added, grouped by code.
        for code_id in [&f.a, &f.b] {
            let ids: Vec<String> = report
                .pairs
                .iter()
                .filter(|(_, c)| c == code_id)
                .map(|(e, _)| e.clone())
                .collect();
            remove_codes_many(&f.p.conn, &ids, std::slice::from_ref(code_id)).unwrap();
        }
        assert_eq!(codes_of(&f, &e1), vec![f.a.clone()]);
        assert!(codes_of(&f, &e2).is_empty());
        assert!(codes_of(&f, &e3).is_empty());
    }

    #[test]
    fn remove_codes_many_reports_only_real_pairs_and_undoes_cleanly() {
        let f = setup();
        let e1 = apply(&f, 0, 3, &[&f.a, &f.b]);
        let e2 = apply(&f, 4, 7, &[&f.b]);

        let report = remove_codes_many(
            &f.p.conn,
            &[e1.clone(), e2.clone()],
            std::slice::from_ref(&f.a),
        )
        .unwrap();
        assert_eq!(report.affected, 1);
        assert_eq!(report.pairs, vec![(e1.clone(), f.a.clone())]);
        assert_eq!(codes_of(&f, &e1), vec![f.b.clone()]);
        assert_eq!(codes_of(&f, &e2), vec![f.b.clone()]);

        // Undo puts back exactly what was removed.
        add_codes_many(
            &f.p.conn,
            std::slice::from_ref(&e1),
            std::slice::from_ref(&f.a),
        )
        .unwrap();
        assert_eq!(codes_of(&f, &e1), vec![f.a.clone(), f.b.clone()]);
    }

    #[test]
    fn bulk_code_changes_validate_their_arguments() {
        let f = setup();
        let e1 = apply(&f, 0, 3, &[&f.a]);
        let missing = vec!["nope".to_string()];
        assert!(matches!(
            add_codes_many(&f.p.conn, &missing, std::slice::from_ref(&f.a)),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            add_codes_many(&f.p.conn, std::slice::from_ref(&e1), &missing),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            remove_codes_many(&f.p.conn, &missing, std::slice::from_ref(&f.a)),
            Err(AppError::NotFound(_))
        ));
        // Nothing to do is not an error.
        assert_eq!(add_codes_many(&f.p.conn, &[], &[]).unwrap().affected, 0);
        assert_eq!(remove_codes_many(&f.p.conn, &[], &[]).unwrap().affected, 0);
        // Removing a code the excerpt never had is a no-op.
        assert!(
            remove_codes_many(&f.p.conn, &[e1], std::slice::from_ref(&f.b))
                .unwrap()
                .pairs
                .is_empty()
        );
    }

    #[test]
    fn retag_moves_every_tag_keeps_the_source_code_and_is_invertible() {
        let f = setup();
        let e1 = apply(&f, 0, 3, &[&f.a]);
        let e2 = apply(&f, 4, 7, &[&f.a, &f.b]); // already carries the target
        let e3 = apply(&f, 8, 13, &[&f.b]); // untouched by the move
        let c = mk_code(&f.p.conn, "C", None).id;

        assert!(matches!(
            retag_code(&f.p.conn, &f.a, &f.a),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            retag_code(&f.p.conn, &f.a, "nope"),
            Err(AppError::NotFound(_))
        ));

        let report = retag_code(&f.p.conn, &f.a, &f.b).unwrap();
        assert_eq!(report.moved, vec![e1.clone()]);
        assert_eq!(report.already_had, vec![e2.clone()]);
        assert_eq!(codes_of(&f, &e1), vec![f.b.clone()]);
        assert_eq!(codes_of(&f, &e2), vec![f.b.clone()]);
        assert_eq!(codes_of(&f, &e3), vec![f.b.clone()]);
        // The source code is still in the codebook, now with no excerpts.
        assert_eq!(codes::get(&f.p.conn, &f.a).unwrap().excerpt_count, 0);
        assert_eq!(codes::get(&f.p.conn, &f.b).unwrap().excerpt_count, 3);

        // Undo: give the source back to everything it held, and take the
        // target away only from the excerpts that gained it.
        let all: Vec<String> = report
            .moved
            .iter()
            .chain(report.already_had.iter())
            .cloned()
            .collect();
        add_codes_many(&f.p.conn, &all, std::slice::from_ref(&f.a)).unwrap();
        remove_codes_many(&f.p.conn, &report.moved, std::slice::from_ref(&f.b)).unwrap();
        assert_eq!(codes_of(&f, &e1), vec![f.a.clone()]);
        assert_eq!(codes_of(&f, &e2), vec![f.a.clone(), f.b.clone()]);
        assert_eq!(codes_of(&f, &e3), vec![f.b.clone()]);

        // Moving a code with no excerpts anywhere is an empty no-op.
        let empty = retag_code(&f.p.conn, &c, &f.b).unwrap();
        assert!(empty.moved.is_empty() && empty.already_had.is_empty());
    }
}
