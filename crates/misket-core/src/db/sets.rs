//! Sets and saved filters: the two ways a large project stays navigable.
//!
//! A *set* is a named group of codes or of documents ("Round 1 interviews",
//! "Barriers"). Membership is untyped in SQL — `set_members.member_id` points
//! at `codes.id` or `documents.id` depending on the set's kind — so a pair of
//! `AFTER DELETE` triggers takes the place of the foreign key and clears
//! members whose code or document is gone.
//!
//! A *saved filter* is a whole [`ExcerptFilter`] stored as JSON under a name,
//! so the excerpt browser can restore a question the researcher asks often.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::json;

use super::history::SetOp;
use super::{activity, codes, documents, history, util};
use crate::error::{AppError, Result};
use crate::models::{ExcerptFilter, SavedFilter, SetInfo, SetWithMembers};

pub const KINDS: [&str; 2] = ["code", "document"];

const COLUMNS: &str = "s.id, s.kind, s.name, s.sort_order,
     (SELECT count(*) FROM set_members m WHERE m.set_id = s.id) AS member_count,
     s.created_at, s.updated_at";

fn from_row(r: &Row) -> rusqlite::Result<SetInfo> {
    Ok(SetInfo {
        id: r.get(0)?,
        kind: r.get(1)?,
        name: r.get(2)?,
        sort_order: r.get(3)?,
        member_count: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

fn validate_kind(kind: &str) -> Result<&str> {
    if KINDS.contains(&kind) {
        Ok(kind)
    } else {
        Err(AppError::Validation(format!(
            "unknown set kind {kind:?}; use one of {}",
            KINDS.join(", ")
        )))
    }
}

fn validate_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("set name is required".into()));
    }
    Ok(name)
}

fn map_unique(e: rusqlite::Error, kind: &str, name: &str) -> AppError {
    if e.to_string().contains("UNIQUE") {
        AppError::Conflict(format!("a {kind} set named {name:?} already exists"))
    } else {
        AppError::from(e)
    }
}

/// Members have no foreign key, so existence is checked here instead.
fn ensure_member_exists(conn: &Connection, kind: &str, member_id: &str) -> Result<()> {
    if kind == "code" {
        codes::get(conn, member_id)?;
    } else {
        documents::get_summary(conn, member_id)?;
    }
    Ok(())
}

// ------------------------------------------------------------------- sets

pub fn list_sets(conn: &Connection, kind: &str) -> Result<Vec<SetInfo>> {
    validate_kind(kind)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM sets s WHERE s.kind = ?1 ORDER BY s.sort_order, s.created_at"
    ))?;
    let rows = stmt
        .query_map([kind], from_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn get_set(conn: &Connection, id: &str) -> Result<SetInfo> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM sets s WHERE s.id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("set {id} not found")))
}

/// Create a set, optionally with members and with a caller-chosen `id` so undo
/// can put a deleted set back exactly as it was.
pub fn create_set(
    conn: &Connection,
    kind: &str,
    name: &str,
    member_ids: &[String],
    id: Option<&str>,
) -> Result<SetInfo> {
    let kind = validate_kind(kind)?;
    let name = validate_name(name)?;
    for m in member_ids {
        ensure_member_exists(conn, kind, m)?;
    }
    let id = id.map(str::to_string).unwrap_or_else(util::new_id);
    let now = util::now();
    let tx = util::tx(conn)?;
    let sort_order: i64 = tx.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sets WHERE kind = ?1",
        [kind],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT INTO sets (id, kind, name, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, kind, name, sort_order, now],
    )
    .map_err(|e| map_unique(e, kind, name))?;
    for m in member_ids {
        tx.execute(
            "INSERT OR IGNORE INTO set_members (set_id, member_id) VALUES (?1, ?2)",
            params![id, m],
        )?;
    }
    let created = SetWithMembers {
        set: get_set(&tx, &id)?,
        member_ids: set_members(&tx, &id)?,
    };
    activity::record(
        &tx,
        "set.created",
        "set",
        Some(&id),
        format!("Created {kind} set \"{name}\""),
        json!({ "kind": kind, "name": name, "memberIds": member_ids }),
        Some(history::payload(&SetOp::Restore {
            set: Box::new(created),
        })),
        Some(history::payload(&SetOp::Drop { set_id: id.clone() })),
    )?;
    tx.commit()?;
    get_set(conn, &id)
}

pub fn rename_set(conn: &Connection, id: &str, name: &str) -> Result<SetInfo> {
    let current = get_set(conn, id)?;
    let name = validate_name(name)?;
    conn.execute(
        "UPDATE sets SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name, util::now()],
    )
    .map_err(|e| map_unique(e, &current.kind, name))?;
    if current.name != name {
        activity::record(
            conn,
            "set.renamed",
            "set",
            Some(id),
            format!(
                "Renamed {} set \"{}\" to \"{name}\"",
                current.kind, current.name
            ),
            json!({
                "kind": current.kind,
                "name": activity::change(current.name.clone(), name.to_string()),
            }),
            Some(history::payload(&SetOp::Rename {
                set_id: id.to_string(),
                name: name.to_string(),
                updated_at: get_set(conn, id)?.updated_at,
            })),
            Some(history::payload(&SetOp::Rename {
                set_id: id.to_string(),
                name: current.name.clone(),
                updated_at: current.updated_at.clone(),
            })),
        )?;
    }
    get_set(conn, id)
}

/// Delete a set and return it with its members, so undo can recreate it with
/// the same id. Members themselves (codes, documents) are untouched.
pub fn delete_set(conn: &Connection, id: &str) -> Result<SetWithMembers> {
    let set = get_set(conn, id)?;
    let member_ids = set_members(conn, id)?;
    let tx = util::tx(conn)?;
    tx.execute("DELETE FROM sets WHERE id = ?1", [id])?;
    activity::record(
        &tx,
        "set.deleted",
        "set",
        Some(id),
        format!("Deleted {} set \"{}\"", set.kind, set.name),
        json!({ "kind": set.kind, "name": set.name, "memberIds": member_ids }),
        Some(history::payload(&SetOp::Drop {
            set_id: id.to_string(),
        })),
        Some(history::payload(&SetOp::Restore {
            set: Box::new(SetWithMembers {
                set: set.clone(),
                member_ids: member_ids.clone(),
            }),
        })),
    )?;
    tx.commit()?;
    Ok(SetWithMembers { set, member_ids })
}

// ---------------------------------------------------------------- members

/// The members of one set, in the order they are shown in the sidebar
/// (codebook order for codes, project order for documents).
pub fn set_members(conn: &Connection, set_id: &str) -> Result<Vec<String>> {
    let set = get_set(conn, set_id)?;
    let sql = if set.kind == "code" {
        "SELECT m.member_id FROM set_members m JOIN codes c ON c.id = m.member_id
         WHERE m.set_id = ?1 ORDER BY c.sort_order, c.name"
    } else {
        "SELECT m.member_id FROM set_members m JOIN documents d ON d.id = m.member_id
         WHERE m.set_id = ?1 ORDER BY d.sort_order, d.created_at"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map([set_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Replace a set's membership wholesale.
pub fn set_set_members(
    conn: &Connection,
    set_id: &str,
    member_ids: &[String],
) -> Result<Vec<String>> {
    let set = get_set(conn, set_id)?;
    for m in member_ids {
        ensure_member_exists(conn, &set.kind, m)?;
    }
    let before = set_members(conn, set_id)?;
    let tx = util::tx(conn)?;
    tx.execute("DELETE FROM set_members WHERE set_id = ?1", [set_id])?;
    for m in member_ids {
        tx.execute(
            "INSERT OR IGNORE INTO set_members (set_id, member_id) VALUES (?1, ?2)",
            params![set_id, m],
        )?;
    }
    tx.execute(
        "UPDATE sets SET updated_at = ?2 WHERE id = ?1",
        params![set_id, util::now()],
    )?;
    let (forward, inverse) = membership_steps(&tx, &set, &before)?;
    activity::record(
        &tx,
        "set.members_changed",
        "set",
        Some(set_id),
        format!(
            "Set \"{}\" now has {} member{}",
            set.name,
            member_ids.len(),
            if member_ids.len() == 1 { "" } else { "s" }
        ),
        json!({ "kind": set.kind, "name": set.name, "memberIds": member_ids }),
        Some(forward),
        Some(inverse),
    )?;
    tx.commit()?;
    set_members(conn, set_id)
}

pub fn add_to_set(conn: &Connection, set_id: &str, member_id: &str) -> Result<Vec<String>> {
    let set = get_set(conn, set_id)?;
    ensure_member_exists(conn, &set.kind, member_id)?;
    let before = set_members(conn, set_id)?;
    let tx = util::tx(conn)?;
    tx.execute(
        "INSERT OR IGNORE INTO set_members (set_id, member_id) VALUES (?1, ?2)",
        params![set_id, member_id],
    )?;
    tx.execute(
        "UPDATE sets SET updated_at = ?2 WHERE id = ?1",
        params![set_id, util::now()],
    )?;
    log_membership(&tx, &set, "Added", member_id, &before)?;
    tx.commit()?;
    set_members(conn, set_id)
}

/// The pair of payloads for a membership change: the whole list either way,
/// so adding one member, removing one and replacing the lot all replay the
/// same way.
fn membership_steps(
    conn: &Connection,
    set: &SetInfo,
    before: &[String],
) -> Result<(serde_json::Value, serde_json::Value)> {
    let after = set_members(conn, &set.id)?;
    let now = get_set(conn, &set.id)?.updated_at;
    Ok((
        history::payload(&SetOp::Members {
            set_id: set.id.clone(),
            member_ids: after,
            updated_at: now,
        }),
        history::payload(&SetOp::Members {
            set_id: set.id.clone(),
            member_ids: before.to_vec(),
            updated_at: set.updated_at.clone(),
        }),
    ))
}

/// One entry for a single member joining or leaving a set.
fn log_membership(
    conn: &Connection,
    set: &SetInfo,
    verb: &str,
    member_id: &str,
    before: &[String],
) -> Result<()> {
    let member_name = if set.kind == "code" {
        activity::code_name(conn, member_id)
    } else {
        activity::document_name(conn, member_id)
    };
    let preposition = if verb == "Added" { "to" } else { "from" };
    let (forward, inverse) = membership_steps(conn, set, before)?;
    activity::record(
        conn,
        "set.members_changed",
        "set",
        Some(&set.id),
        format!(
            "{verb} \"{member_name}\" {preposition} {} set \"{}\"",
            set.kind, set.name
        ),
        json!({
            "kind": set.kind,
            "name": set.name,
            "memberId": member_id,
            "memberName": member_name,
            "change": verb.to_lowercase(),
        }),
        Some(forward),
        Some(inverse),
    )
}

pub fn remove_from_set(conn: &Connection, set_id: &str, member_id: &str) -> Result<Vec<String>> {
    let set = get_set(conn, set_id)?;
    let before = set_members(conn, set_id)?;
    let tx = util::tx(conn)?;
    tx.execute(
        "DELETE FROM set_members WHERE set_id = ?1 AND member_id = ?2",
        params![set_id, member_id],
    )?;
    tx.execute(
        "UPDATE sets SET updated_at = ?2 WHERE id = ?1",
        params![set_id, util::now()],
    )?;
    log_membership(&tx, &set, "Removed", member_id, &before)?;
    tx.commit()?;
    set_members(conn, set_id)
}

/// `picked` followed by the ids `set_ids` expand to, de-duplicated and
/// keeping the order each id is first seen. Shared by anything that lets a
/// set stand in for its members: the excerpt browser's filters
/// (`excerpts::query`) and the analysis views (`analysis::code_frequencies`,
/// `analysis::co_occurrence`).
pub fn union_with_sets(
    conn: &Connection,
    picked: Option<&[String]>,
    set_ids: &[String],
) -> Result<Vec<String>> {
    let mut out: Vec<String> = picked.unwrap_or_default().to_vec();
    for id in union_members(conn, set_ids)? {
        if !out.contains(&id) {
            out.push(id);
        }
    }
    Ok(out)
}

/// The union of several sets' members, de-duplicated and keeping the order
/// they are first seen. Unknown set ids contribute nothing rather than
/// failing, so a filter that mentions a set someone deleted still runs.
pub fn union_members(conn: &Connection, set_ids: &[String]) -> Result<Vec<String>> {
    let mut out: Vec<String> = vec![];
    if set_ids.is_empty() {
        return Ok(out);
    }
    let placeholders = set_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT member_id FROM set_members WHERE set_id IN ({placeholders})"
    ))?;
    let rows = stmt.query_map(rusqlite::params_from_iter(set_ids.iter()), |r| {
        r.get::<_, String>(0)
    })?;
    for id in rows {
        let id = id?;
        if !out.contains(&id) {
            out.push(id);
        }
    }
    Ok(out)
}

// ----------------------------------------------------------- saved filters

const FILTER_COLUMNS: &str = "id, name, filter_json, sort_order, created_at, updated_at";

fn filter_from_row(r: &Row) -> rusqlite::Result<SavedFilter> {
    let json: String = r.get(2)?;
    Ok(SavedFilter {
        id: r.get(0)?,
        name: r.get(1)?,
        // A filter written by a newer build (or hand-edited) falls back to the
        // default rather than making the whole list unreadable.
        filter: serde_json::from_str(&json).unwrap_or_default(),
        sort_order: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

pub fn list_saved_filters(conn: &Connection) -> Result<Vec<SavedFilter>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {FILTER_COLUMNS} FROM saved_filters ORDER BY sort_order, created_at"
    ))?;
    let rows = stmt
        .query_map([], filter_from_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn get_saved_filter(conn: &Connection, id: &str) -> Result<SavedFilter> {
    conn.query_row(
        &format!("SELECT {FILTER_COLUMNS} FROM saved_filters WHERE id = ?1"),
        [id],
        filter_from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("saved filter {id} not found")))
}

/// Store `filter` under `name`, replacing whatever was saved under that name
/// (case-insensitively) so "save again" overwrites instead of piling up.
pub fn save_filter(conn: &Connection, name: &str, filter: &ExcerptFilter) -> Result<SavedFilter> {
    let name = validate_name(name)?;
    let json = serde_json::to_string(filter)?;
    let now = util::now();
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM saved_filters WHERE name = ?1 COLLATE NOCASE",
            [name],
            |r| r.get(0),
        )
        .optional()?;
    // What was stored under that name, so undo can put it back verbatim —
    // or take the new entry away again when the name was unused.
    let before = existing
        .as_deref()
        .map(|id| get_saved_filter(conn, id))
        .transpose()?;
    let id = match existing {
        Some(id) => {
            conn.execute(
                "UPDATE saved_filters SET name = ?2, filter_json = ?3, updated_at = ?4
                 WHERE id = ?1",
                params![id, name, json, now],
            )?;
            id
        }
        None => {
            let id = util::new_id();
            let sort_order: i64 = conn.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM saved_filters",
                [],
                |r| r.get(0),
            )?;
            conn.execute(
                "INSERT INTO saved_filters (id, name, filter_json, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![id, name, json, sort_order, now],
            )?;
            id
        }
    };
    activity::record(
        conn,
        "filter.saved",
        "saved_filter",
        Some(&id),
        format!("Saved filter \"{name}\""),
        json!({ "name": name, "filter": filter }),
        Some(history::payload(&SetOp::RestoreFilter {
            filter: Box::new(get_saved_filter(conn, &id)?),
        })),
        Some(match before {
            Some(f) => history::payload(&SetOp::RestoreFilter {
                filter: Box::new(f),
            }),
            None => history::payload(&SetOp::DropFilter {
                filter_id: id.clone(),
            }),
        }),
    )?;
    get_saved_filter(conn, &id)
}

pub fn delete_saved_filter(conn: &Connection, id: &str) -> Result<SavedFilter> {
    let saved = get_saved_filter(conn, id)?;
    let tx = util::tx(conn)?;
    tx.execute("DELETE FROM saved_filters WHERE id = ?1", [id])?;
    activity::record(
        &tx,
        "filter.deleted",
        "saved_filter",
        Some(id),
        format!("Deleted filter \"{}\"", saved.name),
        json!({ "name": saved.name, "filter": saved.filter }),
        Some(history::payload(&SetOp::DropFilter {
            filter_id: id.to_string(),
        })),
        Some(history::payload(&SetOp::RestoreFilter {
            filter: Box::new(saved.clone()),
        })),
    )?;
    tx.commit()?;
    Ok(saved)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::codes::tests::mk as mk_code;
    use crate::db::documents::tests::new_doc;
    use crate::db::OpenProject;

    fn setup() -> (OpenProject, String, String, String) {
        let p = OpenProject::in_memory("t").unwrap();
        let a = mk_code(&p.conn, "A", None).id;
        let b = mk_code(&p.conn, "B", None).id;
        let mut d = new_doc("hello world");
        d.name = "Doc A".into();
        let doc = documents::create(&p.conn, d).unwrap().summary.id;
        (p, a, b, doc)
    }

    #[test]
    fn crud_and_unique_names_per_kind() {
        let (p, a, b, doc) = setup();
        let s = create_set(
            &p.conn,
            "code",
            "  Barriers  ",
            std::slice::from_ref(&a),
            None,
        )
        .unwrap();
        assert_eq!(s.name, "Barriers");
        assert_eq!(s.kind, "code");
        assert_eq!(s.member_count, 1);
        assert_eq!(s.sort_order, 0);

        // The same name is free for the other kind, taken for this one.
        let d = create_set(
            &p.conn,
            "document",
            "barriers",
            std::slice::from_ref(&doc),
            None,
        )
        .unwrap();
        assert_eq!(d.sort_order, 0);
        assert!(matches!(
            create_set(&p.conn, "code", "BARRIERS", &[], None),
            Err(AppError::Conflict(_))
        ));
        assert!(matches!(
            create_set(&p.conn, "code", "  ", &[], None),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            create_set(&p.conn, "cohort", "x", &[], None),
            Err(AppError::Validation(_))
        ));
        // A member that is not a code of this kind is rejected.
        assert!(matches!(
            create_set(&p.conn, "code", "Other", std::slice::from_ref(&doc), None),
            Err(AppError::NotFound(_))
        ));

        let second = create_set(&p.conn, "code", "Enablers", &[], None).unwrap();
        assert_eq!(second.sort_order, 1);
        assert_eq!(list_sets(&p.conn, "code").unwrap().len(), 2);
        assert_eq!(list_sets(&p.conn, "document").unwrap().len(), 1);

        let renamed = rename_set(&p.conn, &s.id, "Structural barriers").unwrap();
        assert_eq!(renamed.name, "Structural barriers");
        assert!(matches!(
            rename_set(&p.conn, &s.id, "Enablers"),
            Err(AppError::Conflict(_))
        ));

        assert_eq!(set_members(&p.conn, &s.id).unwrap(), vec![a.clone()]);
        assert_eq!(
            set_set_members(&p.conn, &s.id, &[a.clone(), b.clone()]).unwrap(),
            vec![a.clone(), b.clone()]
        );
        assert_eq!(
            remove_from_set(&p.conn, &s.id, &a).unwrap(),
            vec![b.clone()]
        );
        assert_eq!(
            add_to_set(&p.conn, &s.id, &a).unwrap(),
            vec![a.clone(), b.clone()]
        );
        // Adding twice is a no-op, not a conflict.
        assert_eq!(add_to_set(&p.conn, &s.id, &a).unwrap().len(), 2);

        let removed = delete_set(&p.conn, &s.id).unwrap();
        assert_eq!(removed.member_ids, vec![a.clone(), b.clone()]);
        assert!(matches!(
            get_set(&p.conn, &s.id),
            Err(AppError::NotFound(_))
        ));
        // Deleting a set leaves its codes alone, and undo puts it back whole.
        assert!(codes::get(&p.conn, &a).is_ok());
        let back = create_set(
            &p.conn,
            &removed.set.kind,
            &removed.set.name,
            &removed.member_ids,
            Some(&removed.set.id),
        )
        .unwrap();
        assert_eq!(back.id, s.id);
        assert_eq!(back.member_count, 2);
    }

    #[test]
    fn members_disappear_with_their_code_or_document() {
        let (p, a, b, doc) = setup();
        let cs = create_set(&p.conn, "code", "Both", &[a.clone(), b.clone()], None).unwrap();
        let ds = create_set(&p.conn, "document", "All", std::slice::from_ref(&doc), None).unwrap();

        codes::delete(&p.conn, &a, crate::models::ChildrenStrategy::Delete).unwrap();
        assert_eq!(set_members(&p.conn, &cs.id).unwrap(), vec![b.clone()]);
        assert_eq!(get_set(&p.conn, &cs.id).unwrap().member_count, 1);

        documents::delete(&p.conn, &doc).unwrap();
        assert!(set_members(&p.conn, &ds.id).unwrap().is_empty());

        // A set whose members are all gone is still a set.
        assert_eq!(list_sets(&p.conn, "document").unwrap().len(), 1);
    }

    #[test]
    fn deleting_a_set_takes_its_members_with_it() {
        let (p, a, _b, _doc) = setup();
        let s = create_set(&p.conn, "code", "One", std::slice::from_ref(&a), None).unwrap();
        delete_set(&p.conn, &s.id).unwrap();
        let left: i64 = p
            .conn
            .query_row("SELECT count(*) FROM set_members", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn union_members_dedupes_and_ignores_unknown_sets() {
        let (p, a, b, _doc) = setup();
        let one = create_set(&p.conn, "code", "One", &[a.clone(), b.clone()], None).unwrap();
        let two = create_set(&p.conn, "code", "Two", std::slice::from_ref(&b), None).unwrap();
        let mut u = union_members(&p.conn, &[one.id, two.id, "nope".into()]).unwrap();
        u.sort();
        let mut want = vec![a, b];
        want.sort();
        assert_eq!(u, want);
        assert!(union_members(&p.conn, &[]).unwrap().is_empty());
    }

    #[test]
    fn saved_filters_round_trip_and_upsert_by_name() {
        let p = OpenProject::in_memory("t").unwrap();
        let filter = ExcerptFilter {
            code_ids: Some(vec!["c1".into()]),
            code_set_ids: Some(vec!["s1".into()]),
            require_all_codes: true,
            include_descendants: false,
            document_set_ids: Some(vec!["s2".into()]),
            limit: 50,
            ..Default::default()
        };
        let saved = save_filter(&p.conn, "  Barriers in wave 2 ", &filter).unwrap();
        assert_eq!(saved.name, "Barriers in wave 2");
        assert_eq!(saved.filter, filter);
        assert_eq!(saved.sort_order, 0);
        assert_eq!(get_saved_filter(&p.conn, &saved.id).unwrap().filter, filter);

        // Saving under the same name (any case) replaces it in place.
        let changed = ExcerptFilter {
            uncoded_only: true,
            ..Default::default()
        };
        let again = save_filter(&p.conn, "BARRIERS IN WAVE 2", &changed).unwrap();
        assert_eq!(again.id, saved.id);
        assert_eq!(again.filter, changed);
        assert_eq!(list_saved_filters(&p.conn).unwrap().len(), 1);

        let other = save_filter(&p.conn, "Uncoded", &changed).unwrap();
        assert_eq!(other.sort_order, 1);
        assert_eq!(list_saved_filters(&p.conn).unwrap().len(), 2);

        assert!(matches!(
            save_filter(&p.conn, " ", &changed),
            Err(AppError::Validation(_))
        ));
        assert_eq!(
            delete_saved_filter(&p.conn, &other.id).unwrap().id,
            other.id
        );
        assert_eq!(list_saved_filters(&p.conn).unwrap().len(), 1);
        assert!(matches!(
            delete_saved_filter(&p.conn, &other.id),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn unreadable_filter_json_falls_back_to_the_default() {
        let p = OpenProject::in_memory("t").unwrap();
        let saved = save_filter(&p.conn, "x", &ExcerptFilter::default()).unwrap();
        p.conn
            .execute(
                "UPDATE saved_filters SET filter_json = 'not json' WHERE id = ?1",
                [&saved.id],
            )
            .unwrap();
        assert_eq!(
            get_saved_filter(&p.conn, &saved.id).unwrap().filter,
            ExcerptFilter::default()
        );
    }
}
