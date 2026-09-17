//! Coders: who did the coding.
//!
//! Misket has no accounts and no server. A *coder* is an install: a UUID
//! generated once and kept in the app's settings, plus the name and colour
//! that install signs with. The id is the stable part — names change, two
//! people can share one — and it is what lets a later "pull from another
//! coder's copy" tell two people's work apart, and an inter-rater view line
//! them up.
//!
//! Three tables carry it (schema 11): `excerpt_codes.coder_id`, which is part
//! of the primary key so two coders can apply the same code to one passage;
//! `memos.coder_id`; and `history.coder_id`, so an undone and redone coding
//! comes back attributed to whoever made it.
//!
//! The local coder is put on the connection once, at open, by
//! [`ensure_local`], the same way the actor name is
//! ([`crate::db::activity::set_actor`]): a `TEMP` table, per connection,
//! never written to the file. Domain functions read it with
//! [`crate::db::history::local_coder`] instead of taking a parameter.

use rusqlite::{params, Connection, OptionalExtension};

use super::{history, util};
use crate::error::Result;
use crate::models::{Coder, CoderSummary};

/// A fallback colour for a coder whose row has not travelled with the work —
/// a coding pulled from someone else's copy before their `coders` row was.
/// Derived from the id, so the same stranger keeps the same colour.
pub fn color_for(id: &str) -> String {
    let palette = super::codes::PALETTE;
    let n: usize = id.bytes().map(|b| b as usize).sum();
    palette[n % palette.len()].to_string()
}

fn row_to_coder(r: &rusqlite::Row) -> rusqlite::Result<Coder> {
    Ok(Coder {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        created_at: r.get(3)?,
    })
}

/// One coder's row, or `None` for an id nothing has recorded.
pub fn get(conn: &Connection, id: &str) -> Result<Option<Coder>> {
    Ok(conn
        .query_row(
            "SELECT id, name, color, created_at FROM coders WHERE id = ?1",
            [id],
            row_to_coder,
        )
        .optional()?)
}

/// Write a coder's row, keeping its original `created_at` if it already has
/// one. Used by [`ensure_local`] and by anything that imports somebody else's
/// coders along with their work.
pub fn upsert(conn: &Connection, coder: &Coder) -> Result<Coder> {
    conn.execute(
        "INSERT INTO coders (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color",
        params![coder.id, coder.name, coder.color, coder.created_at],
    )?;
    Ok(get(conn, &coder.id)?.unwrap_or_else(|| coder.clone()))
}

/// Adopt every unattributed row (`coder_id = ''`) as `coder_id`'s.
///
/// Those are the rows schema 11 left behind: everything coded before the
/// project file knew whose work it held. The first open after the migration
/// claims them for whoever is at the keyboard — which is right, because a
/// single-coder project is the only kind that could exist before now. It runs
/// on every open and is a no-op from the second one on.
pub fn backfill(conn: &Connection, coder_id: &str) -> Result<i64> {
    // `OR REPLACE`, because the coder may already have their own row for a
    // pair an unattributed row also names; the attributed one wins.
    let mut n = conn.execute(
        "UPDATE OR REPLACE excerpt_codes SET coder_id = ?1 WHERE coder_id = ''",
        [coder_id],
    )? as i64;
    n += conn.execute(
        "UPDATE memos SET coder_id = ?1 WHERE coder_id = ''",
        [coder_id],
    )? as i64;
    n += conn.execute(
        "UPDATE history SET coder_id = ?1 WHERE coder_id = ''",
        [coder_id],
    )? as i64;
    Ok(n)
}

/// Make `id` the coder this connection writes as, and make sure the project
/// file knows their name and colour.
///
/// Called by the desktop app right after opening or creating a project, with
/// the id, name and colour from the app's settings. Tests call it directly,
/// the way they call [`crate::db::activity::set_actor`].
///
/// Everything it does is idempotent: the row is upserted, the local id is
/// replaced, and the backfill finds nothing to do after the first run.
pub fn ensure_local(conn: &Connection, id: &str, name: &str, color: &str) -> Result<Coder> {
    let id = id.trim();
    if id.is_empty() {
        return Err(crate::error::AppError::Validation(
            "a coder id is required".into(),
        ));
    }
    let tx = util::tx(conn)?;
    let color = if color.trim().is_empty() {
        color_for(id)
    } else {
        color.trim().to_string()
    };
    let coder = upsert(
        &tx,
        &Coder {
            id: id.to_string(),
            name: name.trim().to_string(),
            color,
            created_at: util::now(),
        },
    )?;
    backfill(&tx, id)?;
    tx.commit()?;
    history::set_local_coder(conn, id)?;
    Ok(coder)
}

/// Every coder this project knows about, with how much of it is theirs.
///
/// A coder id that appears on a coding or a memo but has no row of its own —
/// work pulled from a copy whose `coders` row did not travel with it — is
/// listed too, named by its id, so nothing in the file is invisible to a
/// filter. Ordered with the local coder first, then by name.
pub fn list(conn: &Connection) -> Result<Vec<CoderSummary>> {
    let local = history::local_coder(conn);
    let mut stmt = conn.prepare(
        "SELECT ids.coder_id,
                COALESCE(c.name, ''),
                COALESCE(c.color, ''),
                (SELECT count(*) FROM excerpt_codes ec WHERE ec.coder_id = ids.coder_id),
                (SELECT count(*) FROM memos m WHERE m.coder_id = ids.coder_id)
           FROM (SELECT id AS coder_id FROM coders
                 UNION SELECT coder_id FROM excerpt_codes
                 UNION SELECT coder_id FROM memos) AS ids
           LEFT JOIN coders c ON c.id = ids.coder_id
          WHERE ids.coder_id <> ''",
    )?;
    let mut out: Vec<CoderSummary> = stmt
        .query_map([], |r| {
            let id: String = r.get(0)?;
            let name: String = r.get(1)?;
            let color: String = r.get(2)?;
            Ok(CoderSummary {
                is_local: id == local,
                name: if name.is_empty() { id.clone() } else { name },
                color: if color.is_empty() {
                    color_for(&id)
                } else {
                    color
                },
                coding_count: r.get(3)?,
                memo_count: r.get(4)?,
                id,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    out.sort_by(|a, b| {
        b.is_local
            .cmp(&a.is_local)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::{analysis, codes, documents, excerpts, memos, OpenProject};
    use crate::models::{ApplyCodesInput, ExcerptFilter, MemoTarget};

    /// A project whose local coder is `id`, like `set_actor(conn, "Ada")`.
    pub(crate) fn as_coder(conn: &Connection, id: &str, name: &str) {
        ensure_local(conn, id, name, "").unwrap();
    }

    #[test]
    fn ensure_local_is_idempotent_and_follows_the_settings() {
        let p = OpenProject::in_memory("t").unwrap();
        let c = ensure_local(&p.conn, "ada", "Ada", "#D9534F").unwrap();
        assert_eq!((c.name.as_str(), c.color.as_str()), ("Ada", "#D9534F"));
        let created_at = c.created_at.clone();
        // A rename in settings follows; the row keeps its birthday.
        let again = ensure_local(&p.conn, "ada", "Ada L", "#5CB85C").unwrap();
        assert_eq!(
            (again.name.as_str(), again.color.as_str()),
            ("Ada L", "#5CB85C")
        );
        assert_eq!(again.created_at, created_at);
        let n: i64 = p
            .conn
            .query_row("SELECT count(*) FROM coders", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        assert_eq!(history::local_coder(&p.conn), "ada");
        // An empty colour is filled in rather than stored blank.
        let other = ensure_local(&p.conn, "bob", "Bob", "  ").unwrap();
        assert_eq!(other.color, color_for("bob"));
    }

    #[test]
    fn a_migrated_project_backfills_its_codings_once() {
        let p = OpenProject::in_memory("t").unwrap();
        let c = &p.conn;
        let doc = documents::create(c, documents::tests::new_doc("One two three four."))
            .unwrap()
            .summary
            .id;
        let code = codes::tests::mk(c, "Alpha", None);
        ensure_local(c, "ada", "Ada", "").unwrap();
        let applied = excerpts::apply_codes(
            c,
            ApplyCodesInput {
                document_id: doc.clone(),
                start_pos: Some(0),
                end_pos: Some(7),
                code_ids: vec![code.id.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        memos::create(
            c,
            MemoTarget {
                excerpt_id: Some(applied.excerpt.id.clone()),
                ..Default::default()
            },
            "Note",
            "body",
        )
        .unwrap();
        // Pretend the rows came from a pre-schema-11 file.
        c.execute_batch(
            "UPDATE excerpt_codes SET coder_id = '';
             UPDATE memos SET coder_id = '';
             UPDATE history SET coder_id = '';",
        )
        .unwrap();
        let moved = backfill(c, "ada").unwrap();
        assert!(moved >= 3, "codings, memos and history all get an owner");
        assert_eq!(backfill(c, "ada").unwrap(), 0, "and only once");
        let unattributed: i64 = c
            .query_row(
                "SELECT count(*) FROM excerpt_codes WHERE coder_id = ''",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(unattributed, 0);
    }

    /// Everything two coders working on one project turns on: the primary
    /// key, what "remove this code" takes off, and what a filter shows.
    #[test]
    fn two_coders_can_code_the_same_passage_and_each_owns_their_row() {
        let p = OpenProject::in_memory("t").unwrap();
        let c = &p.conn;
        let doc = documents::create(c, documents::tests::new_doc("One two three four five."))
            .unwrap()
            .summary
            .id;
        let alpha = codes::tests::mk(c, "Alpha", None).id;
        let beta = codes::tests::mk(c, "Beta", None).id;

        let code_it = |code_id: &str, start, end| {
            excerpts::apply_codes(
                c,
                ApplyCodesInput {
                    document_id: doc.clone(),
                    start_pos: Some(start),
                    end_pos: Some(end),
                    code_ids: vec![code_id.to_string()],
                    ..Default::default()
                },
            )
            .unwrap()
        };

        as_coder(c, "ada", "Ada");
        let shared = code_it(&alpha, 0, 7).excerpt.id;
        // The same coder applying the same code again is an upsert, not a
        // second row.
        assert!(code_it(&alpha, 0, 7).added_code_ids.is_empty());

        as_coder(c, "bob", "Bob");
        // Bob agrees with Ada, and adds a code of his own.
        assert_eq!(code_it(&alpha, 0, 7).added_code_ids, vec![alpha.clone()]);
        code_it(&beta, 0, 7);
        let only_bob = code_it(&beta, 8, 13).excerpt.id;

        let e = excerpts::get(c, &shared).unwrap();
        // Two codes on the passage, three codings behind them.
        assert_eq!(e.code_ids, vec![alpha.clone(), beta.clone()]);
        assert_eq!(e.codings.len(), 3);
        assert_eq!(
            e.codings
                .iter()
                .filter(|x| x.code_id == alpha)
                .map(|x| x.coder_id.as_str())
                .collect::<Vec<_>>(),
            vec!["ada", "bob"]
        );

        // Filtering by coder narrows which excerpts come back.
        let by = |ids: &[&str]| {
            excerpts::query(
                c,
                &ExcerptFilter {
                    coder_ids: Some(ids.iter().map(|s| s.to_string()).collect()),
                    ..Default::default()
                },
            )
            .unwrap()
            .rows
            .into_iter()
            .map(|r| r.excerpt.id)
            .collect::<Vec<_>>()
        };
        assert_eq!(by(&["bob"]).len(), 2);
        assert_eq!(by(&["ada"]), vec![shared.clone()]);
        assert_eq!(by(&["zoe"]), Vec::<String>::new());
        // No filter, and an empty one, both mean everyone.
        assert_eq!(by(&[]).len(), 2);
        assert_eq!(
            excerpts::query(c, &ExcerptFilter::default()).unwrap().total,
            2
        );

        // Removing "my" coding of Alpha takes Bob's row and leaves Ada's.
        let after = excerpts::remove_code(c, &shared, &alpha, None).unwrap();
        assert!(after.code_ids.contains(&alpha), "Ada still has it");
        assert_eq!(
            after
                .codings
                .iter()
                .filter(|x| x.code_id == alpha)
                .map(|x| x.coder_id.as_str())
                .collect::<Vec<_>>(),
            vec!["ada"]
        );
        // And naming a coder removes theirs, which is what "Remove Ada's
        // coding" in the inspector does.
        let after = excerpts::remove_code(c, &shared, &alpha, Some("ada")).unwrap();
        assert!(!after.code_ids.contains(&alpha));

        // Frequencies count distinct (excerpt, code) pairs, so Bob agreeing
        // with Ada on Beta does not make it look twice as common.
        let freq = |coders: Option<&[String]>| {
            analysis::code_frequencies(c, None, None, coders)
                .unwrap()
                .into_iter()
                .find(|f| f.code_id == beta)
                .unwrap()
                .own
        };
        as_coder(c, "ada", "Ada");
        excerpts::add_codes(c, &only_bob, std::slice::from_ref(&beta)).unwrap();
        assert_eq!(freq(None), 2, "two excerpts carry Beta, not three codings");
        assert_eq!(freq(Some(&["ada".to_string()])), 1);
        assert_eq!(freq(Some(&["bob".to_string()])), 2);
    }

    #[test]
    fn list_counts_work_and_names_a_stranger_by_id() {
        let p = OpenProject::in_memory("t").unwrap();
        let c = &p.conn;
        let doc = documents::create(c, documents::tests::new_doc("One two three four."))
            .unwrap()
            .summary
            .id;
        let code = codes::tests::mk(c, "Alpha", None);
        as_coder(c, "ada", "Ada");
        let applied = excerpts::apply_codes(
            c,
            ApplyCodesInput {
                document_id: doc.clone(),
                start_pos: Some(0),
                end_pos: Some(7),
                code_ids: vec![code.id.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        // Somebody else's coding of the same passage, arriving without a row.
        c.execute(
            "INSERT INTO excerpt_codes (excerpt_id, code_id, coder_id, created_at)
             VALUES (?1, ?2, 'zoe', '2024-01-01T00:00:00Z')",
            params![applied.excerpt.id, code.id],
        )
        .unwrap();

        let list = list(c).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].is_local && list[0].id == "ada");
        assert_eq!(list[0].coding_count, 1);
        let zoe = &list[1];
        assert_eq!((zoe.id.as_str(), zoe.name.as_str()), ("zoe", "zoe"));
        assert_eq!(zoe.color, color_for("zoe"));
        assert!(!zoe.is_local);
        assert_eq!(zoe.coding_count, 1);
    }
}
