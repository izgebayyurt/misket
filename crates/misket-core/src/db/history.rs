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

use super::{codes, excerpts, util};
use crate::error::{AppError, Result};
use crate::models::{
    ChildrenStrategy, CodePatch, CodeTreeSnapshot, CompactReport, ExcerptSnapshot, HistoryNode,
    HistoryNodeSummary, Memo, TagRow,
};

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
                for r in reparent {
                    conn.execute(
                        "UPDATE codes SET parent_id = ?2, sort_order = ?3, updated_at = ?4
                         WHERE id = ?1",
                        params![r.code_id, r.parent_id, r.sort_order, r.updated_at],
                    )?;
                }
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
            CodeOp::Delete { code_id, strategy } => {
                codes::delete(conn, code_id, *strategy).map(|_| ())
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
            } => codes::merge(conn, source_id, target_id).map(|_| ()),
        }
    }
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
