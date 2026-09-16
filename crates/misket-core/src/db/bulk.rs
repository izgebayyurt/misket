//! Bulk operations: the same edit applied to many excerpts in one
//! transaction, plus moving every tag from one code to another.
//!
//! Every function reports exactly what it changed — the deleted snapshots, the
//! `(excerpt, code)` pairs it actually inserted or removed, the excerpts whose
//! tag moved — so the frontend can register a precise inverse on the undo
//! stack instead of guessing.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;

use super::{activity, codes, documents, excerpts, memos, text, util};
use crate::error::{AppError, Result};
use crate::models::{AutoCodeHit, AutoCodeReport, BulkCodeReport, ExcerptSnapshot, RetagReport};

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
    let tx = util::tx(conn)?;
    let mut snapshots = Vec::with_capacity(ids.len());
    for id in &ids {
        let excerpt = excerpts::get(&tx, id)?;
        let memos = memos::list_for_excerpt(&tx, id)?;
        tx.execute("DELETE FROM excerpts WHERE id = ?1", [id])?;
        snapshots.push(ExcerptSnapshot { excerpt, memos });
    }
    if !ids.is_empty() {
        activity::record(
            &tx,
            "bulk.excerpts_deleted",
            "excerpt",
            None,
            format!("Deleted {} excerpts", ids.len()),
            json!({ "excerptIds": ids, "count": ids.len() }),
        )?;
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
    let tx = util::tx(conn)?;
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
    log_bulk_codes(&tx, "bulk.codes_added", "Added", &code_ids, &report)?;
    tx.commit()?;
    Ok(report)
}

/// The one entry a bulk tagging writes: what changed, over how many excerpts.
fn log_bulk_codes(
    conn: &Connection,
    kind: &str,
    verb: &str,
    code_ids: &[String],
    report: &BulkCodeReport,
) -> Result<()> {
    if report.affected == 0 {
        return Ok(());
    }
    let names: Vec<String> = code_ids
        .iter()
        .map(|id| activity::code_name(conn, id))
        .collect();
    let preposition = if verb == "Added" { "to" } else { "from" };
    activity::record(
        conn,
        kind,
        "excerpt",
        None,
        format!(
            "{verb} {} {preposition} {} excerpts",
            names.join(", "),
            report.affected
        ),
        json!({
            "codeIds": code_ids,
            "codeNames": names,
            "affected": report.affected,
            "excerptIds": report
                .pairs
                .iter()
                .map(|(e, _)| e.clone())
                .collect::<Vec<_>>(),
        }),
    )
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
    let tx = util::tx(conn)?;
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
    log_bulk_codes(&tx, "bulk.codes_removed", "Removed", &code_ids, &report)?;
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

    let tx = util::tx(conn)?;
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
    let (from_name, to_name) = (
        activity::code_name(&tx, from_code_id),
        activity::code_name(&tx, to_code_id),
    );
    let total = report.moved.len() + report.already_had.len();
    activity::record(
        &tx,
        "bulk.retagged",
        "code",
        Some(from_code_id),
        format!("Moved {total} excerpts from \"{from_name}\" to \"{to_name}\""),
        json!({
            "fromCodeId": from_code_id,
            "fromCodeName": from_name,
            "toCodeId": to_code_id,
            "toCodeName": to_name,
            "moved": report.moved,
            "alreadyHad": report.already_had,
        }),
    )?;
    tx.commit()?;
    Ok(report)
}

/// Auto-code every hit with `code_id`, in one transaction: a hit whose exact
/// `[start, end)` range already has an excerpt reuses it (adding the code
/// only if it is missing); otherwise a new text excerpt is created. See
/// [`AutoCodeReport`] for exactly what undo needs to invert this.
pub fn auto_code(conn: &Connection, hits: &[AutoCodeHit], code_id: &str) -> Result<AutoCodeReport> {
    codes::get(conn, code_id)?;
    let now = util::now();
    let tx = util::tx(conn)?;
    let mut report = AutoCodeReport::default();
    // A bulk call is usually every match in one or a handful of documents,
    // so cache each document's text instead of re-reading it per hit.
    let mut doc_cache: HashMap<String, (String, i64)> = HashMap::new();
    for hit in hits {
        if !doc_cache.contains_key(&hit.document_id) {
            let text = documents::get_text(&tx, &hit.document_id)?;
            doc_cache.insert(hit.document_id.clone(), text);
        }
        let (doc_text, len) = doc_cache.get(&hit.document_id).expect("just inserted");
        if hit.start_pos < 0 || hit.end_pos <= hit.start_pos || hit.end_pos > *len {
            return Err(AppError::Validation(format!(
                "range {}..{} is outside document {} (length {len})",
                hit.start_pos, hit.end_pos, hit.document_id
            )));
        }
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM excerpts
                 WHERE document_id = ?1 AND kind = 'text' AND start_pos = ?2 AND end_pos = ?3",
                params![hit.document_id, hit.start_pos, hit.end_pos],
                |r| r.get(0),
            )
            .optional()?;
        match existing {
            None => {
                let snapshot = text::cp_slice(doc_text, hit.start_pos, hit.end_pos)
                    .ok_or_else(|| {
                        AppError::Validation(format!(
                            "range {}..{} is not sliceable",
                            hit.start_pos, hit.end_pos
                        ))
                    })?
                    .to_string();
                let id = util::new_id();
                tx.execute(
                    "INSERT INTO excerpts (id, document_id, kind, start_pos, end_pos, snapshot, created_at, updated_at)
                     VALUES (?1, ?2, 'text', ?3, ?4, ?5, ?6, ?6)",
                    params![id, hit.document_id, hit.start_pos, hit.end_pos, snapshot, now],
                )?;
                tx.execute(
                    "INSERT INTO excerpt_codes (excerpt_id, code_id, created_at) VALUES (?1, ?2, ?3)",
                    params![id, code_id, now],
                )?;
                report.created_excerpt_ids.push(id);
            }
            Some(id) => {
                let already_coded: bool = tx.query_row(
                    "SELECT EXISTS (SELECT 1 FROM excerpt_codes WHERE excerpt_id = ?1 AND code_id = ?2)",
                    params![id, code_id],
                    |r| r.get(0),
                )?;
                if already_coded {
                    report.already_coded += 1;
                } else {
                    tx.execute(
                        "INSERT INTO excerpt_codes (excerpt_id, code_id, created_at) VALUES (?1, ?2, ?3)",
                        params![id, code_id, now],
                    )?;
                    tx.execute(
                        "UPDATE excerpts SET updated_at = ?2 WHERE id = ?1",
                        params![id, now],
                    )?;
                    report.reused_excerpt_ids.push(id);
                }
            }
        }
    }
    let code_name = codes::get(&tx, code_id).map(|c| c.name).unwrap_or_default();
    activity::record(
        &tx,
        "bulk.auto_coded",
        "code",
        Some(code_id),
        format!(
            "Auto-coded {} matches with {code_name} ({} new excerpts)",
            hits.len(),
            report.created_excerpt_ids.len()
        ),
        json!({
            "codeId": code_id,
            "created": report.created_excerpt_ids,
            "reused": report.reused_excerpt_ids,
            "alreadyCoded": report.already_coded,
        }),
    )?;
    tx.commit()?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::codes::tests::mk as mk_code;
    use crate::db::documents::tests::{new_doc, new_image};
    use crate::db::OpenProject;
    use crate::models::{ApplyCodesInput, AutoCodeHit, MemoTarget, Rect};

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
                start_pos: Some(start),
                end_pos: Some(end),
                code_ids: code_ids.iter().map(|c| c.to_string()).collect(),
                ..Default::default()
            },
        )
        .unwrap()
        .excerpt
        .id
    }

    /// An image document with one region excerpt on it, tagged `A`.
    fn image_region(f: &Fixture) -> String {
        let img = documents::create_image(&f.p.conn, new_image(b"\x89PNG pixels"))
            .unwrap()
            .summary
            .id;
        excerpts::apply_codes(
            &f.p.conn,
            ApplyCodesInput {
                document_id: img,
                kind: Some("image_region".into()),
                geometry: Some(Rect {
                    x: 0.1,
                    y: 0.2,
                    w: 0.3,
                    h: 0.4,
                }),
                code_ids: vec![f.a.clone()],
                ..Default::default()
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

    /// Bulk edits are about excerpts, not about text: an image region is
    /// tagged, deleted and restored like any other excerpt.
    #[test]
    fn bulk_edits_cover_image_regions() {
        let f = setup();
        let region = image_region(&f);
        let text = apply(&f, 0, 3, &[&f.a]);

        let both = [region.clone(), text];
        let report = add_codes_many(&f.p.conn, &both, std::slice::from_ref(&f.b)).unwrap();
        assert_eq!(report.affected, 2);
        assert_eq!(codes_of(&f, &region), vec![f.a.clone(), f.b.clone()]);

        let snapshots = delete_many(&f.p.conn, &both).unwrap();
        assert_eq!(count(&f), 0);
        let restored = excerpts::restore(&f.p.conn, &snapshots[0]).unwrap();
        assert_eq!(restored.id, region);
        assert_eq!(restored.kind, "image_region");
        assert_eq!(restored.geometry, snapshots[0].excerpt.geometry);
        assert_eq!(restored.start_pos, None);
        assert_eq!(codes_of(&f, &region).len(), 2);
    }

    fn hit(doc: &str, s: i64, e: i64) -> AutoCodeHit {
        AutoCodeHit {
            document_id: doc.into(),
            start_pos: s,
            end_pos: e,
        }
    }

    #[test]
    fn auto_code_creates_new_excerpts_and_reuses_existing_ranges() {
        let f = setup();
        // An excerpt already sits at the second hit's range, coded with B.
        let existing = apply(&f, 4, 7, &[&f.b]);
        let hits = [hit(&f.doc, 0, 3), hit(&f.doc, 4, 7)];
        let report = auto_code(&f.p.conn, &hits, &f.a).unwrap();
        assert_eq!(report.created_excerpt_ids.len(), 1);
        assert_eq!(report.reused_excerpt_ids, vec![existing.clone()]);
        assert_eq!(report.already_coded, 0);
        assert_eq!(
            codes_of(&f, &report.created_excerpt_ids[0]),
            vec![f.a.clone()]
        );
        assert_eq!(codes_of(&f, &existing), vec![f.a.clone(), f.b.clone()]);
        assert_eq!(count(&f), 2);
    }

    #[test]
    fn auto_code_counts_hits_already_carrying_the_code_without_duplicating() {
        let f = setup();
        let e1 = apply(&f, 0, 3, &[&f.a]);
        // The same range hit twice, plus a genuinely new one.
        let hits = [hit(&f.doc, 0, 3), hit(&f.doc, 0, 3), hit(&f.doc, 8, 13)];
        let report = auto_code(&f.p.conn, &hits, &f.a).unwrap();
        assert_eq!(report.created_excerpt_ids.len(), 1);
        assert!(report.reused_excerpt_ids.is_empty());
        assert_eq!(report.already_coded, 2);
        assert_eq!(codes_of(&f, &e1), vec![f.a.clone()]);
        assert_eq!(count(&f), 2);
    }

    #[test]
    fn auto_code_validates_and_is_atomic() {
        let f = setup();
        assert!(matches!(
            auto_code(&f.p.conn, &[], "nope"),
            Err(AppError::NotFound(_))
        ));
        // The first hit is valid, the second is out of range: nothing from
        // either should be left behind.
        let hits = [hit(&f.doc, 0, 3), hit(&f.doc, 0, 99)];
        assert!(matches!(
            auto_code(&f.p.conn, &hits, &f.a),
            Err(AppError::Validation(_))
        ));
        assert_eq!(count(&f), 0);
        assert!(matches!(
            auto_code(&f.p.conn, &[hit("nope", 0, 1)], &f.a),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn auto_code_report_supports_undo() {
        let f = setup();
        let existing = apply(&f, 4, 7, &[&f.b]);
        let hits = [hit(&f.doc, 0, 3), hit(&f.doc, 4, 7)];
        let report = auto_code(&f.p.conn, &hits, &f.a).unwrap();
        assert_eq!(count(&f), 2);

        // Undo: delete exactly what was created, and remove the code from
        // exactly what was reused — the pre-existing excerpt survives with
        // its original code intact.
        delete_many(&f.p.conn, &report.created_excerpt_ids).unwrap();
        remove_codes_many(
            &f.p.conn,
            &report.reused_excerpt_ids,
            std::slice::from_ref(&f.a),
        )
        .unwrap();
        assert_eq!(count(&f), 1);
        assert_eq!(codes_of(&f, &existing), vec![f.b.clone()]);
    }
}
