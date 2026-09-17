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

use super::{activity, codes, documents, excerpts, framework, transcripts, util};
use crate::error::{AppError, Result};
use crate::models::{
    ChildrenStrategy, CodePatch, CodeTreeSnapshot, Coder, CompactReport, DescriptorField,
    DocumentSnapshot, ExcerptSnapshot, FrameworkMatrixWithCells, HistoryNode, HistoryNodeDetail,
    HistoryNodeSummary, HistoryRef, HistoryStepMember, Memo, SavedFilter, SetWithMembers,
    SyncPoint, TagRow,
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

// ------------------------------------------------------- the local coder

/// Remember which coder this connection writes as, for the rest of its life.
///
/// A `TEMP` table, like the actor name: per connection, outside the database
/// file, so two people opening the same project never see each other's id.
/// [`crate::db::coders::ensure_local`] sets it; the domain functions read it
/// with [`local_coder`] rather than taking a parameter each.
pub fn set_local_coder(conn: &Connection, coder_id: &str) -> Result<()> {
    conn.execute_batch("CREATE TEMP TABLE IF NOT EXISTS local_coder (id TEXT NOT NULL)")?;
    conn.execute("DELETE FROM temp.local_coder", [])?;
    conn.execute(
        "INSERT INTO temp.local_coder (id) VALUES (?1)",
        [coder_id.trim()],
    )?;
    Ok(())
}

/// The id [`set_local_coder`] stored on this connection, or `""` when none
/// was set — a test, or any code path that opens a project without the
/// desktop app. An empty coder is written as an empty string, which is
/// exactly what a pre-schema-11 row holds, and
/// [`crate::db::coders::backfill`] claims those for whoever opens next.
pub fn local_coder(conn: &Connection) -> String {
    conn.query_row("SELECT id FROM temp.local_coder LIMIT 1", [], |r| {
        r.get::<_, String>(0)
    })
    .unwrap_or_default()
}

// ------------------------------------------------- per-connection state

/// Two things that are true of a connection rather than of the project: is it
/// replaying a node right now, and is it in the middle of a compound step.
///
/// A `TEMP` table, like the actor: per connection, never written to the file,
/// and always reset even if what it guards fails.
const STATE_DDL: &str = "CREATE TEMP TABLE IF NOT EXISTS history_state (
        replaying     INTEGER NOT NULL DEFAULT 0,
        group_depth   INTEGER NOT NULL DEFAULT 0,
        group_id      INTEGER NULL,
        group_summary TEXT NOT NULL DEFAULT ''
     )";

fn ensure_state(conn: &Connection) -> Result<()> {
    conn.execute_batch(STATE_DDL)?;
    conn.execute(
        "INSERT INTO temp.history_state (replaying) SELECT 0
           WHERE NOT EXISTS (SELECT 1 FROM temp.history_state)",
        [],
    )?;
    Ok(())
}

/// One column of the state row, or its zero value when there is no row yet.
fn state_i64(conn: &Connection, column: &str) -> i64 {
    conn.query_row(
        &format!("SELECT COALESCE({column}, 0) FROM temp.history_state LIMIT 1"),
        [],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0)
}

/// Whether this connection is replaying a node right now.
pub fn replaying(conn: &Connection) -> bool {
    state_i64(conn, "replaying") != 0
}

fn set_replaying(conn: &Connection, on: bool) -> Result<()> {
    ensure_state(conn)?;
    conn.execute(
        "UPDATE temp.history_state SET replaying = ?1",
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

// ----------------------------------------------------------- compound steps

/// Start a compound step. Every node recorded until the matching
/// [`end_group`] joins one group, which [`undo`], [`redo`] and [`checkout`]
/// move over as a single step and [`tree`] draws as a single node labelled
/// `summary`.
///
/// Each write still gets its own node, with its own exact inverse and its own
/// line in the activity feed; the group only says they belong together.
/// Nested calls join the group already open, so an operation that groups its
/// own writes stays correct when a bigger one calls it.
pub fn begin_group(conn: &Connection, summary: &str) -> Result<()> {
    ensure_state(conn)?;
    if state_i64(conn, "group_depth") == 0 {
        conn.execute(
            "UPDATE temp.history_state
                SET group_depth = 1, group_id = NULL, group_summary = ?1",
            [summary],
        )?;
    } else {
        conn.execute(
            "UPDATE temp.history_state SET group_depth = group_depth + 1",
            [],
        )?;
    }
    Ok(())
}

/// Close the group [`begin_group`] opened. Closing one that was never opened
/// is harmless, so a frontend whose import failed half-way can always call it.
pub fn end_group(conn: &Connection) -> Result<()> {
    ensure_state(conn)?;
    if state_i64(conn, "group_depth") <= 1 {
        conn.execute(
            "UPDATE temp.history_state
                SET group_depth = 0, group_id = NULL, group_summary = ''",
            [],
        )?;
    } else {
        conn.execute(
            "UPDATE temp.history_state SET group_depth = group_depth - 1",
            [],
        )?;
    }
    Ok(())
}

/// Rename the open group, for an operation that only knows what it did once
/// it has done it ("Imported a codebook: 12 codes created, 3 matched").
pub fn relabel_group(conn: &Connection, summary: &str) -> Result<()> {
    ensure_state(conn)?;
    if state_i64(conn, "group_depth") == 0 {
        return Ok(());
    }
    conn.execute(
        "UPDATE temp.history_state SET group_summary = ?1",
        [summary],
    )?;
    conn.execute(
        "UPDATE history SET group_summary = ?1
          WHERE id = (SELECT group_id FROM temp.history_state)",
        [summary],
    )?;
    Ok(())
}

/// [`begin_group`] and [`end_group`] around `f`, closed even when it fails.
pub fn group<T>(
    conn: &Connection,
    summary: &str,
    f: impl FnOnce(&Connection) -> Result<T>,
) -> Result<T> {
    begin_group(conn, summary)?;
    let out = f(conn);
    end_group(conn)?;
    out
}

/// The ids of every node in `group_id`, oldest first.
fn group_members(conn: &Connection, group_id: i64) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare("SELECT id FROM history WHERE group_id = ?1 ORDER BY id")?;
    let ids = stmt.query_map([group_id], |r| r.get(0))?;
    Ok(ids.collect::<rusqlite::Result<_>>()?)
}

/// The whole step `id` belongs to, oldest first: its group, or just itself.
fn step_of(conn: &Connection, id: i64) -> Result<Vec<i64>> {
    Ok(match get(conn, id)?.group_id {
        Some(g) => group_members(conn, g)?,
        None => vec![id],
    })
}

/// The node a step is shown as: its first, wearing the group's summary.
fn step_label(conn: &Connection, members: &[i64]) -> Result<HistoryNode> {
    let mut node = get(conn, *members.first().unwrap_or(&0))?;
    if let Some(summary) = node.group_summary.clone() {
        node.summary = summary;
    }
    Ok(node)
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
    let in_group = state_i64(conn, "group_depth") > 0;
    // NULL until the first node of a group has an id to name it by.
    let group_id: Option<i64> = if in_group {
        conn.query_row("SELECT group_id FROM temp.history_state LIMIT 1", [], |r| {
            r.get(0)
        })
        .unwrap_or(None)
    } else {
        None
    };
    conn.execute(
        "INSERT INTO history (parent_id, at, actor, coder_id, kind, target_kind, target_id,
                              summary, detail_json, forward_json, inverse_json, group_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            parent,
            util::now(),
            actor,
            local_coder(conn),
            kind,
            target_kind,
            target_id,
            summary,
            detail.to_string(),
            forward.as_ref().map(Value::to_string),
            inverse.as_ref().map(Value::to_string),
            group_id,
        ],
    )?;
    let id = conn.last_insert_rowid();
    if in_group && group_id.is_none() {
        // This node leads the group, and lends it both its id and the label
        // the history view shows in place of the steps inside it.
        let summary: String = conn
            .query_row(
                "SELECT group_summary FROM temp.history_state LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap_or_default();
        conn.execute(
            "UPDATE history SET group_id = ?1, group_summary = ?2 WHERE id = ?1",
            params![id, summary],
        )?;
        conn.execute("UPDATE temp.history_state SET group_id = ?1", [id])?;
    }
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
     summary, detail_json, forward_json, inverse_json, branch_name, preferred_child,
     group_id, group_summary, coder_id";

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
        group_id: r.get(13)?,
        group_summary: r.get(14)?,
        coder_id: r.get(15)?,
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

/// A step whose effect is carried by another node of the same group — the
/// first half of a merge or a split, which the second half already undoes in
/// one go. Replaying it does nothing, in either direction.
///
/// `"linked"` is the name schema 8 wrote before groups existed, and is still
/// read so a project from that build keeps undoing.
pub fn noop() -> Value {
    json!({ "op": "noop" })
}

fn is_noop(payload: &Value) -> bool {
    matches!(
        payload.get("op").and_then(Value::as_str),
        Some("noop") | Some("linked")
    )
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

/// Everything that happens to a document. `Restore` is the inverse of a
/// delete *and* the forward of an import: both put the row back with its
/// original id, from the snapshot in the payload and the bytes in the node's
/// blobs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum DocumentOp {
    Restore {
        snapshot: Box<DocumentSnapshot>,
    },
    Drop {
        document_id: String,
    },
    Rename {
        document_id: String,
        name: String,
        updated_at: String,
    },
    /// The whole order, so replaying lands every document where it was.
    Reorder {
        ids: Vec<String>,
    },
}

impl DocumentOp {
    /// `node_id` is where the text and image bytes are: a payload carries the
    /// shape of a document, `history_blobs` carries its weight.
    fn run(&self, conn: &Connection, node_id: i64) -> Result<()> {
        match self {
            DocumentOp::Restore { snapshot } => {
                let text =
                    blob(conn, node_id, "text")?.map(|b| String::from_utf8_lossy(&b).into_owned());
                let media = blob(conn, node_id, "media")?;
                documents::restore(conn, snapshot, text.as_deref(), media.as_deref())?;
                Ok(())
            }
            DocumentOp::Drop { document_id } => {
                conn.execute("DELETE FROM documents WHERE id = ?1", [document_id])?;
                Ok(())
            }
            DocumentOp::Rename {
                document_id,
                name,
                updated_at,
            } => {
                conn.execute(
                    "UPDATE documents SET name = ?2, updated_at = ?3 WHERE id = ?1",
                    params![document_id, name, updated_at],
                )?;
                Ok(())
            }
            DocumentOp::Reorder { ids } => {
                for (i, id) in ids.iter().enumerate() {
                    conn.execute(
                        "UPDATE documents SET sort_order = ?2 WHERE id = ?1",
                        params![id, i as i64],
                    )?;
                }
                Ok(())
            }
        }
    }
}

/// Descriptor writes. A field and the values documents have for it move
/// together: deleting a field takes its values, and changing its kind drops
/// the ones the new kind cannot hold — so both directions carry them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum DescriptorOp {
    /// Write the field row as given (id and timestamps included) and, when
    /// `values` is present, replace every value stored for it.
    Field {
        field: Box<DescriptorField>,
        /// `(documentId, value)`; absent means "leave the values alone".
        #[serde(default)]
        values: Option<Vec<(String, String)>>,
        /// Every field id in order, because deleting one renumbers the rest.
        #[serde(default)]
        order: Vec<String>,
    },
    DropField {
        field_id: String,
        #[serde(default)]
        order: Vec<String>,
    },
    ReorderFields {
        ids: Vec<String>,
    },
    SetValue {
        document_id: String,
        field_id: String,
        /// `None` clears it.
        value: Option<String>,
    },
}

impl DescriptorOp {
    fn run(&self, conn: &Connection) -> Result<()> {
        match self {
            DescriptorOp::Field {
                field,
                values,
                order,
            } => {
                let options_json = if field.kind == "choice" {
                    Some(serde_json::to_string(&field.options)?)
                } else {
                    None
                };
                conn.execute(
                    "INSERT INTO descriptor_fields
                       (id, name, kind, options_json, sort_order, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(id) DO UPDATE SET
                       name = excluded.name, kind = excluded.kind,
                       options_json = excluded.options_json,
                       sort_order = excluded.sort_order, updated_at = excluded.updated_at",
                    params![
                        field.id,
                        field.name,
                        field.kind,
                        options_json,
                        field.sort_order,
                        field.created_at,
                        field.updated_at
                    ],
                )?;
                if let Some(values) = values {
                    conn.execute(
                        "DELETE FROM descriptor_values WHERE field_id = ?1",
                        [&field.id],
                    )?;
                    for (document_id, value) in values {
                        // A document deleted since simply keeps no value.
                        conn.execute(
                            "INSERT OR IGNORE INTO descriptor_values (document_id, field_id, value)
                             SELECT id, ?2, ?3 FROM documents WHERE id = ?1",
                            params![document_id, field.id, value],
                        )?;
                    }
                }
                place_fields(conn, order)
            }
            DescriptorOp::DropField { field_id, order } => {
                conn.execute("DELETE FROM descriptor_fields WHERE id = ?1", [field_id])?;
                place_fields(conn, order)
            }
            DescriptorOp::ReorderFields { ids } => place_fields(conn, ids),
            DescriptorOp::SetValue {
                document_id,
                field_id,
                value,
            } => {
                match value {
                    Some(v) => conn.execute(
                        "INSERT INTO descriptor_values (document_id, field_id, value)
                         VALUES (?1, ?2, ?3)
                         ON CONFLICT(document_id, field_id) DO UPDATE SET value = excluded.value",
                        params![document_id, field_id, v],
                    )?,
                    None => conn.execute(
                        "DELETE FROM descriptor_values WHERE document_id = ?1 AND field_id = ?2",
                        params![document_id, field_id],
                    )?,
                };
                Ok(())
            }
        }
    }
}

/// Put the descriptor fields back in this order, by index.
fn place_fields(conn: &Connection, ids: &[String]) -> Result<()> {
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE descriptor_fields SET sort_order = ?2 WHERE id = ?1",
            params![id, i as i64],
        )?;
    }
    Ok(())
}

/// Sets and saved filters. Every one of these puts back a whole row, with
/// the id it had, so a filter or an open browser that names a set keeps
/// working across an undo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum SetOp {
    Restore {
        set: Box<SetWithMembers>,
    },
    Drop {
        set_id: String,
    },
    Rename {
        set_id: String,
        name: String,
        updated_at: String,
    },
    /// The whole membership, so one payload covers adding one member,
    /// removing one, and replacing the lot.
    Members {
        set_id: String,
        member_ids: Vec<String>,
        updated_at: String,
    },
    RestoreFilter {
        filter: Box<SavedFilter>,
    },
    DropFilter {
        filter_id: String,
    },
}

impl SetOp {
    fn run(&self, conn: &Connection) -> Result<()> {
        match self {
            SetOp::Restore { set } => {
                let s = &set.set;
                conn.execute(
                    "INSERT INTO sets (id, kind, name, sort_order, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(id) DO UPDATE SET
                       name = excluded.name, sort_order = excluded.sort_order,
                       updated_at = excluded.updated_at",
                    params![
                        s.id,
                        s.kind,
                        s.name,
                        s.sort_order,
                        s.created_at,
                        s.updated_at
                    ],
                )?;
                write_members(conn, &s.id, &set.member_ids)
            }
            SetOp::Drop { set_id } => {
                conn.execute("DELETE FROM sets WHERE id = ?1", [set_id])?;
                Ok(())
            }
            SetOp::Rename {
                set_id,
                name,
                updated_at,
            } => {
                conn.execute(
                    "UPDATE sets SET name = ?2, updated_at = ?3 WHERE id = ?1",
                    params![set_id, name, updated_at],
                )?;
                Ok(())
            }
            SetOp::Members {
                set_id,
                member_ids,
                updated_at,
            } => {
                write_members(conn, set_id, member_ids)?;
                conn.execute(
                    "UPDATE sets SET updated_at = ?2 WHERE id = ?1",
                    params![set_id, updated_at],
                )?;
                Ok(())
            }
            SetOp::RestoreFilter { filter } => {
                let f = &filter;
                conn.execute(
                    "INSERT INTO saved_filters (id, name, filter_json, sort_order, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(id) DO UPDATE SET
                       name = excluded.name, filter_json = excluded.filter_json,
                       sort_order = excluded.sort_order, updated_at = excluded.updated_at",
                    params![
                        f.id,
                        f.name,
                        serde_json::to_string(&f.filter)?,
                        f.sort_order,
                        f.created_at,
                        f.updated_at
                    ],
                )?;
                Ok(())
            }
            SetOp::DropFilter { filter_id } => {
                conn.execute("DELETE FROM saved_filters WHERE id = ?1", [filter_id])?;
                Ok(())
            }
        }
    }
}

/// Replace a set's membership. A member whose code or document has been
/// deleted since is left out rather than resurrected as a dangling id.
fn write_members(conn: &Connection, set_id: &str, member_ids: &[String]) -> Result<()> {
    conn.execute("DELETE FROM set_members WHERE set_id = ?1", [set_id])?;
    for m in member_ids {
        conn.execute(
            "INSERT OR IGNORE INTO set_members (set_id, member_id)
             SELECT ?1, ?2
              WHERE EXISTS (SELECT 1 FROM codes WHERE id = ?2)
                 OR EXISTS (SELECT 1 FROM documents WHERE id = ?2)",
            params![set_id, m],
        )?;
    }
    Ok(())
}

/// Framework matrices. A matrix is a configuration plus a grid of written
/// summaries; `Restore` puts both back under the original id, so an open grid
/// keeps working across an undo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum FrameworkOp {
    Restore {
        saved: Box<FrameworkMatrixWithCells>,
    },
    Drop {
        matrix_id: String,
    },
    /// The whole configuration, so undoing an edit is the same call the other
    /// way round.
    Configure {
        matrix_id: String,
        input: Box<crate::models::FrameworkMatrixInput>,
        updated_at: String,
    },
    Cell {
        matrix_id: String,
        row_key: String,
        code_id: String,
        /// Empty deletes the cell, as writing an empty summary does.
        summary: String,
        /// When the cell last changed, so replaying restores the row rather
        /// than stamping it with the moment of the undo.
        #[serde(default)]
        updated_at: String,
    },
}

impl FrameworkOp {
    fn run(&self, conn: &Connection) -> Result<()> {
        match self {
            FrameworkOp::Restore { saved } => {
                framework::restore_matrix(conn, saved)?;
                Ok(())
            }
            FrameworkOp::Drop { matrix_id } => {
                conn.execute("DELETE FROM framework_matrices WHERE id = ?1", [matrix_id])?;
                Ok(())
            }
            FrameworkOp::Configure {
                matrix_id,
                input,
                updated_at,
            } => {
                framework::update_matrix(conn, matrix_id, input)?;
                conn.execute(
                    "UPDATE framework_matrices SET updated_at = ?2 WHERE id = ?1",
                    params![matrix_id, updated_at],
                )?;
                Ok(())
            }
            FrameworkOp::Cell {
                matrix_id,
                row_key,
                code_id,
                summary,
                updated_at,
            } => {
                framework::set_cell_summary(conn, matrix_id, row_key, code_id, summary)?;
                conn.execute(
                    "UPDATE framework_cells SET updated_at = ?4
                      WHERE matrix_id = ?1 AND row_key = ?2 AND code_id = ?3",
                    params![matrix_id, row_key, code_id, updated_at],
                )?;
                Ok(())
            }
        }
    }
}

/// Project-wide settings that live in `project_meta`: the project's name, the
/// custom stop-word list. One key, one value, both directions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum ProjectOp {
    SetMeta { key: String, value: Option<String> },
}

impl ProjectOp {
    fn run(&self, conn: &Connection) -> Result<()> {
        match self {
            ProjectOp::SetMeta { key, value } => {
                match value {
                    Some(v) => conn.execute(
                        "INSERT INTO project_meta (key, value) VALUES (?1, ?2)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        params![key, v],
                    )?,
                    None => conn.execute("DELETE FROM project_meta WHERE key = ?1", [key])?,
                };
                Ok(())
            }
        }
    }
}

/// Memo writes: `restore` upserts a whole row, so it covers create, edit and
/// undelete alike.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MemoChange {
    pub delete: Vec<String>,
    pub restore: Vec<Memo>,
}

/// The bookkeeping half of "pull from another copy" (`db::merge`): the coder
/// rows the pull brought over and the sync point it left behind.
///
/// Like [`ExcerptChange`], one shape serves both directions — the forward
/// writes the rows and the inverse writes back whatever was there before, or
/// deletes what was not there at all. The rows the pull *merges* are not in
/// here: each of those is an ordinary `document.imported`, `code.created` or
/// `bulk.codes_added` node inside the same group, which is what makes a whole
/// pull undoable without a single line of special-case undo.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PullChange {
    /// Coder ids to remove: the ones this pull introduced.
    pub drop_coders: Vec<String>,
    /// Whole `coders` rows to write, id and birthday included.
    pub coders: Vec<Coder>,
    /// `(otherProjectId, otherCoderId)` sync points to remove.
    pub drop_sync_points: Vec<(String, String)>,
    /// Whole `sync_points` rows to write.
    pub sync_points: Vec<SyncPoint>,
}

impl PullChange {
    fn run(&self, conn: &Connection) -> Result<()> {
        for id in &self.drop_coders {
            conn.execute("DELETE FROM coders WHERE id = ?1", [id])?;
        }
        for c in &self.coders {
            conn.execute(
                "INSERT INTO coders (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name, color = excluded.color,
                   created_at = excluded.created_at",
                params![c.id, c.name, c.color, c.created_at],
            )?;
        }
        for (project_id, coder_id) in &self.drop_sync_points {
            conn.execute(
                "DELETE FROM sync_points WHERE other_project_id = ?1 AND other_coder_id = ?2",
                params![project_id, coder_id],
            )?;
        }
        for p in &self.sync_points {
            conn.execute(
                "INSERT INTO sync_points
                   (other_project_id, other_coder_id, at, our_node_id, their_node_id, base_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(other_project_id, other_coder_id) DO UPDATE SET
                   at = excluded.at, our_node_id = excluded.our_node_id,
                   their_node_id = excluded.their_node_id, base_json = excluded.base_json",
                params![
                    p.other_project_id,
                    p.other_coder_id,
                    p.at,
                    p.our_node_id,
                    p.their_node_id,
                    p.base_json
                ],
            )?;
        }
        Ok(())
    }
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
                        "DELETE FROM excerpt_codes
                          WHERE excerpt_id = ?1 AND code_id = ?2 AND coder_id = ?3",
                        params![t.excerpt_id, t.code_id, tag_coder(conn, t)],
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
/// Which coder a replayed tag belongs to. A payload written before schema 11
/// carries no coder; those rows were the local coder's (a project file only
/// ever had one person in it), and the backfill already claimed them, so
/// replaying one names the local coder too.
pub(super) fn tag_coder(conn: &Connection, tag: &TagRow) -> String {
    if tag.coder_id.is_empty() {
        local_coder(conn)
    } else {
        tag.coder_id.clone()
    }
}

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
                "DELETE FROM excerpt_codes
                  WHERE excerpt_id = ?1 AND code_id = ?2 AND coder_id = ?3",
                params![t.excerpt_id, t.code_id, tag_coder(conn, t)],
            )?;
        }
        for t in &self.add_tags {
            // A code deleted in the meantime simply keeps its tag off.
            conn.execute(
                "INSERT OR IGNORE INTO excerpt_codes (excerpt_id, code_id, coder_id, created_at)
                 SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM codes WHERE id = ?2)",
                params![t.excerpt_id, t.code_id, tag_coder(conn, t), t.created_at],
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
                                    coder_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                   document_id = excluded.document_id, code_id = excluded.code_id,
                   excerpt_id = excluded.excerpt_id, title = excluded.title,
                   body = excluded.body, coder_id = excluded.coder_id,
                   updated_at = excluded.updated_at",
                params![
                    m.id,
                    m.document_id,
                    m.code_id,
                    m.excerpt_id,
                    m.title,
                    m.body,
                    if m.coder_id.is_empty() {
                        local_coder(conn)
                    } else {
                        m.coder_id.clone()
                    },
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
fn apply(conn: &Connection, node_id: i64, kind: &str, payload: &Value) -> Result<()> {
    if is_noop(payload) {
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
        "document.imported" | "document.deleted" | "document.renamed" | "document.reordered" => {
            serde_json::from_value::<DocumentOp>(payload.clone())?.run(conn, node_id)
        }
        "project.renamed" | "analysis.stop_words_set" => {
            serde_json::from_value::<ProjectOp>(payload.clone())?.run(conn)
        }
        "project.pulled" | "project.sync_point" | "project.refi_imported" => {
            serde_json::from_value::<PullChange>(payload.clone())?.run(conn)
        }
        "framework.matrix_created"
        | "framework.matrix_updated"
        | "framework.matrix_deleted"
        | "framework.cell_set" => serde_json::from_value::<FrameworkOp>(payload.clone())?.run(conn),
        "set.created"
        | "set.renamed"
        | "set.deleted"
        | "set.members_changed"
        | "filter.saved"
        | "filter.deleted" => serde_json::from_value::<SetOp>(payload.clone())?.run(conn),
        "descriptor.field_created"
        | "descriptor.field_updated"
        | "descriptor.field_deleted"
        | "descriptor.fields_reordered"
        | "descriptor.value_set" => {
            serde_json::from_value::<DescriptorOp>(payload.clone())?.run(conn)
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
    with_replay(conn, |conn| apply(conn, node.id, &node.kind, payload))
}

/// Undo one node.
pub fn apply_inverse(conn: &Connection, node: &HistoryNode) -> Result<()> {
    let payload = node.inverse.as_ref().ok_or_else(|| no_inverse(node))?;
    with_replay(conn, |conn| apply(conn, node.id, &node.kind, payload))
}

/// Why a node has nothing to undo. Every kind Misket records now writes an
/// inverse, so a missing one means the node is older than the undo tree —
/// copied from the activity log by the schema-8 migration — or is the root
/// [`compact_before`] made, whose past was deliberately thrown away.
fn no_inverse(node: &HistoryNode) -> AppError {
    AppError::Validation(if node.parent_id.is_none() {
        "Nothing more to undo: this is as far back as the project's history goes.".into()
    } else {
        "Nothing more to undo: earlier changes were recorded before history existed.".into()
    })
}

// ------------------------------------------------------------ walking

/// Take back the step at the head and move the head to its parent.
///
/// Returns the step that was undone, or `None` when the head is already
/// before the first node. A compound step (a merge, an import of several
/// files) comes off as one: every node of the group is inverted, newest
/// first, inside one transaction.
pub fn undo(conn: &Connection) -> Result<Option<HistoryNode>> {
    let Some(id) = head(conn)? else {
        return Ok(None);
    };
    let tx = util::tx(conn)?;
    // A group can only have been entered from its first node, so the head is
    // its last; guard anyway rather than invert steps that never ran.
    let members: Vec<i64> = step_of(&tx, id)?.into_iter().filter(|m| *m <= id).collect();
    let leader = get(&tx, *members.first().unwrap_or(&id))?;
    for m in members.iter().rev() {
        let node = get(&tx, *m)?;
        apply_inverse(&tx, &node)?;
    }
    set_head(&tx, leader.parent_id)?;
    let undone = step_label(&tx, &members)?;
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
/// redo followed last, else the newest. A compound step goes back on whole.
pub fn redo(conn: &Connection, child: Option<i64>) -> Result<Option<HistoryNode>> {
    let parent = head(conn)?;
    let tx = util::tx(conn)?;
    let Some(start) = next_child(&tx, parent, child)? else {
        return Ok(None);
    };
    let members: Vec<i64> = step_of(&tx, start)?
        .into_iter()
        .filter(|m| *m >= start)
        .collect();
    for m in &members {
        let node = get(&tx, *m)?;
        apply_forward(&tx, &node)?;
        prefer(&tx, node.parent_id, node.id)?;
    }
    set_head(&tx, members.last().copied())?;
    let redone = step_label(&tx, &members)?;
    tx.commit()?;
    Ok(Some(redone))
}

/// Move the project to the state at `node_id`, wherever it sits in the tree.
///
/// Walks up from the head to the lowest common ancestor applying inverses,
/// then down the other side applying forwards, in one transaction — so a
/// branch that turns out to be unreachable leaves the project untouched.
pub fn checkout(conn: &Connection, node_id: i64) -> Result<HistoryNode> {
    // Landing inside a compound step would leave the project half-way
    // through one operation, so a node in a group stands for the whole group.
    let members = step_of(conn, node_id)?;
    let node_id = members.last().copied().unwrap_or(node_id);
    let here = head(conn)?;
    if here == Some(node_id) {
        return step_label(conn, &members);
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
    let landed = step_label(&tx, &members)?;
    tx.commit()?;
    Ok(landed)
}

// ------------------------------------------------------------- branches

/// Name the current node, so the branch that grows from it can be found again.
pub fn fork_here(conn: &Connection, name: &str) -> Result<HistoryNode> {
    let id = head(conn)?.ok_or_else(|| {
        AppError::Validation("there is nothing to fork from yet: make a change first".into())
    })?;
    // The name belongs on the node the history view draws, which for a
    // compound step is the one that leads it.
    let id = step_of(conn, id)?.first().copied().unwrap_or(id);
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
///
/// A compound step collapses into the one node that leads it: it wears the
/// group's summary, reports how many writes it stands for in `step_count`,
/// and inherits the children of the group's last node, so the tree the view
/// draws has one node per user action.
pub fn tree(conn: &Connection) -> Result<Vec<HistoryNodeSummary>> {
    let head = head(conn)?;
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, at, actor, kind, summary, branch_name,
                inverse_json IS NOT NULL, group_id, group_summary, preferred_child, coder_id
         FROM history ORDER BY id",
    )?;
    /// id, parent, at, actor, kind, summary, branch name, undoable, group,
    /// group summary, preferred child, coder.
    type TreeRow = (
        i64,
        Option<i64>,
        String,
        String,
        String,
        String,
        Option<String>,
        bool,
        Option<i64>,
        Option<String>,
        Option<i64>,
        String,
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
                r.get(8)?,
                r.get(9)?,
                r.get(10)?,
                r.get(11)?,
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;

    // Every node stands for the step it belongs to: itself, or the node that
    // leads its group.
    let rep = |group: Option<i64>, id: i64| group.unwrap_or(id);
    let leader_of: HashMap<i64, i64> = rows
        .iter()
        .map(|(id, _, _, _, _, _, _, _, group, _, _, _)| (*id, rep(*group, *id)))
        .collect();

    let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
    for (id, parent, .., group, _, _, _) in &rows {
        let me = rep(*group, *id);
        let Some(parent) = parent else { continue };
        let parent = leader_of.get(parent).copied().unwrap_or(*parent);
        if parent == me {
            continue; // the next write of the same step
        }
        let kids = children.entry(parent).or_default();
        if !kids.contains(&me) {
            kids.push(me);
        }
    }

    let mut out: Vec<HistoryNodeSummary> = vec![];
    for (
        id,
        parent_id,
        at,
        actor,
        kind,
        summary,
        branch_name,
        undoable,
        group,
        group_summary,
        preferred_child,
        coder_id,
    ) in &rows
    {
        // Redo from a collapsed step continues from its last member, so the
        // step's preferred child is that member's, mapped to the step it leads.
        let preferred = preferred_child.map(|c| leader_of.get(&c).copied().unwrap_or(c));
        if rep(*group, *id) != *id {
            // Folded into the node that leads its group; its branch name and
            // its "cannot be undone" still count for the step as a whole.
            let step = out.last_mut().expect("a group is led by an earlier node");
            step.undoable &= *undoable;
            step.step_count += 1;
            if branch_name.is_some() {
                step.branch_name = branch_name.clone();
            }
            step.is_head |= head == Some(*id);
            step.preferred_child = preferred;
            continue;
        }
        out.push(HistoryNodeSummary {
            id: *id,
            parent_id: parent_id.map(|p| leader_of.get(&p).copied().unwrap_or(p)),
            at: at.clone(),
            actor: actor.clone(),
            coder_id: coder_id.clone(),
            kind: kind.clone(),
            summary: group_summary.clone().unwrap_or_else(|| summary.clone()),
            branch_name: branch_name.clone(),
            undoable: *undoable,
            is_head: head == Some(*id),
            preferred_child: preferred,
            step_count: 1,
            children: vec![],
        });
    }
    for node in &mut out {
        node.children = children.get(&node.id).cloned().unwrap_or_default();
    }
    Ok(out)
}

// ------------------------------------------------------ one step in detail

/// How a reference reads when it cannot be found.
///
/// Two different absences, and saying which is the whole point: a step *on
/// the way to where the project is* whose target is missing had it deleted
/// since, while a step the project has undone past, or one on another branch,
/// simply has not been applied — its excerpt is not there because that
/// coding is not in force, not because anyone threw it away.
const DELETED_SUFFIX: &str = "(since deleted)";
const UNAPPLIED_SUFFIX: &str = "(not in the project right now)";

fn missing(label: &str, applied: bool) -> String {
    let suffix = if applied {
        DELETED_SUFFIX
    } else {
        UNAPPLIED_SUFFIX
    };
    let label = label.trim();
    if label.is_empty() {
        suffix.to_string()
    } else {
        format!("{label} {suffix}")
    }
}

/// A string field of a `detail` payload, whether it was written plainly or as
/// an [`activity::change`] pair (then its `to` side: the value after the step).
fn detail_str(detail: &Value, key: &str) -> Option<String> {
    match detail.get(key)? {
        Value::String(s) => Some(s.clone()),
        Value::Object(o) => o.get("to")?.as_str().map(str::to_string),
        _ => None,
    }
}

fn detail_i64(detail: &Value, key: &str) -> Option<i64> {
    match detail.get(key)? {
        Value::Number(n) => n.as_i64(),
        Value::Object(o) => o.get("to")?.as_i64(),
        _ => None,
    }
}

/// A code's place in the codebook, `Parent > Child`, as it is now.
fn code_path(conn: &Connection, id: &str) -> Option<String> {
    let mut parts: Vec<String> = vec![];
    let mut cur = Some(id.to_string());
    // The codebook is a tree, but a corrupt parent chain must not hang here.
    for _ in 0..64 {
        let Some(this) = cur else { break };
        let row: Option<(String, Option<String>)> = conn
            .query_row(
                "SELECT name, parent_id FROM codes WHERE id = ?1",
                [&this],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .ok()
            .flatten();
        let Some((name, parent)) = row else { break };
        parts.push(name);
        cur = parent;
    }
    if parts.is_empty() {
        return None;
    }
    parts.reverse();
    Some(parts.join(" \u{203a} "))
}

/// Look one reference up. `recorded` is the name the step itself wrote down,
/// used when the target is no longer there.
fn resolve_ref(
    conn: &Connection,
    kind: &str,
    id: &str,
    recorded: Option<String>,
    detail: &Value,
    applied: bool,
) -> Option<HistoryRef> {
    let plain = |label: String, exists: bool| HistoryRef {
        kind: kind.to_string(),
        id: id.to_string(),
        label,
        exists,
        color: None,
        path: None,
        document_id: None,
        start_pos: None,
        end_pos: None,
    };
    match kind {
        "code" => {
            let row: Option<(String, String)> = conn
                .query_row("SELECT name, color FROM codes WHERE id = ?1", [id], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .optional()
                .ok()
                .flatten();
            Some(match row {
                Some((name, color)) => HistoryRef {
                    color: Some(color),
                    path: code_path(conn, id),
                    ..plain(name, true)
                },
                None => plain(
                    missing(&recorded.unwrap_or_else(|| "This code".into()), applied),
                    false,
                ),
            })
        }
        "document" => {
            let name: Option<String> = conn
                .query_row("SELECT name FROM documents WHERE id = ?1", [id], |r| {
                    r.get(0)
                })
                .optional()
                .ok()
                .flatten();
            Some(match name {
                Some(name) => plain(name, true),
                None => plain(
                    missing(&recorded.unwrap_or_else(|| "This document".into()), applied),
                    false,
                ),
            })
        }
        "memo" => {
            let row: Option<(String, String)> = conn
                .query_row("SELECT title, body FROM memos WHERE id = ?1", [id], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .optional()
                .ok()
                .flatten();
            Some(match row {
                Some((title, body)) => plain(
                    if title.trim().is_empty() {
                        activity::elide(&body, 60)
                    } else {
                        title
                    },
                    true,
                ),
                None => plain(
                    missing(&recorded.unwrap_or_else(|| "This memo".into()), applied),
                    false,
                ),
            })
        }
        "excerpt" => {
            type ExcerptRow = (String, Option<i64>, Option<i64>, Option<String>, String);
            let row: Option<ExcerptRow> = conn
                .query_row(
                    "SELECT document_id, start_pos, end_pos, snapshot, kind
                     FROM excerpts WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .optional()
                .ok()
                .flatten();
            Some(match row {
                Some((document_id, start_pos, end_pos, snapshot, kind_of)) => {
                    let label = match snapshot.as_deref() {
                        Some(text) if !text.trim().is_empty() => activity::elide(text, 240),
                        _ => format!("a {} excerpt", kind_of.replace('_', " ")),
                    };
                    HistoryRef {
                        document_id: Some(document_id),
                        start_pos,
                        end_pos,
                        ..plain(label, true)
                    }
                }
                // Gone, but the step wrote down where it was: enough to open
                // the document at the passage, if the document is still there.
                None => {
                    let start = detail_i64(detail, "startPos");
                    let end = detail_i64(detail, "endPos");
                    // The text it held, if the step recorded it; failing
                    // that, where in the document it was; failing that,
                    // nothing more than that it was an excerpt.
                    let what = recorded
                        .or_else(|| match (start, end) {
                            (Some(s), Some(e)) => Some(format!("the text at {s}\u{2013}{e}")),
                            _ => None,
                        })
                        .unwrap_or_else(|| "This excerpt".into());
                    HistoryRef {
                        document_id: detail_str(detail, "documentId"),
                        start_pos: start,
                        end_pos: end,
                        ..plain(missing(&what, applied), false)
                    }
                }
            })
        }
        // A set, a saved filter, a descriptor field, a framework matrix or
        // the project itself: nothing to open, so the panel shows the step's
        // own detail fields instead.
        _ => None,
    }
}

/// Every reference one node points at, its own target first.
fn node_refs(conn: &Connection, node: &HistoryNode, applied: bool) -> Vec<HistoryRef> {
    let detail = &node.detail;
    let mut out: Vec<HistoryRef> = vec![];
    fn push(out: &mut Vec<HistoryRef>, r: HistoryRef) {
        if !out.iter().any(|x| x.kind == r.kind && x.id == r.id) {
            out.push(r);
        }
    }

    if let Some(id) = node.target_id.as_deref() {
        let recorded = match node.target_kind.as_str() {
            "excerpt" => detail_str(detail, "snapshot"),
            "memo" => detail_str(detail, "title"),
            _ => detail_str(detail, "name"),
        };
        if let Some(r) = resolve_ref(conn, &node.target_kind, id, recorded, detail, applied) {
            push(&mut out, r);
        }
    }

    // The codes a coding step applied or took away, in the order recorded,
    // paired with the names they had at the time.
    let names = detail.get("codeNames").and_then(Value::as_array);
    if let Some(ids) = detail.get("codeIds").and_then(Value::as_array) {
        for (i, id) in ids.iter().filter_map(Value::as_str).enumerate() {
            let recorded = names
                .and_then(|n| n.get(i))
                .and_then(Value::as_str)
                .map(str::to_string);
            if let Some(r) = resolve_ref(conn, "code", id, recorded, detail, applied) {
                push(&mut out, r);
            }
        }
    }

    // The other side of a merge, a memo's own code, a moved code's new parent.
    for (key, name_key) in [
        ("codeId", "codeName"),
        ("targetId", "targetName"),
        ("sourceId", "sourceName"),
        ("parentId", "parentName"),
    ] {
        let about_a_code = node.target_kind == "code" || node.kind.starts_with("code.");
        if !about_a_code && key != "codeId" {
            continue;
        }
        if let Some(id) = detail_str(detail, key) {
            if let Some(r) = resolve_ref(
                conn,
                "code",
                &id,
                detail_str(detail, name_key),
                detail,
                applied,
            ) {
                push(&mut out, r);
            }
        }
    }

    // The document a coding, a memo or an import happened in.
    if let Some(id) = detail_str(detail, "documentId") {
        if let Some(r) = resolve_ref(
            conn,
            "document",
            &id,
            detail_str(detail, "documentName"),
            detail,
            applied,
        ) {
            push(&mut out, r);
        }
    }
    if let Some(id) = detail_str(detail, "excerptId") {
        if let Some(r) = resolve_ref(conn, "excerpt", &id, None, detail, applied) {
            push(&mut out, r);
        }
    }
    if let Some(id) = detail_str(detail, "memoId") {
        if let Some(r) = resolve_ref(
            conn,
            "memo",
            &id,
            detail_str(detail, "title"),
            detail,
            applied,
        ) {
            push(&mut out, r);
        }
    }
    out
}

/// One step of the history, as the view's detail panel shows it.
///
/// `id` may name any node of a compound step; the answer always describes the
/// whole step, led by its first node, with the members listed and every
/// member's references gathered. The references are resolved against the
/// project as it is *now*, which is the point: a step that coded an excerpt
/// someone has since deleted says so rather than offering a dead link.
pub fn node_detail(conn: &Connection, id: i64) -> Result<HistoryNodeDetail> {
    let member_ids = step_of(conn, id)?;
    let leader = member_ids.first().copied().unwrap_or(id);
    let node = get(conn, leader)?;
    let head = head(conn)?;
    // Is this step in force? It is exactly when the project sits at it or
    // below it: anything the project has undone past, and every step of a
    // branch it is not on, has not been applied.
    let applied = head.is_some_and(|h| descendants(conn, leader).is_ok_and(|d| d.contains(&h)));

    let mut undoable = true;
    let mut is_head = false;
    let mut members: Vec<HistoryStepMember> = vec![];
    let mut refs: Vec<HistoryRef> = vec![];
    for member_id in &member_ids {
        let member = get(conn, *member_id)?;
        undoable &= member.inverse.is_some();
        is_head |= head == Some(member.id);
        members.push(HistoryStepMember {
            id: member.id,
            kind: member.kind.clone(),
            summary: member.summary.clone(),
        });
        for r in node_refs(conn, &member, applied) {
            if !refs.iter().any(|x| x.kind == r.kind && x.id == r.id) {
                refs.push(r);
            }
        }
    }

    Ok(HistoryNodeDetail {
        id: node.id,
        parent_id: node.parent_id,
        at: node.at.clone(),
        actor: node.actor.clone(),
        coder_id: node.coder_id.clone(),
        kind: node.kind.clone(),
        target_kind: node.target_kind.clone(),
        target_id: node.target_id.clone(),
        summary: node
            .group_summary
            .clone()
            .unwrap_or_else(|| node.summary.clone()),
        detail: node.detail.clone(),
        branch_name: node.branch_name.clone(),
        undoable,
        is_head,
        applied,
        step_count: member_ids.len() as i64,
        refs,
        members: if member_ids.len() > 1 {
            members
        } else {
            vec![]
        },
    })
}

/// Throw away everything before `node_id`, making it a new root.
///
/// Everything that is not `node_id` or under it goes: the steps that led here
/// and any side branch left behind. Refuses while the project is somewhere
/// else in the tree, because that state would become unreachable.
pub fn compact_before(conn: &Connection, node_id: i64) -> Result<CompactReport> {
    let step = step_of(conn, node_id)?;
    let node_id = step.first().copied().unwrap_or(node_id);
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
    // The new root is where the project's past ends, so nothing replays it —
    // including the rest of its own step, whose bytes go too.
    for id in &step {
        tx.execute(
            "UPDATE history SET forward_json = NULL, inverse_json = NULL WHERE id = ?1",
            [id],
        )?;
        tx.execute("DELETE FROM history_blobs WHERE node_id = ?1", [id])?;
    }
    tx.execute(
        "UPDATE history SET parent_id = NULL WHERE id = ?1",
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
pub(crate) mod tests {
    use super::*;
    use crate::db::{
        bulk, codes, descriptors, documents, excerpts, framework, memos, sets, OpenProject,
    };
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
    pub(crate) fn dump_state(conn: &Connection) -> BTreeMap<String, Vec<String>> {
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
    pub(crate) fn assert_same(
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
        // A merge writes an entry per side, but they share a group, so it is
        // one step: a single undo after the redo brings the source back whole.
        assert!(codes::get(c, &source).is_err(), "the redo merged it away");
        let undone = undo(c).unwrap().unwrap();
        assert_eq!(
            undone.kind, "code.merged_into",
            "the step is named by its first write"
        );
        assert!(undone.group_id.is_some());
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
            excerpts::remove_code(c, &e, &b, None).unwrap();
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

    /// Undo has to give a coding back to whoever made it, not to whoever
    /// pressed Ctrl+Z. `dump_state` compares `excerpt_codes` column by
    /// column, so a coder lost on the way through a payload shows up here.
    #[test]
    fn round_trips_a_coding_made_by_another_coder() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        let b = f.code("Beta", None);
        crate::db::coders::ensure_local(c, "bob", "Bob", "#5CB85C").unwrap();
        let e = f.excerpt(0, 10, std::slice::from_ref(&a));

        assert_round_trip(c, "bob adds a code", |c| {
            excerpts::add_codes(c, &e, std::slice::from_ref(&b)).unwrap();
        });
        assert_eq!(
            coder_of(c, &e, &b),
            "bob",
            "the redo put Bob's name back on it"
        );

        // Ada comes to the same project file and agrees with Bob about Alpha.
        crate::db::coders::ensure_local(c, "ada", "Ada", "#D9534F").unwrap();
        assert_round_trip(c, "ada agrees", |c| {
            excerpts::add_codes(c, &e, std::slice::from_ref(&a)).unwrap();
        });
        let mut coders = coders_of(c, &e, &a);
        coders.sort();
        assert_eq!(coders, vec!["ada", "bob"]);

        // Ada undoing her own coding must not take Bob's with it.
        excerpts::remove_code(c, &e, &a, None).unwrap();
        assert_eq!(coders_of(c, &e, &a), vec!["bob"]);
        undo(c).unwrap().unwrap();
        let mut coders = coders_of(c, &e, &a);
        coders.sort();
        assert_eq!(coders, vec!["ada", "bob"]);

        // A code merge carries each coding across as its own coder's, and
        // undoing puts them back the same way.
        assert_round_trip(c, "merge", |c| {
            codes::merge(c, &b, &a).unwrap();
        });
        let mut coders = coders_of(c, &e, &a);
        coders.sort();
        assert_eq!(coders, vec!["ada", "bob"]);

        // And the node itself records who made it.
        let node = get(c, head(c).unwrap().unwrap()).unwrap();
        assert_eq!(node.coder_id, "ada");
        let step = tree(c).unwrap().into_iter().next_back().unwrap();
        assert_eq!(step.coder_id, "ada");
    }

    fn coders_of(conn: &Connection, excerpt_id: &str, code_id: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(
                "SELECT coder_id FROM excerpt_codes
                  WHERE excerpt_id = ?1 AND code_id = ?2 ORDER BY coder_id",
            )
            .unwrap();
        stmt.query_map(params![excerpt_id, code_id], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    fn coder_of(conn: &Connection, excerpt_id: &str, code_id: &str) -> String {
        coders_of(conn, excerpt_id, code_id).join(",")
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

    // --------------------------------------------------------- documents

    /// Importing a document is undoable, and redoing it brings the same id
    /// back — so an excerpt cut from it before the undo still points at it.
    #[test]
    fn round_trips_importing_a_text_and_an_image_document() {
        let p = OpenProject::in_memory("t").unwrap();
        let c = &p.conn;
        assert_round_trip(c, "import text", |c| {
            documents::create(c, documents::tests::new_doc("One two three four five.")).unwrap();
        });
        assert_round_trip(c, "import image", |c| {
            documents::create_image(c, documents::tests::new_image(b"\x89PNG bytes")).unwrap();
        });
        let ids: Vec<String> = documents::list(c)
            .unwrap()
            .into_iter()
            .map(|d| d.id)
            .collect();
        assert_eq!(ids.len(), 2);
        // The bytes came back with the image, not just the row.
        let image = ids
            .iter()
            .find(|id| documents::get_media(c, id).is_ok())
            .unwrap();
        assert_eq!(documents::get_media(c, image).unwrap().1, b"\x89PNG bytes");
    }

    /// Deleting a document takes its excerpts, memos, descriptor values, set
    /// memberships and framework summaries with it. Undo has to bring back
    /// every one of them, and the image's bytes.
    #[test]
    fn round_trips_deleting_a_document_with_everything_hanging_off_it() {
        let f = Fixture::new();
        let c = f.conn();
        let code = f.code("Alpha", None);
        let e = f.excerpt(0, 5, std::slice::from_ref(&code));
        memos::create(
            c,
            MemoTarget {
                excerpt_id: Some(e.clone()),
                ..Default::default()
            },
            "On the excerpt",
            "body",
        )
        .unwrap();
        memos::create(
            c,
            MemoTarget {
                document_id: Some(f.doc.clone()),
                ..Default::default()
            },
            "On the document",
            "body",
        )
        .unwrap();
        let field = descriptors::tests::mk_field(c, "Site", "choice", &["North"]);
        descriptors::set_value(c, &f.doc, &field.id, Some("North")).unwrap();
        sets::create_set(c, "document", "Wave 1", std::slice::from_ref(&f.doc), None).unwrap();
        c.execute_batch(&format!(
            "INSERT INTO framework_matrices (id, name, row_kind, created_at, updated_at)
               VALUES ('m', 'Wave 1', 'document', 't', 't');
             INSERT INTO framework_cells (matrix_id, row_key, code_id, summary, updated_at)
               VALUES ('m', '{}', '{code}', 'Said little.', 't');",
            f.doc
        ))
        .unwrap();

        assert_round_trip(c, "delete a text document", |c| {
            documents::delete(c, &f.doc).unwrap();
        });

        // And an image document, whose weight is in `history_blobs`.
        let image = documents::create_image(c, documents::tests::new_image(b"\x89PNG bytes"))
            .unwrap()
            .summary
            .id;
        excerpts::apply_codes(
            c,
            ApplyCodesInput {
                document_id: image.clone(),
                kind: Some("image_region".into()),
                geometry: Some(crate::models::Rect {
                    x: 0.1,
                    y: 0.1,
                    w: 0.4,
                    h: 0.4,
                }),
                code_ids: vec![code.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        assert_round_trip(c, "delete an image document", |c| {
            documents::delete(c, &image).unwrap();
        });
        // The round trip left it deleted; one more undo, and the pixels are
        // back byte for byte from `history_blobs`.
        undo(c).unwrap().unwrap();
        assert_eq!(documents::get_media(c, &image).unwrap().1, b"\x89PNG bytes");
        assert_eq!(excerpts::list_for_document(c, &image).unwrap().len(), 1);
    }

    #[test]
    fn round_trips_renaming_and_reordering_documents() {
        let f = Fixture::new();
        let c = f.conn();
        let b = documents::create(c, documents::tests::new_doc("Second document."))
            .unwrap()
            .summary
            .id;
        assert_round_trip(c, "rename", |c| {
            documents::rename(c, &f.doc, "Interview 7").unwrap();
        });
        assert_round_trip(c, "reorder", |c| {
            documents::reorder(c, &[b.clone(), f.doc.clone()]).unwrap();
        });
        // A reorder that changes nothing is not worth a step.
        let before = head(c).unwrap();
        documents::reorder(c, &[b.clone(), f.doc.clone()]).unwrap();
        assert_eq!(head(c).unwrap(), before);
    }

    /// Two files imported as one batch come back, and go away again, in one
    /// step — and compacting past them takes their stored text with them.
    #[test]
    fn an_import_of_two_files_is_one_step_and_its_bytes_are_compacted_away() {
        let p = OpenProject::in_memory("t").unwrap();
        let c = &p.conn;
        let blobs = |c: &Connection| -> i64 {
            c.query_row("SELECT count(*) FROM history_blobs", [], |r| r.get(0))
                .unwrap()
        };
        assert_round_trip(c, "import a batch", |c| {
            group(c, "Imported 2 documents", |c| {
                let mut a = documents::tests::new_doc("The first file.");
                a.name = "A".into();
                documents::create(c, a)?;
                let mut b = documents::tests::new_doc("The second file.");
                b.name = "B".into();
                documents::create(c, b)?;
                Ok(())
            })
            .unwrap();
        });
        assert_eq!(documents::list(c).unwrap().len(), 2, "both are back");
        assert_eq!(blobs(c), 2, "one stored text per file");

        // One node in the tree, two writes behind it.
        let tree = tree(c).unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].summary, "Imported 2 documents");
        assert_eq!(tree[0].step_count, 2);

        // Compacting onto the import makes it the root: it can no longer be
        // undone, so the text it was holding for that is dropped too.
        let state = dump_state(c);
        let report = compact_before(c, tree[0].id).unwrap();
        assert_eq!(report.dropped_nodes, 0);
        assert_same(&state, &dump_state(c), "compacting changes no data");
        assert_eq!(blobs(c), 0, "the stored text went with the payloads");
        assert!(matches!(undo(c), Err(AppError::Validation(_))));
    }

    /// Deleting the node a blob belongs to takes the blob with it.
    #[test]
    fn compacting_drops_the_blobs_of_the_nodes_it_drops() {
        let p = OpenProject::in_memory("t").unwrap();
        let c = &p.conn;
        documents::create(c, documents::tests::new_doc("The first file.")).unwrap();
        let mut second = documents::tests::new_doc("The second file.");
        second.name = "B".into();
        documents::create(c, second).unwrap();
        let keep = head(c).unwrap().unwrap();
        assert_eq!(
            c.query_row("SELECT count(*) FROM history_blobs", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        compact_before(c, keep).unwrap();
        // The first import's node is gone, and so is the text it carried;
        // the kept node is the new root, so its own bytes go too.
        assert_eq!(
            c.query_row("SELECT count(*) FROM history_blobs", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    // ------------------------------------------------------- descriptors

    #[test]
    fn round_trips_every_descriptor_write() {
        let f = Fixture::new();
        let c = f.conn();
        assert_round_trip(c, "create a field", |c| {
            descriptors::tests::mk_field(c, "Site", "choice", &["North", "South"]);
        });
        let site = descriptors::list_fields(c).unwrap()[0].id.clone();
        assert_round_trip(c, "set a value", |c| {
            descriptors::set_value(c, &f.doc, &site, Some("north")).unwrap();
        });
        assert_round_trip(c, "change a value", |c| {
            descriptors::set_value(c, &f.doc, &site, Some("South")).unwrap();
        });
        assert_round_trip(c, "clear a value", |c| {
            descriptors::set_value(c, &f.doc, &site, None).unwrap();
        });
        descriptors::set_value(c, &f.doc, &site, Some("North")).unwrap();
        assert_round_trip(c, "rename a field", |c| {
            descriptors::update_field(
                c,
                &site,
                crate::models::DescriptorFieldPatch {
                    name: Some("Location".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        });
        descriptors::tests::mk_field(c, "Wave", "number", &[]);
        assert_round_trip(c, "reorder the fields", |c| {
            let ids: Vec<String> = descriptors::list_fields(c)
                .unwrap()
                .into_iter()
                .rev()
                .map(|x| x.id)
                .collect();
            descriptors::reorder_fields(c, &ids).unwrap();
        });
        assert_round_trip(c, "delete a field with its values", |c| {
            descriptors::delete_field(c, &site).unwrap();
        });
    }

    /// Changing a field's kind converts what it can and drops what it cannot;
    /// undo has to put every value back as it was.
    #[test]
    fn round_trips_changing_a_descriptor_field_kind_over_its_values() {
        let f = Fixture::new();
        let c = f.conn();
        let other = documents::create(c, documents::tests::new_doc("Another document."))
            .unwrap()
            .summary
            .id;
        let field = descriptors::tests::mk_field(c, "Note", "text", &[]).id;
        descriptors::set_value(c, &f.doc, &field, Some("North")).unwrap();
        descriptors::set_value(c, &other, &field, Some("07.50")).unwrap();

        assert_round_trip(c, "text to number", |c| {
            descriptors::update_field(
                c,
                &field,
                crate::models::DescriptorFieldPatch {
                    kind: Some("number".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        });
        // The redo left it a number: "North" is gone, "07.50" is canonical.
        let values = descriptors::values_matrix(c).unwrap();
        let of = |doc: &str| {
            values
                .rows
                .iter()
                .find(|r| r.document_id == doc)
                .and_then(|r| r.values.get(&field).cloned())
        };
        assert_eq!(of(&f.doc), None);
        assert_eq!(of(&other).as_deref(), Some("7.5"));
        // And one undo takes both back.
        undo(c).unwrap().unwrap();
        assert_eq!(descriptors::get_field(c, &field).unwrap().kind, "text");
        let values = descriptors::values_matrix(c).unwrap();
        assert_eq!(
            values
                .rows
                .iter()
                .filter_map(|r| r.values.get(&field).cloned())
                .count(),
            2
        );
    }

    // ---------------------------------------- sets, filters and matrices

    #[test]
    fn round_trips_sets_and_saved_filters() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        let b = f.code("Beta", None);
        assert_round_trip(c, "create a set", |c| {
            sets::create_set(c, "code", "Round 1", std::slice::from_ref(&a), None).unwrap();
        });
        let set = sets::list_sets(c, "code").unwrap()[0].id.clone();
        assert_round_trip(c, "rename a set", |c| {
            sets::rename_set(c, &set, "Round 2").unwrap();
        });
        assert_round_trip(c, "add a member", |c| {
            sets::add_to_set(c, &set, &b).unwrap();
        });
        assert_round_trip(c, "remove a member", |c| {
            sets::remove_from_set(c, &set, &a).unwrap();
        });
        assert_round_trip(c, "replace the members", |c| {
            sets::set_set_members(c, &set, &[a.clone(), b.clone()]).unwrap();
        });
        assert_round_trip(c, "delete a set", |c| {
            sets::delete_set(c, &set).unwrap();
        });

        let filter = crate::models::ExcerptFilter {
            code_ids: Some(vec![a.clone()]),
            ..Default::default()
        };
        assert_round_trip(c, "save a filter", |c| {
            sets::save_filter(c, "Alpha only", &filter).unwrap();
        });
        assert_round_trip(c, "overwrite a filter", |c| {
            sets::save_filter(c, "Alpha only", &crate::models::ExcerptFilter::default()).unwrap();
        });
        let saved = sets::list_saved_filters(c).unwrap()[0].id.clone();
        assert_round_trip(c, "delete a filter", |c| {
            sets::delete_saved_filter(c, &saved).unwrap();
        });
    }

    #[test]
    fn round_trips_framework_matrices_and_their_summaries() {
        let f = Fixture::new();
        let c = f.conn();
        let code = f.code("Access", None);
        let config = |name: &str| crate::models::FrameworkMatrixInput {
            name: name.into(),
            row_kind: "document".into(),
            code_ids: vec![code.clone()],
            ..Default::default()
        };
        assert_round_trip(c, "create a matrix", |c| {
            framework::create_matrix(c, &config("Wave 1"), None).unwrap();
        });
        let m = framework::list_matrices(c).unwrap()[0].id.clone();
        assert_round_trip(c, "write a cell", |c| {
            framework::set_cell_summary(c, &m, &f.doc, &code, "Waits months.").unwrap();
        });
        assert_round_trip(c, "rewrite a cell", |c| {
            framework::set_cell_summary(c, &m, &f.doc, &code, "Waited a year.").unwrap();
        });
        assert_round_trip(c, "clear a cell", |c| {
            framework::set_cell_summary(c, &m, &f.doc, &code, "").unwrap();
        });
        framework::set_cell_summary(c, &m, &f.doc, &code, "Waits months.").unwrap();
        assert_round_trip(c, "reconfigure a matrix", |c| {
            framework::update_matrix(c, &m, &config("Wave 2")).unwrap();
        });
        assert_round_trip(c, "delete a matrix with its summaries", |c| {
            framework::delete_matrix(c, &m).unwrap();
        });
        // The redo deleted it; undoing once more brings the grid back whole.
        undo(c).unwrap().unwrap();
        let view = framework::get_matrix(c, &m).unwrap();
        assert!(view
            .cells
            .iter()
            .any(|cell| cell.summary == "Waits months."));
    }

    // ------------------------------- codebook import, project-wide settings

    /// A codebook import is one step: every code it creates or fills in
    /// records its own node, and the group makes them a single undo.
    #[test]
    fn round_trips_importing_a_codebook_in_merge_mode() {
        use crate::models::{CodebookImport, ImportMode};
        let f = Fixture::new();
        let c = f.conn();
        // An existing code the import matches and fills in, and one it adds.
        let attitudes = f.code("Attitudes", None);
        codes::update(
            c,
            &attitudes,
            CodePatch {
                description: Some(String::new()),
                ..Default::default()
            },
        )
        .ok();
        let csv = "name,parent,color,description,inclusion,exclusion,shortcut\n                   Attitudes,,#112233,Top-level theme,,,\n                   Positive,Attitudes,#445566,Positive framing,,,\n";

        assert_round_trip(c, "import a codebook", |c| {
            crate::db::codebook_import::import_codebook(
                c,
                CodebookImport::Csv { text: csv.into() },
                ImportMode::Merge,
            )
            .unwrap();
        });
        // The redo put it back: the new code is there and the old one is
        // filled in.
        let by_name: std::collections::HashMap<String, crate::models::Code> = codes::list(c)
            .unwrap()
            .into_iter()
            .map(|x| (x.name.clone(), x))
            .collect();
        assert_eq!(by_name["Positive"].description, "Positive framing");
        assert_eq!(by_name["Attitudes"].description, "Top-level theme");

        // One node in the tree for the whole import, named by what it did.
        let step = tree(c).unwrap().into_iter().last().unwrap();
        assert!(step.summary.starts_with("Imported a codebook:"));
        assert!(step.step_count > 1);
        assert!(step.is_head && step.undoable);
    }

    #[test]
    fn round_trips_renaming_the_project_and_setting_stop_words() {
        let p = OpenProject::in_memory("Before").unwrap();
        let c = &p.conn;
        assert_round_trip(c, "rename the project", |_| {
            p.rename("After").unwrap();
        });
        assert_eq!(p.info().unwrap().name, "After");
        assert_round_trip(c, "set the stop words", |c| {
            crate::db::analysis::set_stop_words(c, &["Misket".into(), "um".into()]).unwrap();
        });
        assert_round_trip(c, "change the stop words", |c| {
            crate::db::analysis::set_stop_words(c, &["um".into()]).unwrap();
        });
        assert_eq!(crate::db::analysis::stop_words(c).unwrap(), vec!["um"]);
        undo(c).unwrap().unwrap();
        assert_eq!(
            crate::db::analysis::stop_words(c).unwrap(),
            vec!["misket", "um"]
        );
    }

    // -------------------------------------------------- compound steps

    /// Several writes bracketed by [`begin_group`] are one step in every
    /// direction: one undo, one redo, one node in the tree.
    #[test]
    fn a_group_of_writes_undoes_redoes_and_draws_as_a_single_step() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        let before = dump_state(c);
        let start = head(c).unwrap().unwrap();

        group(c, "Tidy the codebook", |c| {
            codes::update(
                c,
                &a,
                CodePatch {
                    name: Some("Alpha renamed".into()),
                    ..Default::default()
                },
            )?;
            codes::tests::mk(c, "Beta", None);
            codes::tests::mk(c, "Gamma", None);
            Ok(())
        })
        .unwrap();
        let after = dump_state(c);
        assert_eq!(codes::list(c).unwrap().len(), 3);

        let undone = undo(c).unwrap().unwrap();
        assert_eq!(undone.summary, "Tidy the codebook");
        assert_eq!(undone.id, start + 1, "the step is named by its first write");
        assert_same(&before, &dump_state(c), "undoing the group");
        assert_eq!(head(c).unwrap(), Some(start), "all three came off at once");

        let redone = redo(c, None).unwrap().unwrap();
        assert_eq!(redone.id, undone.id);
        assert_same(&after, &dump_state(c), "redoing the group");

        // The tree shows one node for the three writes, and it is the head.
        let tree = tree(c).unwrap();
        assert_eq!(tree.len(), 3, "the document, the code, and the group");
        let step = tree.last().unwrap();
        assert_eq!(step.summary, "Tidy the codebook");
        assert_eq!(step.step_count, 3);
        assert!(step.is_head && step.undoable);
        assert_eq!(step.children, Vec::<i64>::new());
        assert_eq!(step.parent_id, Some(start));
        assert_eq!(tree.iter().filter(|n| n.is_head).count(), 1);
    }

    /// Checking out a node inside a group lands on the whole group, and a
    /// branch taken after one is drawn hanging off the collapsed node.
    #[test]
    fn checkout_never_stops_half_way_through_a_group() {
        let f = Fixture::new();
        let c = f.conn();
        let a = f.code("Alpha", None);
        let fork = head(c).unwrap().unwrap();
        group(c, "Two renames", |c| {
            for name in ["One", "Two"] {
                codes::update(
                    c,
                    &a,
                    CodePatch {
                        name: Some(name.into()),
                        ..Default::default()
                    },
                )?;
            }
            Ok(())
        })
        .unwrap();
        let inside = head(c).unwrap().unwrap() - 1;
        let at_end = dump_state(c);

        checkout(c, fork).unwrap();
        assert_eq!(codes::get(c, &a).unwrap().name, "Alpha");
        // Naming the middle of the group asks for the group.
        let landed = checkout(c, inside).unwrap();
        assert_eq!(landed.summary, "Two renames");
        assert_eq!(landed.id, inside);
        assert_same(&at_end, &dump_state(c), "checking out the group");

        // A second branch from the fork hangs off the collapsed step, not off
        // one of the writes inside it.
        checkout(c, fork).unwrap();
        codes::tests::mk(c, "Side", None);
        let side = head(c).unwrap().unwrap();
        let tree = tree(c).unwrap();
        let at_fork = tree.iter().find(|n| n.id == fork).unwrap();
        assert_eq!(at_fork.children, vec![inside, side]);
        assert_eq!(tree.iter().find(|n| n.id == inside).unwrap().step_count, 2);
        assert!(tree.iter().all(|n| n.id != inside + 1));
    }

    #[test]
    fn a_group_left_open_by_a_failure_closes_without_swallowing_the_next_edit() {
        let f = Fixture::new();
        let c = f.conn();
        let failed = group(c, "Half an import", |c| {
            codes::tests::mk(c, "Alpha", None);
            Err::<(), _>(AppError::Validation("boom".into()))
        });
        assert!(failed.is_err());
        // The group closed, so what comes next is a step of its own.
        let b = codes::tests::mk(c, "Beta", None).id;
        undo(c).unwrap().unwrap();
        assert!(codes::get(c, &b).is_err());
        assert!(codes::list(c).unwrap().iter().any(|x| x.name == "Alpha"));
        end_group(c).unwrap(); // closing one that is not open is harmless
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
        // The graph view's main line follows `preferred_child`: after undoing
        // "One" and writing "Two", the fork's preferred child is the second
        // (current) branch, not the first.
        assert_eq!(root.preferred_child, Some(tree.last().unwrap().id));
        assert_ne!(root.preferred_child, Some(root.children[0]));
        let leaf = tree
            .iter()
            .find(|n| n.id == tree.last().unwrap().id)
            .unwrap();
        assert_eq!(leaf.preferred_child, None, "a leaf has no preferred child");

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

    /// The scenario a smoke test reported failing: work on the sample
    /// project, undo, quit, reopen, undo again. Every node the sample builder
    /// writes has to be undoable for the second undo to land.
    #[test]
    fn the_sample_project_can_be_undone_step_by_step_across_a_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.misket");
        crate::sample::create_sample_project(&path).unwrap();
        let source;
        let target;
        {
            let p = OpenProject::open(&path).unwrap();
            let all = codes::list(&p.conn).unwrap();
            source = all[0].id.clone();
            target = all[1].id.clone();
            codes::merge(&p.conn, &source, &target).unwrap();
            undo(&p.conn).unwrap().unwrap();
            assert!(codes::get(&p.conn, &source).is_ok());
        }
        // Reopening restores the head, and the step before the merge — one
        // the sample builder wrote — undoes like any other.
        let p = OpenProject::open(&path).unwrap();
        assert!(head(&p.conn).unwrap().is_some());
        let node = get(&p.conn, head(&p.conn).unwrap().unwrap()).unwrap();
        assert!(
            node.inverse.is_some(),
            "the sample project's own {} node has no inverse",
            node.kind
        );
        undo(&p.conn).unwrap().unwrap();

        // And so does every one before it, all the way to the first import.
        let mut steps = 0;
        while undo(&p.conn).unwrap().is_some() {
            steps += 1;
            assert!(steps < 500, "undo is not making progress");
        }
        assert_eq!(head(&p.conn).unwrap(), None, "back to an empty project");
        assert_eq!(documents::list(&p.conn).unwrap().len(), 0);
        assert_eq!(codes::list(&p.conn).unwrap().len(), 0);
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

    // ------------------------------------------- one step, in detail

    /// The step at the head, as the detail panel would read it.
    fn detail_of_head(c: &Connection) -> HistoryNodeDetail {
        node_detail(c, head(c).unwrap().unwrap()).unwrap()
    }

    fn find_ref<'a>(d: &'a HistoryNodeDetail, kind: &str) -> &'a HistoryRef {
        d.refs
            .iter()
            .find(|r| r.kind == kind)
            .unwrap_or_else(|| panic!("no {kind} reference in {:?}", d.refs))
    }

    #[test]
    fn node_detail_resolves_a_codings_excerpt_codes_and_document() {
        let f = Fixture::new();
        let c = f.conn();
        let parent = f.code("Themes", None);
        let code = f.code("Access", Some(&parent));
        let excerpt = f.excerpt(0, 10, std::slice::from_ref(&code));

        let d = detail_of_head(c);
        assert_eq!(d.step_count, 1);
        assert!(d.is_head);
        assert!(d.undoable);
        assert!(d.members.is_empty(), "a plain step has no members to list");

        let e = find_ref(&d, "excerpt");
        assert_eq!(e.id, excerpt);
        assert!(e.exists);
        // The snippet, so the panel can quote what was coded.
        assert_eq!(e.label, "Alpha beta");
        assert_eq!(e.document_id.as_deref(), Some(f.doc.as_str()));
        assert_eq!(e.start_pos, Some(0));
        assert_eq!(e.end_pos, Some(10));

        let k = find_ref(&d, "code");
        assert_eq!(k.id, code);
        assert!(k.exists);
        assert_eq!(k.label, "Access");
        assert_eq!(k.path.as_deref(), Some("Themes \u{203a} Access"));
        assert!(k.color.is_some());

        let doc = find_ref(&d, "document");
        assert_eq!(doc.label, documents::get_summary(c, &f.doc).unwrap().name);
        assert!(doc.exists);
    }

    #[test]
    fn node_detail_says_when_a_target_has_since_been_deleted() {
        let f = Fixture::new();
        let c = f.conn();
        let code = f.code("Access", None);
        let excerpt = f.excerpt(0, 10, std::slice::from_ref(&code));
        let coding = head(c).unwrap().unwrap();

        // Both the excerpt and the code the step points at go away.
        excerpts::delete(c, &excerpt).unwrap();
        let deletion = head(c).unwrap().unwrap();
        codes::delete(c, &code, ChildrenStrategy::Delete).unwrap();

        // The deletion step did write the text down, so it quotes it.
        let gone = node_detail(c, deletion).unwrap();
        let quoted = find_ref(&gone, "excerpt");
        assert!(!quoted.exists);
        assert_eq!(quoted.label, "Alpha beta (since deleted)");

        let d = node_detail(c, coding).unwrap();
        assert!(!d.is_head, "the head has moved on to the deletions");

        let e = find_ref(&d, "excerpt");
        assert!(!e.exists);
        // The coding step did not write the text down, so it says where the
        // passage was instead.
        assert_eq!(e.label, "the text at 0\u{2013}10 (since deleted)");
        // Where it was is still known, so the document can still be opened
        // at the passage.
        assert_eq!(e.document_id.as_deref(), Some(f.doc.as_str()));
        assert_eq!(e.start_pos, Some(0));

        let k = find_ref(&d, "code");
        assert!(!k.exists);
        assert_eq!(k.label, "Access (since deleted)");
        assert!(k.path.is_none());
        assert!(k.color.is_none());
    }

    #[test]
    fn node_detail_tells_an_unapplied_step_apart_from_a_deleted_target() {
        let f = Fixture::new();
        let c = f.conn();
        let code = f.code("Access", None);
        f.excerpt(0, 10, std::slice::from_ref(&code));
        let coding = head(c).unwrap().unwrap();

        // Applied and present.
        let now = node_detail(c, coding).unwrap();
        assert!(now.applied);
        assert!(find_ref(&now, "excerpt").exists);

        // Undone: the excerpt is not there, but nobody deleted it — the
        // project is simply at an earlier step.
        undo(c).unwrap();
        let undone = node_detail(c, coding).unwrap();
        assert!(!undone.applied);
        let e = find_ref(&undone, "excerpt");
        assert!(!e.exists);
        assert_eq!(
            e.label,
            "the text at 0\u{2013}10 (not in the project right now)"
        );
        // The code itself is still there, so it still reads normally.
        assert!(find_ref(&undone, "code").exists);
    }

    #[test]
    fn node_detail_names_a_deleted_target_it_never_wrote_a_name_for() {
        let f = Fixture::new();
        let c = f.conn();
        let code = f.code("Access", None);
        let excerpt = f.excerpt(0, 10, std::slice::from_ref(&code));
        // The delete step's own target is the excerpt, and its detail keeps
        // the snapshot; drop that to stand for an older payload without one.
        excerpts::delete(c, &excerpt).unwrap();
        let deletion = head(c).unwrap().unwrap();
        c.execute(
            "UPDATE history SET detail_json = '{}' WHERE id = ?1",
            [deletion],
        )
        .unwrap();

        let d = node_detail(c, deletion).unwrap();
        let e = find_ref(&d, "excerpt");
        assert!(!e.exists);
        assert_eq!(e.label, "This excerpt (since deleted)");
        assert!(e.document_id.is_none(), "nothing left to say where it was");
    }

    #[test]
    fn node_detail_describes_a_compound_step_and_lists_its_members() {
        let f = Fixture::new();
        let c = f.conn();
        let code = f.code("Access", None);
        let excerpt = f.excerpt(0, 20, std::slice::from_ref(&code));
        // A split records two nodes as one step.
        excerpts::split(c, &excerpt, 10).unwrap();

        let d = detail_of_head(c);
        assert_eq!(d.step_count, 2);
        assert_eq!(d.members.len(), 2);
        assert!(d.members.iter().all(|m| !m.summary.is_empty()));
        // The step wears the group's own label, not its first node's.
        assert!(d.summary.to_lowercase().contains("split"));

        // Any node of the group answers for the whole step.
        let second = d.members[1].id;
        assert_eq!(node_detail(c, second).unwrap().id, d.id);
    }

    #[test]
    fn node_detail_resolves_both_sides_of_a_code_merge() {
        let f = Fixture::new();
        let c = f.conn();
        let source = f.code("Access", None);
        let target = f.code("Barriers", None);
        f.excerpt(0, 10, std::slice::from_ref(&source));
        codes::merge(c, &source, &target).unwrap();

        let d = detail_of_head(c);
        // The source is gone; the target is not.
        let labels: Vec<(&str, bool)> = d
            .refs
            .iter()
            .filter(|r| r.kind == "code")
            .map(|r| (r.label.as_str(), r.exists))
            .collect();
        assert!(labels.contains(&("Barriers", true)), "{labels:?}");
        assert!(
            labels
                .iter()
                .any(|(l, exists)| !exists && l.starts_with("Access")),
            "{labels:?}",
        );
    }

    #[test]
    fn node_detail_carries_the_payload_and_the_branch_name() {
        let f = Fixture::new();
        let c = f.conn();
        f.code("Access", None);
        fork_here(c, "second pass").unwrap();

        let d = detail_of_head(c);
        assert_eq!(d.branch_name.as_deref(), Some("second pass"));
        assert_eq!(d.kind, "code.created");
        assert_eq!(d.detail.get("name").and_then(Value::as_str), Some("Access"));
        assert_eq!(d.actor, "Ada");
    }

    #[test]
    fn node_detail_is_not_found_for_a_node_that_is_not_there() {
        let f = Fixture::new();
        assert!(matches!(
            node_detail(f.conn(), 9_999),
            Err(AppError::NotFound(_))
        ));
    }
}
