//! The activity log: a readable view of the history tree.
//!
//! Every domain function that writes calls [`record`] inside its own
//! transaction, so an entry can never outlive — or be lost by — the change it
//! describes. Since schema 8 the entries *are* the nodes of the undo tree
//! (`db::history`): this module is the thin facade the activity feed and the
//! inspectors read them through, and the place a domain function hands over
//! the forward and inverse payloads that make its write undoable.
//!
//! Misket has no user accounts, so the actor is a plain string: the name set
//! in the app's settings, or failing that the OS user name. The Tauri layer
//! puts it on the connection once, at open, with [`set_actor`]; because that
//! is a `TEMP` table it is per-connection and never written to the file.

use rusqlite::{params, Connection, Row};
use serde_json::{json, Value};

use super::history;
use crate::error::Result;
use crate::models::{ActivityEntry, ActivityFilter, ActivityPage};

/// Remember who is at the keyboard for the rest of this connection's life.
///
/// The name is stored in a `TEMP` table, which SQLite keeps per connection
/// and outside the database file, so two people opening the same project
/// never see each other's setting and the `.misket` stays unchanged.
pub fn set_actor(conn: &Connection, name: &str) -> Result<()> {
    conn.execute_batch("CREATE TEMP TABLE IF NOT EXISTS activity_actor (name TEXT NOT NULL)")?;
    conn.execute("DELETE FROM temp.activity_actor", [])?;
    conn.execute(
        "INSERT INTO temp.activity_actor (name) VALUES (?1)",
        [name.trim()],
    )?;
    Ok(())
}

/// The name [`set_actor`] stored on this connection, or `""` if none was set
/// (tests, and any code path that opens a project without the desktop app).
pub fn actor(conn: &Connection) -> String {
    conn.query_row("SELECT name FROM temp.activity_actor LIMIT 1", [], |r| {
        r.get::<_, String>(0)
    })
    .unwrap_or_default()
}

/// Who (or rather, what) helped with the writes that follow on this
/// connection.
///
/// The actor never changes: a suggestion only ever becomes a change because a
/// person clicked it, so the history still credits the person. This is the
/// extra note that says the person had help, and which provider and model
/// gave it — the audit trail researchers ask for before they will let an
/// assistant near their coding (`docs/research/user-criticisms.md`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssistedBy {
    pub provider: String,
    pub model: String,
}

/// Mark every write on this connection as human-accepted assistance until it
/// is cleared with `None`.
///
/// Per-connection `TEMP` state, exactly like [`set_actor`]: it never reaches
/// the project file, and two people with the same project open cannot see
/// each other's. The Tauri layer sets it around one command and clears it
/// again, so the window is a single call.
pub fn set_assisted(conn: &Connection, by: Option<&AssistedBy>) -> Result<()> {
    conn.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS activity_assist (provider TEXT NOT NULL, model TEXT NOT NULL)",
    )?;
    conn.execute("DELETE FROM temp.activity_assist", [])?;
    if let Some(by) = by {
        conn.execute(
            "INSERT INTO temp.activity_assist (provider, model) VALUES (?1, ?2)",
            [by.provider.trim(), by.model.trim()],
        )?;
    }
    Ok(())
}

/// The mark [`set_assisted`] left on this connection, if any.
pub fn assisted(conn: &Connection) -> Option<AssistedBy> {
    conn.query_row(
        "SELECT provider, model FROM temp.activity_assist LIMIT 1",
        [],
        |r| {
            Ok(AssistedBy {
                provider: r.get(0)?,
                model: r.get(1)?,
            })
        },
    )
    .ok()
}

/// Fold the connection's assistance mark, if it has one, into a `detail`
/// payload. A payload that is not an object is left alone.
fn with_assisted(conn: &Connection, detail: Value) -> Value {
    let Some(by) = assisted(conn) else {
        return detail;
    };
    let mut detail = detail;
    if let Some(obj) = detail.as_object_mut() {
        obj.insert("assisted".into(), Value::Bool(true));
        obj.insert(
            "assistedBy".into(),
            json!({ "provider": by.provider, "model": by.model }),
        );
    }
    detail
}

/// Append one entry under the current head. `detail` is stored verbatim as
/// `detail_json`; `forward` and `inverse` are the replay payloads.
#[allow(clippy::too_many_arguments)]
pub fn log(
    conn: &Connection,
    actor: &str,
    kind: &str,
    target_kind: &str,
    target_id: Option<&str>,
    summary: &str,
    detail: &Value,
    forward: Option<Value>,
    inverse: Option<Value>,
) -> Result<i64> {
    history::record(
        conn,
        actor,
        kind,
        target_kind,
        target_id,
        summary,
        detail,
        forward,
        inverse,
    )
}

/// [`log`], with the actor taken from the connection. This is what the domain
/// functions call: one line, no extra parameter to thread through.
///
/// A write that passes `None` for both payloads is recorded but not undoable.
/// New domain writes are expected to supply both.
#[allow(clippy::too_many_arguments)]
pub fn record(
    conn: &Connection,
    kind: &str,
    target_kind: &str,
    target_id: Option<&str>,
    summary: impl AsRef<str>,
    detail: Value,
    forward: Option<Value>,
    inverse: Option<Value>,
) -> Result<()> {
    log(
        conn,
        &actor(conn),
        kind,
        target_kind,
        target_id,
        summary.as_ref(),
        &with_assisted(conn, detail),
        forward,
        inverse,
    )?;
    Ok(())
}

/// A `{"from": …, "to": …}` object for a field that changed, for use inside a
/// `detail` payload.
pub fn change(from: impl Into<Value>, to: impl Into<Value>) -> Value {
    json!({ "from": from.into(), "to": to.into() })
}

/// A code's name for a summary, falling back to its id if it is already gone.
pub fn code_name(conn: &Connection, id: &str) -> String {
    conn.query_row("SELECT name FROM codes WHERE id = ?1", [id], |r| {
        r.get::<_, String>(0)
    })
    .unwrap_or_else(|_| id.to_string())
}

/// A document's name, same fallback.
pub fn document_name(conn: &Connection, id: &str) -> String {
    conn.query_row("SELECT name FROM documents WHERE id = ?1", [id], |r| {
        r.get::<_, String>(0)
    })
    .unwrap_or_else(|_| id.to_string())
}

/// The first `max` characters of `s` (code points), with an ellipsis when it
/// had to be cut. Summaries quote excerpt text, which can be a page long.
pub fn elide(s: &str, max: usize) -> String {
    let mut out: String = s.chars().take(max).collect();
    if s.chars().nth(max).is_some() {
        out.push('…');
    }
    out.replace('\n', " ")
}

const COLUMNS: &str = "id, parent_id, at, actor, kind, target_kind, target_id, summary,
     detail_json, inverse_json IS NOT NULL, branch_name";

fn from_row(head: Option<i64>) -> impl Fn(&Row) -> rusqlite::Result<ActivityEntry> {
    move |r| {
        let detail_json: String = r.get(8)?;
        let id: i64 = r.get(0)?;
        Ok(ActivityEntry {
            id,
            parent_id: r.get(1)?,
            at: r.get(2)?,
            actor: r.get(3)?,
            kind: r.get(4)?,
            target_kind: r.get(5)?,
            target_id: r.get(6)?,
            summary: r.get(7)?,
            // A payload written by a newer build (or hand-edited) reads back
            // as an empty object rather than making the whole list unreadable.
            detail: serde_json::from_str(&detail_json).unwrap_or_else(|_| json!({})),
            undoable: r.get(9)?,
            branch_name: r.get(10)?,
            is_head: head == Some(id),
        })
    }
}

/// Newest first, paged. `total` ignores `limit`/`offset`; `kinds` lists every
/// kind in the whole log so the UI can build its filter from one call.
///
/// Ordering is by `id`, not by `at`: nodes are appended, so the rowid is the
/// write order, while `at` is a string whose fractional seconds are trimmed
/// (`…:00Z` sorts after `…:00.5Z`) and would put two entries from the same
/// second in the wrong order.
pub fn list(conn: &Connection, filter: &ActivityFilter) -> Result<ActivityPage> {
    let head = history::head(conn)?;
    let mut where_sql = String::from(" WHERE 1 = 1");
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    if let Some(tk) = &filter.target_kind {
        where_sql.push_str(" AND target_kind = ?");
        args.push(Box::new(tk.clone()));
    }
    if let Some(tid) = &filter.target_id {
        where_sql.push_str(" AND target_id = ?");
        args.push(Box::new(tid.clone()));
    }
    if let Some(kinds) = filter.kinds.as_ref().filter(|k| !k.is_empty()) {
        let placeholders = kinds.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        where_sql.push_str(&format!(" AND kind IN ({placeholders})"));
        for k in kinds {
            args.push(Box::new(k.clone()));
        }
    }
    if let Some(since) = &filter.since {
        where_sql.push_str(" AND at >= ?");
        args.push(Box::new(since.clone()));
    }

    let total: i64 = conn.query_row(
        &format!("SELECT count(*) FROM history{where_sql}"),
        rusqlite::params_from_iter(args.iter()),
        |r| r.get(0),
    )?;

    let limit = filter.limit.clamp(0, 10_000);
    let offset = filter.offset.max(0);
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM history{where_sql}
         ORDER BY id DESC LIMIT {limit} OFFSET {offset}"
    ))?;
    let entries: Vec<ActivityEntry> = stmt
        .query_map(rusqlite::params_from_iter(args.iter()), from_row(head))?
        .collect::<rusqlite::Result<_>>()?;

    let mut stmt = conn.prepare("SELECT DISTINCT kind FROM history ORDER BY kind")?;
    let kinds: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;

    Ok(ActivityPage {
        entries,
        total,
        kinds,
    })
}

/// The whole log, oldest first and unpaged — what the exports write.
pub fn all(conn: &Connection) -> Result<Vec<ActivityEntry>> {
    let head = history::head(conn)?;
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM history ORDER BY id"))?;
    let rows = stmt.query_map([], from_row(head))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Everything that happened to one target, oldest first — a timeline. Ordered
/// by `id` for the same reason as [`list`].
fn history_of(conn: &Connection, target_kind: &str, target_id: &str) -> Result<Vec<ActivityEntry>> {
    let head = history::head(conn)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM history
          WHERE target_kind = ?1 AND target_id = ?2
          ORDER BY id"
    ))?;
    let rows = stmt.query_map(params![target_kind, target_id], from_row(head))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// A code's life: created, renamed, re-described, moved, merged into or from
/// another code, given or denied a shortcut, deleted. Survives the code's
/// deletion, because the log keeps the id rather than a foreign key.
pub fn code_history(conn: &Connection, code_id: &str) -> Result<Vec<ActivityEntry>> {
    history_of(conn, "code", code_id)
}

/// The same for one excerpt: coded, recoded, adjusted, split, merged,
/// deleted, restored.
pub fn excerpt_history(conn: &Connection, excerpt_id: &str) -> Result<Vec<ActivityEntry>> {
    history_of(conn, "excerpt", excerpt_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::OpenProject;

    #[test]
    fn actor_defaults_to_empty_and_is_per_connection() {
        let p = OpenProject::in_memory("t").unwrap();
        assert_eq!(actor(&p.conn), "");
        set_actor(&p.conn, "  Ada  ").unwrap();
        assert_eq!(actor(&p.conn), "Ada");
        set_actor(&p.conn, "Grace").unwrap();
        assert_eq!(actor(&p.conn), "Grace");
        // A temp table is not part of the file.
        let n: i64 = p
            .conn
            .query_row(
                "SELECT count(*) FROM main.sqlite_master WHERE name = 'activity_actor'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn record_uses_the_connection_actor_and_list_filters() {
        let p = OpenProject::in_memory("t").unwrap();
        set_actor(&p.conn, "Ada").unwrap();
        record(
            &p.conn,
            "code.created",
            "code",
            Some("c1"),
            "Created code \"A\"",
            json!({ "name": "A" }),
            None,
            None,
        )
        .unwrap();
        record(
            &p.conn,
            "excerpt.created",
            "excerpt",
            Some("e1"),
            "Coded an excerpt",
            json!({}),
            None,
            None,
        )
        .unwrap();

        let all = list(&p.conn, &ActivityFilter::default()).unwrap();
        assert_eq!(all.total, 2);
        assert_eq!(all.entries.len(), 2);
        // Newest first.
        assert_eq!(all.entries[0].kind, "excerpt.created");
        assert!(all.entries.iter().all(|e| e.actor == "Ada"));
        assert_eq!(all.kinds, vec!["code.created", "excerpt.created"]);
        assert_eq!(all.entries[1].detail["name"], json!("A"));

        let only_codes = list(
            &p.conn,
            &ActivityFilter {
                target_kind: Some("code".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(only_codes.total, 1);
        assert_eq!(only_codes.entries[0].target_id.as_deref(), Some("c1"));

        let by_kind = list(
            &p.conn,
            &ActivityFilter {
                kinds: Some(vec!["excerpt.created".into()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_kind.total, 1);

        let paged = list(
            &p.conn,
            &ActivityFilter {
                limit: 1,
                offset: 1,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!((paged.total, paged.entries.len()), (2, 1));
        assert_eq!(paged.entries[0].kind, "code.created");

        let future = list(
            &p.conn,
            &ActivityFilter {
                since: Some("9999-01-01T00:00:00Z".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(future.total, 0);
    }

    #[test]
    fn unparseable_detail_reads_back_as_an_empty_object() {
        let p = OpenProject::in_memory("t").unwrap();
        p.conn
            .execute(
                "INSERT INTO history (at, actor, kind, target_kind, target_id, summary, detail_json)
                 VALUES ('2024-01-01T00:00:00Z', '', 'k', 'project', NULL, 's', 'not json')",
                [],
            )
            .unwrap();
        let page = list(&p.conn, &ActivityFilter::default()).unwrap();
        assert_eq!(page.entries[0].detail, json!({}));
    }

    // --------------------------------------------------- instrumentation

    use crate::db::{backup, bulk, codes, descriptors, documents, excerpts, memos, sets};
    use crate::models::{
        ApplyCodesInput, ChildrenStrategy, CodePatch, DescriptorFieldPatch, ExcerptFilter,
        MemoTarget,
    };

    fn entries(conn: &Connection) -> i64 {
        conn.query_row("SELECT count(*) FROM history", [], |r| r.get(0))
            .unwrap()
    }

    /// Run `f` and assert it appended exactly `expected` entries.
    fn writes<T>(conn: &Connection, expected: i64, f: impl FnOnce() -> T) -> T {
        let before = entries(conn);
        let out = f();
        assert_eq!(
            entries(conn) - before,
            expected,
            "wrong number of activity entries"
        );
        out
    }

    #[test]
    fn every_instrumented_write_leaves_an_entry() {
        let p = OpenProject::in_memory("t").unwrap();
        set_actor(&p.conn, "Ada").unwrap();
        let c = &p.conn;

        let doc = writes(c, 1, || {
            documents::create(c, documents::tests::new_doc("One two three four five.")).unwrap()
        });
        let doc_id = doc.summary.id.clone();
        writes(c, 1, || {
            documents::rename(c, &doc_id, "Interview 2").unwrap()
        });

        let a = writes(c, 1, || codes::tests::mk(c, "Alpha", None));
        let b = writes(c, 1, || codes::tests::mk(c, "Beta", None));
        writes(c, 1, || {
            codes::update(
                c,
                &a.id,
                CodePatch {
                    name: Some("Alpha renamed".into()),
                    ..Default::default()
                },
            )
            .unwrap()
        });
        // An update that changes nothing is not worth an entry.
        writes(c, 0, || {
            codes::update(c, &a.id, CodePatch::default()).unwrap()
        });
        writes(c, 1, || move_under(c, &a.id, &b.id));

        let applied = writes(c, 1, || {
            excerpts::apply_codes(
                c,
                ApplyCodesInput {
                    document_id: doc_id.clone(),
                    start_pos: Some(0),
                    end_pos: Some(12),
                    code_ids: vec![a.id.clone()],
                    ..Default::default()
                },
            )
            .unwrap()
        });
        let e = applied.excerpt.id.clone();
        writes(c, 1, || {
            excerpts::add_codes(c, &e, std::slice::from_ref(&b.id)).unwrap()
        });
        writes(c, 1, || excerpts::remove_code(c, &e, &b.id, None).unwrap());
        writes(c, 1, || excerpts::update_range(c, &e, 0, 14).unwrap());
        // A split and a merge each write one entry per excerpt involved, so
        // the half that is created (or removed) has a history of its own.
        let (_, right) = writes(c, 2, || excerpts::split(c, &e, 7).unwrap());
        writes(c, 2, || excerpts::merge_adjacent(c, &e, &right.id).unwrap());
        let snapshot = writes(c, 1, || excerpts::delete(c, &e).unwrap());
        writes(c, 1, || excerpts::restore(c, &snapshot).unwrap());

        writes(c, 1, || {
            bulk::add_codes_many(c, std::slice::from_ref(&e), std::slice::from_ref(&b.id)).unwrap()
        });
        writes(c, 1, || {
            bulk::remove_codes_many(c, std::slice::from_ref(&e), std::slice::from_ref(&b.id))
                .unwrap()
        });
        writes(c, 1, || bulk::retag_code(c, &a.id, &b.id).unwrap());
        writes(c, 1, || {
            bulk::delete_many(c, std::slice::from_ref(&e)).unwrap()
        });

        let memo = writes(c, 1, || {
            memos::create(
                c,
                MemoTarget {
                    code_id: Some(b.id.clone()),
                    ..Default::default()
                },
                "Why",
                "Because",
            )
            .unwrap()
        });
        writes(c, 1, || {
            memos::update(c, &memo.id, "Why", "Because of that").unwrap()
        });
        writes(c, 1, || memos::delete(c, &memo.id).unwrap());
        writes(c, 1, || memos::restore(c, &memo).unwrap());

        let field = writes(c, 1, || {
            descriptors::tests::mk_field(c, "Site", "choice", &["North", "South"])
        });
        writes(c, 1, || {
            descriptors::update_field(
                c,
                &field.id,
                DescriptorFieldPatch {
                    name: Some("Location".into()),
                    ..Default::default()
                },
            )
            .unwrap()
        });
        writes(c, 1, || {
            descriptors::set_value(c, &doc_id, &field.id, Some("North")).unwrap()
        });
        // Setting the same value again changes nothing.
        writes(c, 0, || {
            descriptors::set_value(c, &doc_id, &field.id, Some("North")).unwrap()
        });
        writes(c, 1, || {
            descriptors::set_value(c, &doc_id, &field.id, None).unwrap()
        });
        writes(c, 1, || descriptors::delete_field(c, &field.id).unwrap());

        let set = writes(c, 1, || {
            sets::create_set(c, "code", "Round 1", &[], None).unwrap()
        });
        writes(c, 1, || sets::rename_set(c, &set.id, "Round 2").unwrap());
        writes(c, 1, || sets::add_to_set(c, &set.id, &b.id).unwrap());
        writes(c, 1, || sets::remove_from_set(c, &set.id, &b.id).unwrap());
        writes(c, 1, || {
            sets::set_set_members(c, &set.id, std::slice::from_ref(&b.id)).unwrap()
        });
        writes(c, 1, || sets::delete_set(c, &set.id).unwrap());
        let saved = writes(c, 1, || {
            sets::save_filter(c, "Everything", &ExcerptFilter::default()).unwrap()
        });
        writes(c, 1, || sets::delete_saved_filter(c, &saved.id).unwrap());

        // Merging writes one entry per side; deleting a code and a document,
        // one each.
        let d = writes(c, 1, || codes::tests::mk(c, "Delta", None));
        writes(c, 2, || codes::merge(c, &d.id, &b.id).unwrap());
        writes(c, 1, || {
            codes::delete(c, &b.id, ChildrenStrategy::Promote).unwrap()
        });
        writes(c, 1, || documents::delete(c, &doc_id).unwrap());

        // Everything was attributed to whoever was at the keyboard.
        let page = list(
            c,
            &ActivityFilter {
                limit: 1000,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(page.total > 30);
        assert!(page.entries.iter().all(|entry| entry.actor == "Ada"));
    }

    fn move_under(conn: &Connection, id: &str, parent: &str) -> crate::models::Code {
        codes::move_code(conn, id, Some(parent), 0).unwrap()
    }

    #[test]
    fn code_history_reads_a_rename_move_and_merge_in_order() {
        let p = OpenProject::in_memory("t").unwrap();
        set_actor(&p.conn, "Grace").unwrap();
        let c = &p.conn;
        let parent = codes::tests::mk(c, "Themes", None);
        let code = codes::tests::mk(c, "Trust", None);
        codes::update(
            c,
            &code.id,
            CodePatch {
                name: Some("Trust in staff".into()),
                description: Some("When a participant speaks about trusting staff".into()),
                ..Default::default()
            },
        )
        .unwrap();
        codes::move_code(c, &code.id, Some(&parent.id), 0).unwrap();
        let target = codes::tests::mk(c, "Relationships", None);
        codes::merge(c, &code.id, &target.id).unwrap();

        let history = code_history(c, &code.id).unwrap();
        let kinds: Vec<&str> = history.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(
            kinds,
            vec![
                "code.created",
                "code.updated",
                "code.moved",
                "code.merged_into"
            ]
        );
        assert!(history.iter().all(|e| e.actor == "Grace"));

        let renamed = &history[1];
        assert_eq!(renamed.detail["name"]["from"], json!("Trust"));
        assert_eq!(renamed.detail["name"]["to"], json!("Trust in staff"));
        assert_eq!(renamed.detail["changed"], json!(["name", "description"]));
        assert_eq!(
            renamed.summary,
            "Renamed code \"Trust\" to \"Trust in staff\""
        );

        let moved = &history[2];
        assert_eq!(moved.detail["parentId"]["from"], Value::Null);
        assert_eq!(moved.detail["parentId"]["to"], json!(parent.id));
        assert_eq!(moved.detail["parentName"]["to"], json!("Themes"));

        let merged = &history[3];
        assert_eq!(merged.detail["targetId"], json!(target.id));
        // The surviving code's own history carries the other half.
        let other = code_history(c, &target.id).unwrap();
        assert_eq!(
            other.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(),
            vec!["code.created", "code.merged_from"]
        );
        assert_eq!(other[1].detail["sourceId"], json!(code.id));
    }

    #[test]
    fn excerpt_history_follows_one_excerpt() {
        let p = OpenProject::in_memory("t").unwrap();
        let c = &p.conn;
        let doc = documents::create(c, documents::tests::new_doc("One two three four.")).unwrap();
        let code = codes::tests::mk(c, "Alpha", None);
        let applied = excerpts::apply_codes(
            c,
            ApplyCodesInput {
                document_id: doc.summary.id.clone(),
                start_pos: Some(0),
                end_pos: Some(7),
                code_ids: vec![code.id.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        let id = applied.excerpt.id;
        excerpts::update_range(c, &id, 0, 11).unwrap();
        excerpts::remove_code(c, &id, &code.id, None).unwrap();

        let history = excerpt_history(c, &id).unwrap();
        assert_eq!(
            history.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(),
            vec![
                "excerpt.created",
                "excerpt.range_updated",
                "excerpt.code_removed"
            ]
        );
        assert_eq!(history[1].detail["endPos"]["from"], json!(7));
        assert_eq!(history[1].detail["endPos"]["to"], json!(11));
    }

    #[test]
    fn assistance_is_a_note_on_the_detail_not_a_different_actor() {
        use crate::db::{codes, documents, excerpts};
        use crate::models::{ApplyCodesInput, NewDocument};

        let p = OpenProject::in_memory("t").unwrap();
        set_actor(&p.conn, "Ada").unwrap();
        let doc = documents::create(
            &p.conn,
            NewDocument {
                name: "Doc".into(),
                source_format: "txt".into(),
                text: "one two three".into(),
                source_path: None,
                allow_duplicate: false,
            },
        )
        .unwrap();
        let code = codes::tests::mk(&p.conn, "Alpha", None);

        // Unmarked: no `assisted` key at all, so old payloads and new ones
        // that had no help read the same.
        excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: doc.summary.id.clone(),
                kind: None,
                start_pos: Some(0),
                end_pos: Some(3),
                geometry: None,
                code_ids: vec![code.id.clone()],
            },
        )
        .unwrap();

        set_assisted(
            &p.conn,
            Some(&AssistedBy {
                provider: "anthropic".into(),
                model: "claude-sonnet-5".into(),
            }),
        )
        .unwrap();
        excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: doc.summary.id.clone(),
                kind: None,
                start_pos: Some(4),
                end_pos: Some(7),
                geometry: None,
                code_ids: vec![code.id.clone()],
            },
        )
        .unwrap();
        set_assisted(&p.conn, None).unwrap();

        let page = list(&p.conn, &ActivityFilter::default()).unwrap();
        let entries: Vec<_> = page.entries.iter().rev().collect();
        let plain = entries
            .iter()
            .find(|e| e.detail["startPos"] == json!(0))
            .unwrap();
        let helped = entries
            .iter()
            .find(|e| e.detail["startPos"] == json!(4))
            .unwrap();
        assert!(plain.detail.get("assisted").is_none());
        assert_eq!(helped.detail["assisted"], json!(true));
        assert_eq!(helped.detail["assistedBy"]["provider"], json!("anthropic"));
        assert_eq!(
            helped.detail["assistedBy"]["model"],
            json!("claude-sonnet-5")
        );
        // The human is still the one who did it.
        assert_eq!(helped.actor, "Ada");
        assert_eq!(plain.actor, "Ada");
    }

    #[test]
    fn the_assistance_mark_is_per_connection_and_clearable() {
        let p = OpenProject::in_memory("t").unwrap();
        assert_eq!(assisted(&p.conn), None);
        let by = AssistedBy {
            provider: "openAiCompatible".into(),
            model: "  llama3  ".into(),
        };
        set_assisted(&p.conn, Some(&by)).unwrap();
        assert_eq!(assisted(&p.conn).unwrap().model, "llama3");
        set_assisted(&p.conn, None).unwrap();
        assert_eq!(assisted(&p.conn), None);
        let n: i64 = p
            .conn
            .query_row(
                "SELECT count(*) FROM main.sqlite_master WHERE name = 'activity_assist'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn the_log_travels_with_the_project_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audit.misket");
        let copy = dir.path().join("audit-copy.misket");
        {
            let p = OpenProject::create(&path, "Audit", "0.1.0").unwrap();
            set_actor(&p.conn, "Ada").unwrap();
            codes::tests::mk(&p.conn, "Alpha", None);
            backup::save_copy(&p.conn, &copy).unwrap();
        }
        // Both the project and the copy taken from it carry the same log.
        for file in [&path, &copy] {
            let reopened = OpenProject::open(file).unwrap();
            let page = list(&reopened.conn, &ActivityFilter::default()).unwrap();
            assert_eq!(page.total, 1);
            assert_eq!(page.entries[0].kind, "code.created");
            assert_eq!(page.entries[0].actor, "Ada");
            // The actor is per connection, not stored in the file.
            assert_eq!(actor(&reopened.conn), "");
        }
    }
}
