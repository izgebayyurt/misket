//! History: a persisted undo tree.
//!
//! Every domain write appends one node to `history`, inside the same
//! transaction as the change it describes. A node carries the operation and
//! its exact opposite as JSON — data, not closures — so undo survives a
//! restart, a backup and a project file handed to someone else.
//!
//! The nodes form a tree rather than a stack. `project_meta.history_head`
//! points at the node undo would take back next; undo walks toward the root
//! and redo toward a leaf, and an edit made after an undo becomes a *second*
//! child of the same parent instead of throwing the redo path away. Nothing
//! is ever discarded, so "the thing I tried an hour ago" is still reachable
//! with [`checkout`].
//!
//! Applying a payload must not itself be recorded, or undoing would append a
//! node that undoes the undo. [`with_replay`] raises a per-connection flag
//! that turns [`record`] into a no-op for the duration.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{codes, excerpts, transcripts, util};
use crate::error::{AppError, Result};
use crate::models::{
    ChildrenStrategy, CodePatch, CodeTreeSnapshot, CompactReport, ExcerptSnapshot, HistoryNode,
    HistoryNodeSummary, Memo, TagRow,
};
use crate::text::TranscriptFormat;

// ------------------------------------------------------------- the head

const HEAD_KEY: &str = "history_head";
/// Which root node a redo from before the first node should follow.
const ROOT_CHILD_KEY: &str = "history_root_child";

fn meta_i64(conn: &Connection, key: &str) -> Result<Option<i64>> {
    Ok(super::meta(conn, key)?.and_then(|v| v.trim().parse::<i64>().ok()))
}

fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO project_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// The node undo would take back next. `None` means "before the first node".
pub fn head(conn: &Connection) -> Result<Option<i64>> {
    meta_i64(conn, HEAD_KEY)
}

fn set_head(conn: &Connection, id: Option<i64>) -> Result<()> {
    set_meta(
        conn,
        HEAD_KEY,
        &id.map(|i| i.to_string()).unwrap_or_default(),
    )
}

// ----------------------------------------------------------- replay flag

/// Whether this connection is replaying a node right now.
///
/// A `TEMP` table, like the actor: per connection, never written to the file,
/// and always reset even if the replay fails.
pub fn replaying(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT replaying FROM temp.history_state LIMIT 1",
        [],
        |r| r.get::<_, i64>(0),
    )
    .map(|v| v != 0)
    .unwrap_or(false)
}

fn set_replaying(conn: &Connection, on: bool) -> Result<()> {
    conn.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS history_state (replaying INTEGER NOT NULL)",
    )?;
    conn.execute("DELETE FROM temp.history_state", [])?;
    conn.execute(
        "INSERT INTO temp.history_state (replaying) VALUES (?1)",
        [i64::from(on)],
    )?;
    Ok(())
}

/// Run `f` with recording suppressed. Replaying a node calls the ordinary
/// domain functions, which would otherwise log the replay as a fresh edit.
pub fn with_replay<T>(conn: &Connection, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    let was = replaying(conn);
    set_replaying(conn, true)?;
    let out = f(conn);
    set_replaying(conn, was)?;
    out
}

// -------------------------------------------------------------- recording

/// Append one node under the current head and make it the new head.
///
/// `forward` and `inverse` are the operation and its opposite; passing `None`
/// records the step as readable but not undoable. Returns the new node's id,
/// or 0 while replaying, when nothing is written.
#[allow(clippy::too_many_arguments)]
pub fn record(
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
    if replaying(conn) {
        return Ok(0);
    }
    let parent = head(conn)?;
    conn.execute(
        "INSERT INTO history (parent_id, at, actor, kind, target_kind, target_id,
                              summary, detail_json, forward_json, inverse_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            parent,
            util::now(),
            actor,
            kind,
            target_kind,
            target_id,
            summary,
            detail.to_string(),
            forward.as_ref().map(Value::to_string),
            inverse.as_ref().map(Value::to_string),
        ],
    )?;
    let id = conn.last_insert_rowid();
    match parent {
        Some(p) => {
            conn.execute(
                "UPDATE history SET preferred_child = ?2 WHERE id = ?1",
                params![p, id],
            )?;
        }
        None => set_meta(conn, ROOT_CHILD_KEY, &id.to_string())?,
    }
    set_head(conn, Some(id))?;
    Ok(id)
}

/// [`record`], plus bytes too big for a JSON payload (a deleted document's
/// text, an image's pixels). Nothing in this phase writes any yet.
#[allow(clippy::too_many_arguments)]
pub fn record_with_blobs(
    conn: &Connection,
    actor: &str,
    kind: &str,
    target_kind: &str,
    target_id: Option<&str>,
    summary: &str,
    detail: &Value,
    forward: Option<Value>,
    inverse: Option<Value>,
    blobs: &[(&str, &[u8])],
) -> Result<i64> {
    let id = record(
        conn,
        actor,
        kind,
        target_kind,
        target_id,
        summary,
        detail,
        forward,
        inverse,
    )?;
    if id == 0 {
        return Ok(0);
    }
    for (name, bytes) in blobs {
        conn.execute(
            "INSERT OR REPLACE INTO history_blobs (node_id, name, bytes) VALUES (?1, ?2, ?3)",
            params![id, name, bytes],
        )?;
    }
    Ok(id)
}

/// The bytes [`record_with_blobs`] stored under `name` for a node.
pub fn blob(conn: &Connection, node_id: i64, name: &str) -> Result<Option<Vec<u8>>> {
    Ok(conn
        .query_row(
            "SELECT bytes FROM history_blobs WHERE node_id = ?1 AND name = ?2",
            params![node_id, name],
            |r| r.get(0),
        )
        .optional()?)
}

// ------------------------------------------------------------ reading nodes

pub(super) const COLUMNS: &str = "id, parent_id, at, actor, kind, target_kind, target_id,
     summary, detail_json, forward_json, inverse_json, branch_name, preferred_child";

fn json_or_empty(s: String) -> Value {
    // A payload written by a newer build (or hand-edited) reads back as an
    // empty object rather than making the whole list unreadable.
    serde_json::from_str(&s).unwrap_or_else(|_| json!({}))
}

pub(super) fn node_from_row(r: &Row) -> rusqlite::Result<HistoryNode> {
    let detail: String = r.get(8)?;
    Ok(HistoryNode {
        id: r.get(0)?,
        parent_id: r.get(1)?,
        at: r.get(2)?,
        actor: r.get(3)?,
        kind: r.get(4)?,
        target_kind: r.get(5)?,
        target_id: r.get(6)?,
        summary: r.get(7)?,
        detail: json_or_empty(detail),
        forward: r.get::<_, Option<String>>(9)?.map(json_or_empty),
        inverse: r.get::<_, Option<String>>(10)?.map(json_or_empty),
        branch_name: r.get(11)?,
        preferred_child: r.get(12)?,
    })
}

pub fn get(conn: &Connection, id: i64) -> Result<HistoryNode> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM history WHERE id = ?1"),
        [id],
        node_from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("history node {id} not found")))
}

/// The ids from `id` up to its root, `id` first.
fn ancestry(conn: &Connection, id: Option<i64>) -> Result<Vec<i64>> {
    let mut out = vec![];
    let mut seen = HashSet::new();
    let mut cursor = id;
    while let Some(current) = cursor {
        if !seen.insert(current) {
            break;
        }
        out.push(current);
        cursor = conn
            .query_row(
                "SELECT parent_id FROM history WHERE id = ?1",
                [current],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten();
    }
    Ok(out)
}

fn children_of(conn: &Connection, id: Option<i64>) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare("SELECT id FROM history WHERE parent_id IS ?1 ORDER BY id")?;
    let ids = stmt.query_map([id], |r| r.get(0))?;
    Ok(ids.collect::<rusqlite::Result<_>>()?)
}

// ------------------------------------------------------------- the payloads
//
// One vocabulary of effects per family. Both directions of a node use the
// same vocabulary, so `code.created` is a `restore` one way and a `drop` the
// other, and nothing needs to know which direction it is running in.

/// A node that belongs to the same user action as its child — the first half
/// of an operation that writes two entries, one per side of a merge or split.
/// Undo and redo run straight through it.
pub fn linked() -> Value {
    json!({ "op": "linked" })
}

fn is_linked(payload: Option<&Value>) -> bool {
    payload.and_then(|p| p.get("op")).and_then(Value::as_str) == Some("linked")
}

fn node_is_linked(node: &HistoryNode) -> bool {
    is_linked(node.forward.as_ref()) || is_linked(node.inverse.as_ref())
}

/// One code put back where it was after its parent was restored around it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reparent {
    pub code_id: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum CodeOp {
    /// Put a branch of the codebook back: the inverse of deleting it, of
    /// merging it away, or (with an empty snapshot body) of creating it.
    Restore {
        snapshot: CodeTreeSnapshot,
        /// Children a `promote` delete or a merge moved elsewhere.
        #[serde(default)]
        reparent: Vec<Reparent>,
        /// Tags the operation handed to another code, to take back.
        #[serde(default)]
        remove_tags: Vec<TagRow>,
    },
    /// Delete codes outright: the inverse of having created them.
    Drop { code_ids: Vec<String> },
    Delete {
        code_id: String,
        strategy: ChildrenStrategy,
        /// Where `promote` leaves the children, with the timestamps the
        /// original run gave them.
        #[serde(default)]
        reparent: Vec<Reparent>,
    },
    Update {
        code_id: String,
        patch: Box<CodePatch>,
        updated_at: String,
    },
    Move {
        code_id: String,
        parent_id: Option<String>,
        index: i64,
        updated_at: String,
    },
    Merge {
        source_id: String,
        target_id: String,
        /// Where the source's children land under the target.
        #[serde(default)]
        reparent: Vec<Reparent>,
        /// The memos the merge re-pointed, as they stand afterwards.
        #[serde(default)]
        memos: Vec<Memo>,
    },
}

/// One `excerpts` row's boundaries and quoted text.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RangeRow {
    pub excerpt_id: String,
    pub start_pos: i64,
    pub end_pos: i64,
    pub snapshot: Option<String>,
    pub updated_at: String,
}

/// A memo moved from one excerpt to another (undoing a merge moves it back).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoMove {
    pub memo_id: String,
    pub excerpt_id: String,
    pub updated_at: String,
}

/// An excerpt's `updated_at`, for changes that only touch its tags.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Touch {
    pub excerpt_id: String,
    pub updated_at: String,
}

/// Everything the excerpt and bulk operations do, in one shape. The steps run
/// in the order the fields are declared, which is the order that keeps every
/// case legal: memos leave a row before it is deleted, and a range is freed
/// before the excerpt that used to hold it is put back.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ExcerptChange {
    pub move_memos: Vec<MemoMove>,
    pub delete_excerpts: Vec<String>,
    pub ranges: Vec<RangeRow>,
    pub restore_excerpts: Vec<ExcerptSnapshot>,
    pub remove_tags: Vec<TagRow>,
    pub add_tags: Vec<TagRow>,
    pub touch: Vec<Touch>,
}

/// Setting which transcript format a document is read with, or the
/// project-level default. Both directions speak the same vocabulary — the
/// format to put in force — so undo and redo are the same payload with
/// different contents.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TranscriptChange {
    /// The document this is the format of; absent for the project default.
    pub document_id: Option<String>,
    /// Absent means "detect automatically": for a document, forget the stored
    /// answer so the next read detects one; for the project, back to `auto`.
    pub format: Option<TranscriptFormat>,
}

/// Memo writes: `restore` upserts a whole row, so it covers create, edit and
/// undelete alike.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MemoChange {
    pub delete: Vec<String>,
    pub restore: Vec<Memo>,
}

// -------------------------------------------------------------- applying

impl CodeOp {
    fn run(&self, conn: &Connection) -> Result<()> {
        match self {
            CodeOp::Restore {
                snapshot,
                reparent,
                remove_tags,
            } => {
                codes::restore_subtree(conn, snapshot)?;
                place(conn, reparent)?;
                for t in remove_tags {
                    conn.execute(
                        "DELETE FROM excerpt_codes WHERE excerpt_id = ?1 AND code_id = ?2",
                        params![t.excerpt_id, t.code_id],
                    )?;
                }
                // The recorded sibling order is the last word, after the
                // children have been put back underneath.
                codes::apply_sibling_order(conn, &snapshot.sibling_order)
            }
            CodeOp::Drop { code_ids } => codes::delete_codes(conn, code_ids),
            CodeOp::Delete {
                code_id,
                strategy,
                reparent,
            } => {
                codes::delete(conn, code_id, *strategy)?;
                place(conn, reparent)
            }
            CodeOp::Update {
                code_id,
                patch,
                updated_at,
            } => {
                codes::update(conn, code_id, (**patch).clone())?;
                set_updated_at(conn, code_id, updated_at)
            }
            CodeOp::Move {
                code_id,
                parent_id,
                index,
                updated_at,
            } => {
                codes::move_code(conn, code_id, parent_id.as_deref(), *index)?;
                set_updated_at(conn, code_id, updated_at)
            }
            CodeOp::Merge {
                source_id,
                target_id,
                reparent,
                memos,
            } => {
                codes::merge(conn, source_id, target_id)?;
                place(conn, reparent)?;
                MemoChange {
                    delete: vec![],
                    restore: memos.clone(),
                }
                .run(conn)
            }
        }
    }
}

/// Put codes back under a given parent, at a given place, with the timestamp
/// the run being replayed gave them.
fn place(conn: &Connection, moves: &[Reparent]) -> Result<()> {
    for r in moves {
        conn.execute(
            "UPDATE codes SET parent_id = ?2, sort_order = ?3, updated_at = ?4 WHERE id = ?1",
            params![r.code_id, r.parent_id, r.sort_order, r.updated_at],
        )?;
    }
    Ok(())
}

/// Replaying restores the state, which includes when each row last changed.
fn set_updated_at(conn: &Connection, code_id: &str, at: &str) -> Result<()> {
    conn.execute(
        "UPDATE codes SET updated_at = ?2 WHERE id = ?1",
        params![code_id, at],
    )?;
    Ok(())
}

impl ExcerptChange {
    fn run(&self, conn: &Connection) -> Result<()> {
        for m in &self.move_memos {
            conn.execute(
                "UPDATE memos SET excerpt_id = ?2, updated_at = ?3 WHERE id = ?1",
                params![m.memo_id, m.excerpt_id, m.updated_at],
            )?;
        }
        for id in &self.delete_excerpts {
            excerpts::delete(conn, id)?;
        }
        for r in &self.ranges {
            conn.execute(
                "UPDATE excerpts SET start_pos = ?2, end_pos = ?3, snapshot = ?4, updated_at = ?5
                 WHERE id = ?1",
                params![
                    r.excerpt_id,
                    r.start_pos,
                    r.end_pos,
                    r.snapshot,
                    r.updated_at
                ],
            )?;
        }
        for snapshot in &self.restore_excerpts {
            excerpts::restore(conn, snapshot)?;
        }
        for t in &self.remove_tags {
            conn.execute(
                "DELETE FROM excerpt_codes WHERE excerpt_id = ?1 AND code_id = ?2",
                params![t.excerpt_id, t.code_id],
            )?;
        }
        for t in &self.add_tags {
            // A code deleted in the meantime simply keeps its tag off.
            conn.execute(
                "INSERT OR IGNORE INTO excerpt_codes (excerpt_id, code_id, created_at)
                 SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM codes WHERE id = ?2)",
                params![t.excerpt_id, t.code_id, t.created_at],
            )?;
        }
        for t in &self.touch {
            conn.execute(
                "UPDATE excerpts SET updated_at = ?2 WHERE id = ?1",
                params![t.excerpt_id, t.updated_at],
            )?;
        }
        Ok(())
    }
}

impl MemoChange {
    fn run(&self, conn: &Connection) -> Result<()> {
        for id in &self.delete {
            conn.execute("DELETE FROM memos WHERE id = ?1", [id])?;
        }
        for m in &self.restore {
            conn.execute(
                "INSERT INTO memos (id, document_id, code_id, excerpt_id, title, body,
                                    created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                   document_id = excluded.document_id, code_id = excluded.code_id,
                   excerpt_id = excluded.excerpt_id, title = excluded.title,
                   body = excluded.body, updated_at = excluded.updated_at",
                params![
                    m.id,
                    m.document_id,
                    m.code_id,
                    m.excerpt_id,
                    m.title,
                    m.body,
                    m.created_at,
                    m.updated_at
                ],
            )?;
        }
        Ok(())
    }
}

impl TranscriptChange {
    fn run(&self, conn: &Connection) -> Result<()> {
        match &self.document_id {
            Some(id) => {
                transcripts::set_format(conn, id, self.format.clone())?;
            }
            None => transcripts::set_default(conn, self.format.clone())?,
        }
        Ok(())
    }
}

/// Run one payload, choosing the vocabulary the node's kind is written in.
///
/// Anything this match does not list is a kind no inverse has been written
/// for yet; it is still recorded (with no payloads) so the history reads
/// correctly, but walking over it is refused rather than silently skipped.
fn apply(conn: &Connection, kind: &str, payload: &Value) -> Result<()> {
    if is_linked(Some(payload)) {
        return Ok(());
    }
    match kind {
        "code.created" | "code.updated" | "code.moved" | "code.deleted" | "code.merged_into"
        | "code.merged_from" => serde_json::from_value::<CodeOp>(payload.clone())?.run(conn),
        "excerpt.created"
        | "excerpt.codes_added"
        | "excerpt.code_removed"
        | "excerpt.range_updated"
        | "excerpt.split"
        | "excerpt.split_off"
        | "excerpt.merged"
        | "excerpt.merged_into"
        | "excerpt.deleted"
        | "excerpt.restored"
        | "bulk.excerpts_deleted"
        | "bulk.codes_added"
        | "bulk.codes_removed"
        | "bulk.retagged"
        | "bulk.auto_coded" => serde_json::from_value::<ExcerptChange>(payload.clone())?.run(conn),
        "memo.created" | "memo.updated" | "memo.deleted" | "memo.restored" => {
            serde_json::from_value::<MemoChange>(payload.clone())?.run(conn)
        }
        "transcript.format_set" | "transcript.default_set" => {
            serde_json::from_value::<TranscriptChange>(payload.clone())?.run(conn)
        }
        other => Err(AppError::Validation(format!("not undoable yet: {other}"))),
    }
}

/// Redo one node.
pub fn apply_forward(conn: &Connection, node: &HistoryNode) -> Result<()> {
    let payload = node
        .forward
        .as_ref()
        .ok_or_else(|| AppError::Validation("this step cannot be redone".into()))?;
    with_replay(conn, |conn| apply(conn, &node.kind, payload))
}

/// Undo one node.
pub fn apply_inverse(conn: &Connection, node: &HistoryNode) -> Result<()> {
    let payload = node
        .inverse
        .as_ref()
        .ok_or_else(|| AppError::Validation("this step cannot be undone".into()))?;
    with_replay(conn, |conn| apply(conn, &node.kind, payload))
}

// ------------------------------------------------------------ walking

/// Take back the head node and move the head to its parent.
///
/// Returns the node that was undone, or `None` when the head is already
/// before the first node. An operation that wrote two entries (both sides of
/// a merge or a split) is undone as one step.
pub fn undo(conn: &Connection) -> Result<Option<HistoryNode>> {
    let Some(mut id) = head(conn)? else {
        return Ok(None);
    };
    let tx = util::tx(conn)?;
    let mut undone = get(&tx, id)?;
    loop {
        let node = get(&tx, id)?;
        apply_inverse(&tx, &node)?;
        set_head(&tx, node.parent_id)?;
        if !node_is_linked(&node) {
            undone = node.clone();
        }
        match node.parent_id {
            Some(parent) if node_is_linked(&get(&tx, parent)?) => id = parent,
            _ => break,
        }
    }
    tx.commit()?;
    Ok(Some(undone))
}

fn next_child(conn: &Connection, parent: Option<i64>, wanted: Option<i64>) -> Result<Option<i64>> {
    if let Some(id) = wanted {
        let node = get(conn, id)?;
        if node.parent_id != parent {
            return Err(AppError::Validation(
                "that step does not follow the current one".into(),
            ));
        }
        return Ok(Some(id));
    }
    let preferred = match parent {
        Some(p) => get(conn, p)?.preferred_child,
        None => meta_i64(conn, ROOT_CHILD_KEY)?,
    };
    let children = children_of(conn, parent)?;
    Ok(preferred
        .filter(|p| children.contains(p))
        .or_else(|| children.last().copied()))
}

fn prefer(conn: &Connection, parent: Option<i64>, child: i64) -> Result<()> {
    match parent {
        Some(p) => {
            conn.execute(
                "UPDATE history SET preferred_child = ?2 WHERE id = ?1",
                params![p, child],
            )?;
        }
        None => set_meta(conn, ROOT_CHILD_KEY, &child.to_string())?,
    }
    Ok(())
}

/// Step forward onto a child of the head: the one named, else the branch
/// redo followed last, else the newest.
pub fn redo(conn: &Connection, child: Option<i64>) -> Result<Option<HistoryNode>> {
    let parent = head(conn)?;
    let tx = util::tx(conn)?;
    let Some(mut id) = next_child(&tx, parent, child)? else {
        return Ok(None);
    };
    let mut redone;
    loop {
        let node = get(&tx, id)?;
        apply_forward(&tx, &node)?;
        prefer(&tx, node.parent_id, node.id)?;
        set_head(&tx, Some(node.id))?;
        redone = node.clone();
        if node_is_linked(&node) {
            match next_child(&tx, Some(node.id), None)? {
                Some(next) => id = next,
                None => break,
            }
        } else {
            break;
        }
    }
    tx.commit()?;
    Ok(Some(redone))
}

/// Move the project to the state at `node_id`, wherever it sits in the tree.
///
/// Walks up from the head to the lowest common ancestor applying inverses,
/// then down the other side applying forwards, in one transaction — so a
/// branch that turns out to be unreachable leaves the project untouched.
pub fn checkout(conn: &Connection, node_id: i64) -> Result<HistoryNode> {
    let target = get(conn, node_id)?;
    let here = head(conn)?;
    if here == Some(node_id) {
        return Ok(target);
    }
    let up_chain = ancestry(conn, here)?;
    let down_chain = ancestry(conn, Some(node_id))?;
    let down_set: HashSet<i64> = down_chain.iter().copied().collect();
    let lca = up_chain.iter().copied().find(|id| down_set.contains(id));

    let up: Vec<i64> = up_chain
        .iter()
        .copied()
        .take_while(|id| Some(*id) != lca)
        .collect();
    let mut down: Vec<i64> = down_chain
        .iter()
        .copied()
        .take_while(|id| Some(*id) != lca)
        .collect();
    down.reverse();

    let tx = util::tx(conn)?;
    for id in up {
        let node = get(&tx, id)?;
        apply_inverse(&tx, &node)?;
        set_head(&tx, node.parent_id)?;
    }
    for id in down {
        let node = get(&tx, id)?;
        apply_forward(&tx, &node)?;
        prefer(&tx, node.parent_id, node.id)?;
        set_head(&tx, Some(node.id))?;
    }
    tx.commit()?;
    Ok(target)
}

// ------------------------------------------------------------- branches

/// Name the current node, so the branch that grows from it can be found again.
pub fn fork_here(conn: &Connection, name: &str) -> Result<HistoryNode> {
    let id = head(conn)?.ok_or_else(|| {
        AppError::Validation("there is nothing to fork from yet: make a change first".into())
    })?;
    rename_branch(conn, id, Some(name))
}

/// Set or clear a node's branch name. An empty name clears it.
pub fn rename_branch(conn: &Connection, node_id: i64, name: Option<&str>) -> Result<HistoryNode> {
    get(conn, node_id)?;
    let name = name.map(str::trim).filter(|n| !n.is_empty());
    conn.execute(
        "UPDATE history SET branch_name = ?2 WHERE id = ?1",
        params![node_id, name],
    )?;
    get(conn, node_id)
}

/// The whole tree, oldest first, with each node's children.
pub fn tree(conn: &Connection) -> Result<Vec<HistoryNodeSummary>> {
    let head = head(conn)?;
    let mut children: HashMap<Option<i64>, Vec<i64>> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, at, actor, kind, summary, branch_name, inverse_json IS NOT NULL
         FROM history ORDER BY id",
    )?;
    /// id, parent, at, actor, kind, summary, branch name, undoable.
    type TreeRow = (
        i64,
        Option<i64>,
        String,
        String,
        String,
        String,
        Option<String>,
        bool,
    );
    let rows: Vec<TreeRow> = stmt
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
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    for (id, parent, ..) in &rows {
        children.entry(*parent).or_default().push(*id);
    }
    Ok(rows
        .iter()
        .map(
            |(id, parent_id, at, actor, kind, summary, branch_name, undoable)| HistoryNodeSummary {
                id: *id,
                parent_id: *parent_id,
                at: at.clone(),
                actor: actor.clone(),
                kind: kind.clone(),
                summary: summary.clone(),
                branch_name: branch_name.clone(),
                undoable: *undoable,
                is_head: head == Some(*id),
                children: children.get(&Some(*id)).cloned().unwrap_or_default(),
            },
        )
        .collect())
}

/// Throw away everything before `node_id`, making it a new root.
///
/// Everything that is not `node_id` or under it goes: the steps that led here
/// and any side branch left behind. Refuses while the project is somewhere
/// else in the tree, because that state would become unreachable.
pub fn compact_before(conn: &Connection, node_id: i64) -> Result<CompactReport> {
    get(conn, node_id)?;
    let head = head(conn)?;
    let keep: HashSet<i64> = descendants(conn, node_id)?;
    if !head.is_some_and(|h| keep.contains(&h)) {
        return Err(AppError::Validation(
            "go to that step first: compacting from here would drop where the project is".into(),
        ));
    }
    let tx = util::tx(conn)?;
    let mut stmt = tx.prepare("SELECT id, branch_name FROM history ORDER BY id")?;
    let all: Vec<(i64, Option<String>)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    let doomed: Vec<&(i64, Option<String>)> =
        all.iter().filter(|(id, _)| !keep.contains(id)).collect();
    let dropped_branches: Vec<String> = doomed.iter().filter_map(|(_, n)| n.clone()).collect();

    // Detach first: deleting an ancestor would cascade the kept branch away.
    tx.execute(
        "UPDATE history SET parent_id = NULL, forward_json = NULL, inverse_json = NULL
         WHERE id = ?1",
        [node_id],
    )?;
    for (id, _) in &doomed {
        tx.execute("DELETE FROM history WHERE id = ?1", [id])?;
    }
    set_meta(&tx, ROOT_CHILD_KEY, &node_id.to_string())?;
    tx.commit()?;
    Ok(CompactReport {
        dropped_nodes: doomed.len() as i64,
        dropped_branches,
    })
}

/// `id` and everything under it.
fn descendants(conn: &Connection, id: i64) -> Result<HashSet<i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE sub(id) AS (
            SELECT id FROM history WHERE id = ?1
            UNION SELECT h.id FROM history h JOIN sub ON h.parent_id = sub.id
         ) SELECT id FROM sub",
    )?;
    let ids = stmt.query_map([id], |r| r.get(0))?;
    Ok(ids.collect::<rusqlite::Result<_>>()?)
}

/// A payload as it is stored: JSON, never a closure.
pub fn payload<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or_else(|_| json!({}))
}

/// Put these memo rows back (or write them for the first time).
pub fn memos_restored(rows: &[Memo]) -> Value {
    payload(&MemoChange {
        delete: vec![],
        restore: rows.to_vec(),
    })
}

/// Take these memos away again.
pub fn memos_deleted(ids: &[String]) -> Value {
    payload(&MemoChange {
        delete: ids.to_vec(),
        restore: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{bulk, codes, documents, excerpts, memos, sets, OpenProject};
    use crate::models::{
        ActivityFilter, ApplyCodesInput, AutoCodeHit, ChildrenStrategy, CodePatch, MemoTarget,
        NewCode,
    };
    use std::collections::BTreeMap;

    // ------------------------------------------------- the generic harness

    /// Every user table the project holds, row by row as text.
    ///
    /// The history itself is left out (it grows with every operation, which
    /// is the point), and so is the head pointer inside `project_meta`. What
    /// is left is the state an undo has to restore *exactly*: ids, order,
    /// timestamps and all.
    fn dump_state(conn: &Connection) -> BTreeMap<String, Vec<String>> {
        let mut names: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table'
                   AND name NOT LIKE 'sqlite_%'
                   AND name NOT IN ('history', 'history_blobs')
                 ORDER BY name",
            )
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        names.sort();

        let mut out = BTreeMap::new();
        for table in names {
            let columns: Vec<String> = conn
                .prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
                .unwrap()
                .query_map([], |r| r.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();
            // The head moves on every undo by design; everything else in
            // `project_meta` has to stay put.
            let filter = if table == "project_meta" {
                " WHERE key NOT IN ('history_head', 'history_root_child')"
            } else {
                ""
            };
            let order = (1..=columns.len())
                .map(|i| i.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let mut stmt = conn
                .prepare(&format!("SELECT * FROM {table}{filter} ORDER BY {order}"))
                .unwrap();
            let rows: Vec<String> = stmt
                .query_map([], |r| {
                    Ok(columns
                        .iter()
                        .enumerate()
                        .map(|(i, c)| format!("{c}={}", cell(r.get_ref(i).unwrap())))
                        .collect::<Vec<_>>()
                        .join(" "))
                })
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();
            out.insert(table, rows);
        }
        out
    }

    /// One column value, readable enough to tell two dumps apart at a glance.
    fn cell(v: rusqlite::types::ValueRef<'_>) -> String {
        use rusqlite::types::ValueRef;
        match v {
            ValueRef::Null => "-".into(),
            ValueRef::Integer(i) => i.to_string(),
            ValueRef::Real(f) => f.to_string(),
            ValueRef::Text(t) => format!("{:?}", String::from_utf8_lossy(t)),
            ValueRef::Blob(b) => format!("<{} bytes>", b.len()),
        }
    }

    /// Assert two dumps match, naming the table and the rows that differ
    /// rather than printing the whole project twice.
    fn assert_same(
        left: &BTreeMap<String, Vec<String>>,
        right: &BTreeMap<String, Vec<String>>,
        what: &str,
    ) {
        for (table, rows) in left {
            let other = right.get(table).cloned().unwrap_or_default();
            if *rows != other {
                let only_left: Vec<&String> = rows.iter().filter(|r| !other.contains(r)).collect();
                let only_right: Vec<&String> = other.iter().filter(|r| !rows.contains(r)).collect();
                panic!(
                    "{what}: {table} differs\n  expected only: {only_left:#?}\n  actual only: {only_right:#?}"
                );
            }
        }
        assert_eq!(
            left.keys().collect::<Vec<_>>(),
            right.keys().collect::<Vec<_>>()
        );
    }

    /// Run `op`, undo it and assert the project is byte-for-byte what it was,
    /// then redo it and assert it is byte-for-byte what `op` left behind.
    fn assert_round_trip(conn: &Connection, label: &str, op: impl FnOnce(&Connection)) {
        let before = dump_state(conn);
        op(conn);
        let after = dump_state(conn);
        assert_ne!(before, after, "{label}: the operation changed nothing");

        let undone = undo(conn)
            .unwrap_or_else(|e| panic!("{label}: undo failed: {e}"))
            .unwrap_or_else(|| panic!("{label}: nothing to undo"));
        assert_same(&before, &dump_state(conn), &format!("{label}: undo"));

        let redone = redo(conn, None)
            .unwrap_or_else(|e| panic!("{label}: redo failed: {e}"))
            .unwrap_or_else(|| panic!("{label}: nothing to redo"));
        assert_same(&after, &dump_state(conn), &format!("{label}: redo"));
        assert_eq!(undone.id, redone.id, "{label}: undo and redo disagree");
    }

    struct Fixture {
        p: OpenProject,
        doc: String,
    }

    impl Fixture {
        fn new() -> Self {
            let p = OpenProject::in_memory("t").unwrap();
            crate::db::activity::set_actor(&p.conn, "Ada").unwrap();
            let doc = documents::create(
                &p.conn,
                documents::tests::new_doc("Alpha beta gamma delta epsilon zeta eta theta."),
            )
            .unwrap()
            .summary
            .id;
            Self { p, doc }
        }
        fn conn(&self) -> &Connection {
            &self.p.conn
        }
        fn code(&self, name: &str, parent: Option<&str>) -> String {
            codes::tests::mk(self.conn(), name, parent).id
        }
        fn excerpt(&self, start: i64, end: i64, code_ids: &[String]) -> String {
            excerpts::apply_codes(
                self.conn(),
                ApplyCodesInput {
                    document_id: self.doc.clone(),
                    start_pos: Some(start),
                    end_pos: Some(end),
                    code_ids: code_ids.to_vec(),
                    ..Default::default()
                },
            )
            .unwrap()
            .excerpt
            .id
        }
    }

    // ------------------------------------------------------------- codes

    #[test]
    fn round_trips_creating_editing_and_moving_a_code() {
        let f = Fixture::new();
        let c = f.conn();
        let parent = f.code("Themes", None);
        assert_round_trip(c, "create", |c| {
            codes::create(
                c,
                NewCode {
                    name: "Trust".into(),
                    description: Some("About trust".into()),
                    shortcut: Some("t".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        });
        let trust = codes::list(c)
            .unwrap()
            .into_iter()
            .find(|x| x.name == "Trust")
            .unwrap()
            .id;
        assert_round_trip(c, "update", |c| {
            codes::update(
                c,
                &trust,
                CodePatch {
                    name: Some("Trust in staff".into()),
                    description: Some("When a participant speaks about staff".into()),
                    shortcut: Some(None),
                    ..Default::default()
                },
            )
            .unwrap();
        });
        // Give it siblings, so the move has an order to put back.
        f.code("Access", None);
        f.code("Cost", None);
        assert_round_trip(c, "move", |c| {
            codes::move_code(c, &trust, Some(&parent), 0).unwrap();
        });
        assert_round_trip(c, "move back to the top level", |c| {
            codes::move_code(c, &trust, None, 1).unwrap();
        });
    }

    /// Deleting a code with `promote` keeps its children, one level up. Undo
    /// has to put the code back *and* tuck the children under it again, in
    /// the order they were in.
    #[test]
    fn round_trips_deleting_a_code_with_promote_and_with_delete() {
        for strategy in [ChildrenStrategy::Promote, ChildrenStrategy::Delete] {
            let f = Fixture::new();
            let c = f.conn();
            let parent = f.code("Themes", None);
            let doomed = f.code("Trust", Some(&parent));
            let kid_a = f.code("Staff", Some(&doomed));
            let kid_b = f.code("Systems", Some(&doomed));
            f.code("Access", Some(&parent));
            let grandchild = f.code("Nurses", Some(&kid_a));
            f.excerpt(0, 5, &[doomed.clone(), kid_b.clone()]);
            f.excerpt(6, 10, std::slice::from_ref(&grandchild));
            memos::create(
                c,
                MemoTarget {
                    code_id: Some(doomed.clone()),
                    ..Default::default()
                },
                "Why",
                "Because",
            )
            .unwrap();
            sets::create_set(c, "code", "Round 1", &[doomed.clone(), kid_b.clone()], None).unwrap();
            c.execute_batch(&format!(
                "INSERT INTO framework_matrices (id, name, row_kind, created_at, updated_at)
                   VALUES ('m', 'Wave 1', 'document', 't', 't');
                 INSERT INTO framework_cells (matrix_id, row_key, code_id, summary, updated_at)
                   VALUES ('m', '{}', '{doomed}', 'Said little.', 't');",
                f.doc
            ))
            .unwrap();

            assert_round_trip(c, &format!("delete {strategy:?}"), |c| {
                codes::delete(c, &doomed, strategy).unwrap();
            });
        }
    }

    /// Merging folds one code into another: its excerpts, children and memos
    /// all move. Undo has to unpick every part of that — and leave alone the
    /// target tag on excerpts that already carried it.
    #[test]
    fn round_trips_merging_codes_with_shared_excerpts_and_memos() {
        let f = Fixture::new();
        let c = f.conn();
        let source = f.code("Trust", None);
        let target = f.code("Relationships", None);
        let kid = f.code("Staff", Some(&source));
        f.code("Rapport", Some(&target));
        // One excerpt has only the source, one already has both.
        f.excerpt(0, 5, std::slice::from_ref(&source));
        f.excerpt(6, 10, &[source.clone(), target.clone()]);
        f.excerpt(11, 16, std::slice::from_ref(&kid));
        for (code, title) in [(&source, "Source note"), (&target, "Target note")] {
            memos::create(
                c,
                MemoTarget {
                    code_id: Some(code.clone()),
                    ..Default::default()
                },
                title,
                "body",
            )
            .unwrap();
        }
        sets::create_set(c, "code", "Round 1", std::slice::from_ref(&source), None).unwrap();

        let before_merge = head(c).unwrap();
        assert_round_trip(c, "merge", |c| {
            codes::merge(c, &source, &target).unwrap();
        });
        // A merge writes an entry per side, but it is one step: a single undo
        // after the redo brings the source back whole.
        assert!(codes::get(c, &source).is_err(), "the redo merged it away");
        let undone = undo(c).unwrap().unwrap();
        assert_eq!(undone.kind, "code.merged_from");
        assert!(codes::get(c, &source).is_ok());
        assert_eq!(head(c).unwrap(), before_merge, "both entries came off");
    }

    // ---------------------------------------------------------- excerpts

    #[test]
    fn round_trips_the_whole_life_of_an_excerpt() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        let b = f.code("Beta", None);

        assert_round_trip(c, "apply_codes creates", |c| {
            excerpts::apply_codes(
                c,
                ApplyCodesInput {
                    document_id: f.doc.clone(),
                    start_pos: Some(0),
                    end_pos: Some(10),
                    code_ids: vec![a.clone()],
                    ..Default::default()
                },
            )
            .unwrap();
        });
        let e = excerpts::list_for_document(c, &f.doc).unwrap()[0]
            .id
            .clone();
        assert_round_trip(c, "apply_codes adds", |c| {
            excerpts::apply_codes(
                c,
                ApplyCodesInput {
                    document_id: f.doc.clone(),
                    start_pos: Some(0),
                    end_pos: Some(10),
                    code_ids: vec![b.clone()],
                    ..Default::default()
                },
            )
            .unwrap();
        });
        assert_round_trip(c, "remove_code", |c| {
            excerpts::remove_code(c, &e, &b).unwrap();
        });
        assert_round_trip(c, "add_codes", |c| {
            excerpts::add_codes(c, &e, std::slice::from_ref(&b)).unwrap();
        });
        memos::create(
            c,
            MemoTarget {
                excerpt_id: Some(e.clone()),
                ..Default::default()
            },
            "Note",
            "on the excerpt",
        )
        .unwrap();
        assert_round_trip(c, "update_range", |c| {
            excerpts::update_range(c, &e, 0, 14).unwrap();
        });
        let snapshot = excerpts::snapshot(c, &e).unwrap();
        assert_round_trip(c, "delete", |c| {
            excerpts::delete(c, &e).unwrap();
        });
        // The redo left it deleted, so restoring is the next thing to try.
        assert_round_trip(c, "restore", |c| {
            excerpts::restore(c, &snapshot).unwrap();
        });
    }

    /// Offsets are code points, so a split has to land on a character
    /// boundary even when the text is emoji and combining marks.
    #[test]
    fn round_trips_splitting_and_merging_excerpts_over_emoji() {
        let p = OpenProject::in_memory("t").unwrap();
        let c = &p.conn;
        let doc = documents::create(
            c,
            documents::tests::new_doc("çay 🌍 içmek 👩‍🔬 güzeldir é herkes için."),
        )
        .unwrap()
        .summary
        .id;
        let code = codes::tests::mk(c, "Alpha", None).id;
        let e = excerpts::apply_codes(
            c,
            ApplyCodesInput {
                document_id: doc.clone(),
                start_pos: Some(0),
                end_pos: Some(20),
                code_ids: vec![code],
                ..Default::default()
            },
        )
        .unwrap()
        .excerpt
        .id;
        memos::create(
            c,
            MemoTarget {
                excerpt_id: Some(e.clone()),
                ..Default::default()
            },
            "Note",
            "🌍",
        )
        .unwrap();

        assert_round_trip(c, "split", |c| {
            excerpts::split(c, &e, 6).unwrap();
        });
        let right = excerpts::list_for_document(c, &doc)
            .unwrap()
            .into_iter()
            .find(|x| x.id != e)
            .unwrap()
            .id;
        // A memo on the half that disappears has to come back with it.
        memos::create(
            c,
            MemoTarget {
                excerpt_id: Some(right.clone()),
                ..Default::default()
            },
            "Right",
            "👩‍🔬",
        )
        .unwrap();
        assert_round_trip(c, "merge_adjacent", |c| {
            excerpts::merge_adjacent(c, &e, &right).unwrap();
        });
    }

    // -------------------------------------------------------------- bulk

    #[test]
    fn round_trips_the_bulk_operations() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        let b = f.code("Beta", None);
        let e1 = f.excerpt(0, 5, std::slice::from_ref(&a));
        let e2 = f.excerpt(6, 10, &[a.clone(), b.clone()]);
        let both = vec![e1.clone(), e2.clone()];

        assert_round_trip(c, "add_codes_many", |c| {
            bulk::add_codes_many(c, &both, std::slice::from_ref(&b)).unwrap();
        });
        assert_round_trip(c, "remove_codes_many", |c| {
            bulk::remove_codes_many(c, &both, std::slice::from_ref(&a)).unwrap();
        });
        assert_round_trip(c, "retag_code", |c| {
            bulk::retag_code(c, &b, &a).unwrap();
        });
        assert_round_trip(c, "auto_code", |c| {
            bulk::auto_code(
                c,
                &[
                    AutoCodeHit {
                        document_id: f.doc.clone(),
                        start_pos: 0,
                        end_pos: 5,
                    },
                    AutoCodeHit {
                        document_id: f.doc.clone(),
                        start_pos: 20,
                        end_pos: 26,
                    },
                ],
                &b,
            )
            .unwrap();
        });
        assert_round_trip(c, "delete_many", |c| {
            bulk::delete_many(c, &both).unwrap();
        });
    }

    // ------------------------------------------------------------- memos

    #[test]
    fn round_trips_memo_writes_on_every_target() {
        let f = Fixture::new();
        let c = f.conn();
        let code = f.code("Alpha", None);
        let excerpt = f.excerpt(0, 5, std::slice::from_ref(&code));
        for target in [
            MemoTarget::default(),
            MemoTarget {
                code_id: Some(code.clone()),
                ..Default::default()
            },
            MemoTarget {
                excerpt_id: Some(excerpt.clone()),
                ..Default::default()
            },
            MemoTarget {
                document_id: Some(f.doc.clone()),
                ..Default::default()
            },
        ] {
            assert_round_trip(c, "memo create", |c| {
                memos::create(c, target.clone(), "Title", "Body").unwrap();
            });
        }
        let memo = memos::list(c, &MemoTarget::default()).unwrap()[0].clone();
        assert_round_trip(c, "memo update", |c| {
            memos::update(c, &memo.id, "Edited", "New body").unwrap();
        });
        let edited = memos::get(c, &memo.id).unwrap();
        assert_round_trip(c, "memo delete", |c| {
            memos::delete(c, &memo.id).unwrap();
        });
        // The redo left it deleted, so restoring is the next thing to try.
        assert_round_trip(c, "memo restore", |c| {
            memos::restore(c, &edited).unwrap();
        });
    }

    // ------------------------------------------------------- the tree

    #[test]
    fn an_edit_after_an_undo_branches_instead_of_discarding_the_redo() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        let first = head(c).unwrap().unwrap();
        codes::update(
            c,
            &a,
            CodePatch {
                name: Some("Alpha one".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let left = head(c).unwrap().unwrap();

        undo(c).unwrap().unwrap();
        assert_eq!(head(c).unwrap(), Some(first));
        codes::update(
            c,
            &a,
            CodePatch {
                name: Some("Alpha two".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let right = head(c).unwrap().unwrap();

        // The path we left is still there, and still reachable.
        assert!(get(c, left).is_ok());
        assert_eq!(children_of(c, Some(first)).unwrap(), vec![left, right]);
        assert_eq!(codes::get(c, &a).unwrap().name, "Alpha two");

        // Redo follows the branch that was taken last.
        undo(c).unwrap().unwrap();
        let redone = redo(c, None).unwrap().unwrap();
        assert_eq!(redone.id, right);
        assert_eq!(codes::get(c, &a).unwrap().name, "Alpha two");

        // Naming the other branch and checking it out walks down to the
        // common ancestor and back up the other side.
        checkout(c, left).unwrap();
        assert_eq!(codes::get(c, &a).unwrap().name, "Alpha one");
        assert_eq!(head(c).unwrap(), Some(left));
        checkout(c, right).unwrap();
        assert_eq!(codes::get(c, &a).unwrap().name, "Alpha two");
    }

    #[test]
    fn checkout_across_a_common_ancestor_restores_the_exact_state() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        f.excerpt(0, 5, std::slice::from_ref(&a));
        let fork = head(c).unwrap().unwrap();
        let at_fork = dump_state(c);

        // One branch: rename twice.
        for name in ["One", "Two"] {
            codes::update(
                c,
                &a,
                CodePatch {
                    name: Some(name.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        }
        let tip_left = head(c).unwrap().unwrap();
        let at_left = dump_state(c);

        // Back to the fork, then a different branch: a second code and a memo.
        checkout(c, fork).unwrap();
        assert_same(&at_fork, &dump_state(c), "back to the fork");
        let b = f.code("Beta", None);
        memos::create(
            c,
            MemoTarget {
                code_id: Some(b.clone()),
                ..Default::default()
            },
            "Note",
            "Body",
        )
        .unwrap();
        let tip_right = head(c).unwrap().unwrap();
        let at_right = dump_state(c);

        checkout(c, tip_left).unwrap();
        assert_same(&at_left, &dump_state(c), "the left branch");
        checkout(c, tip_right).unwrap();
        assert_same(&at_right, &dump_state(c), "the right branch");
        assert_eq!(head(c).unwrap(), Some(tip_right));
    }

    #[test]
    fn fork_here_names_a_node_and_the_tree_reports_the_shape() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        let fork = fork_here(c, "  before the rename  ").unwrap();
        assert_eq!(fork.branch_name.as_deref(), Some("before the rename"));
        codes::update(
            c,
            &a,
            CodePatch {
                name: Some("One".into()),
                ..Default::default()
            },
        )
        .unwrap();
        undo(c).unwrap();
        codes::update(
            c,
            &a,
            CodePatch {
                name: Some("Two".into()),
                ..Default::default()
            },
        )
        .unwrap();

        let tree = tree(c).unwrap();
        let root = tree.iter().find(|n| n.id == fork.id).unwrap();
        assert_eq!(root.children.len(), 2, "the tree branches at the fork");
        assert_eq!(root.branch_name.as_deref(), Some("before the rename"));
        assert!(root.undoable);
        assert!(tree.iter().filter(|n| n.is_head).count() == 1);
        assert!(tree.last().unwrap().is_head);

        rename_branch(c, fork.id, None).unwrap();
        assert_eq!(get(c, fork.id).unwrap().branch_name, None);
    }

    #[test]
    fn compact_before_drops_what_came_first_and_the_side_branches() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        codes::update(
            c,
            &a,
            CodePatch {
                name: Some("One".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let keep = head(c).unwrap().unwrap();
        undo(c).unwrap();
        codes::update(
            c,
            &a,
            CodePatch {
                name: Some("Side".into()),
                ..Default::default()
            },
        )
        .unwrap();
        fork_here(c, "the road not taken").unwrap();
        checkout(c, keep).unwrap();
        codes::update(
            c,
            &a,
            CodePatch {
                name: Some("Later".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let state = dump_state(c);

        let report = compact_before(c, keep).unwrap();
        assert_eq!(report.dropped_nodes, 3, "two before it and one side branch");
        assert_eq!(report.dropped_branches, vec!["the road not taken"]);
        assert_same(&state, &dump_state(c), "compacting");
        assert_eq!(get(c, keep).unwrap().parent_id, None);
        // The kept node is a root now, so there is nothing to undo past it.
        undo(c).unwrap().unwrap();
        assert_eq!(codes::get(c, &a).unwrap().name, "One");
        assert!(matches!(undo(c), Err(AppError::Validation(_))));
    }

    #[test]
    fn compact_refuses_while_the_project_is_somewhere_else_in_the_tree() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        let first = head(c).unwrap().unwrap();
        codes::update(
            c,
            &a,
            CodePatch {
                name: Some("One".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let later = head(c).unwrap().unwrap();
        checkout(c, first).unwrap();
        assert!(matches!(
            compact_before(c, later),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn replaying_records_nothing() {
        let f = Fixture::new();
        let c = f.conn();
        let count = |c: &Connection| -> i64 {
            c.query_row("SELECT count(*) FROM history", [], |r| r.get(0))
                .unwrap()
        };
        let a = f.code("Alpha", None);
        let before = count(c);
        undo(c).unwrap().unwrap();
        redo(c, None).unwrap().unwrap();
        assert_eq!(count(c), before, "undo and redo are not new operations");
        assert!(codes::get(c, &a).is_ok());
        assert!(!replaying(c), "the flag is always put back");

        // The flag survives an error inside the replay.
        let err = with_replay(c, |_| -> Result<()> {
            Err(AppError::Validation("boom".into()))
        });
        assert!(err.is_err());
        assert!(!replaying(c));
    }

    #[test]
    fn undo_over_an_entry_from_before_history_fails_cleanly() {
        let f = Fixture::new();
        let c = f.conn();
        f.code("Alpha", None);
        // What the migration leaves behind: readable, no payloads.
        c.execute(
            "UPDATE history SET forward_json = NULL, inverse_json = NULL",
            [],
        )
        .unwrap();
        let state = dump_state(c);
        assert!(matches!(undo(c), Err(AppError::Validation(_))));
        assert_eq!(dump_state(c), state, "a refused undo changes nothing");
        assert!(
            head(c).unwrap().is_some(),
            "and leaves the head where it was"
        );
        let entries = crate::db::activity::list(c, &ActivityFilter::default()).unwrap();
        assert!(entries.entries.iter().all(|e| !e.undoable));
    }

    #[test]
    fn checkout_refuses_a_path_through_a_step_that_cannot_be_replayed() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        let first = head(c).unwrap().unwrap();
        codes::update(
            c,
            &a,
            CodePatch {
                name: Some("One".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let second = head(c).unwrap().unwrap();
        c.execute(
            "UPDATE history SET forward_json = NULL, inverse_json = NULL WHERE id = ?1",
            [second],
        )
        .unwrap();
        let state = dump_state(c);
        checkout(c, first).unwrap_err();
        assert_eq!(dump_state(c), state);
        assert_eq!(head(c).unwrap(), Some(second));
    }

    #[test]
    fn undo_at_the_root_and_redo_at_a_leaf_do_nothing() {
        let p = OpenProject::in_memory("t").unwrap();
        let c = &p.conn;
        assert!(undo(c).unwrap().is_none());
        assert!(redo(c, None).unwrap().is_none());
        codes::tests::mk(c, "Alpha", None);
        assert!(redo(c, None).unwrap().is_none());
        undo(c).unwrap().unwrap();
        assert!(undo(c).unwrap().is_none());
    }

    #[test]
    fn the_head_and_the_tree_survive_closing_the_project() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("h.misket");
        let code_id;
        let head_id;
        {
            let p = OpenProject::create(&path, "H", "test").unwrap();
            let a = codes::tests::mk(&p.conn, "Alpha", None);
            code_id = a.id.clone();
            codes::update(
                &p.conn,
                &a.id,
                CodePatch {
                    name: Some("Renamed".into()),
                    ..Default::default()
                },
            )
            .unwrap();
            head_id = head(&p.conn).unwrap().unwrap();
        }
        let p = OpenProject::open(&path).unwrap();
        assert_eq!(head(&p.conn).unwrap(), Some(head_id));
        // The inverse is data in the file, so it still works a session later.
        undo(&p.conn).unwrap().unwrap();
        assert_eq!(codes::get(&p.conn, &code_id).unwrap().name, "Alpha");
        assert_eq!(tree(&p.conn).unwrap().len(), 2);
    }

    #[test]
    fn redo_can_be_pointed_at_a_particular_branch() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        let fork = head(c).unwrap().unwrap();
        codes::update(
            c,
            &a,
            CodePatch {
                name: Some("One".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let left = head(c).unwrap().unwrap();
        undo(c).unwrap();
        codes::update(
            c,
            &a,
            CodePatch {
                name: Some("Two".into()),
                ..Default::default()
            },
        )
        .unwrap();
        undo(c).unwrap();
        assert_eq!(head(c).unwrap(), Some(fork));

        redo(c, Some(left)).unwrap().unwrap();
        assert_eq!(codes::get(c, &a).unwrap().name, "One");
        // And it becomes the branch a plain redo follows from now on.
        undo(c).unwrap();
        assert_eq!(redo(c, None).unwrap().unwrap().id, left);
        // A node that is not a child of the head is refused.
        assert!(matches!(redo(c, Some(fork)), Err(AppError::Validation(_))));
    }
}
