//! Pull from another copy of the project.
//!
//! Misket has no server. Two researchers working on one study keep one file
//! each in a shared folder — `study.ada.misket`, `study.bob.misket` — and
//! each of them, whenever they like, pulls the other's file into their own.
//!
//! A pull is a **union**. It reads the other file through its own read-only
//! connection, never writes a byte to it, and never deletes a row from ours:
//! whatever Bob has and Ada does not, Ada gets, attributed to Bob
//! ([`crate::db::coders`]). Everything it does happens inside one
//! [`history::group`], so the whole pull is one step in the history and one
//! Ctrl-Z takes it all back.
//!
//! # Matching
//!
//! Nothing here is guesswork about *content*; it is guesswork about
//! *identity*, and every rule falls back to the id first.
//!
//! | Thing              | Matched by                                                        |
//! | ------------------ | ----------------------------------------------------------------- |
//! | documents          | id, else `content_hash` — the same text imported twice separately |
//! | codes              | id, else the same name (case-insensitively) under the same parent |
//! | excerpts           | id, else the same range or rectangle in the same document         |
//! | codings            | `(excerpt, code, coder)`, which is their primary key              |
//! | memos              | id                                                                 |
//! | descriptor fields  | id, else name                                                     |
//! | descriptor values  | `(document, field)`                                               |
//! | sets, filters      | id, else name (per kind, for sets)                                |
//! | framework matrices | id, else name; cells by `(matrix, row key, code)`                 |
//! | coders             | id — the whole point of a coder id                                |
//!
//! A document matched by hash under a different id maps *their* id to *our*
//! id, and their excerpts, descriptor values and framework rows are rewritten
//! onto our document on the way in. Codes matched by name do the same for
//! their codings.
//!
//! # Scalars both sides can edit
//!
//! A union has nothing to say about a code that Ada renamed and Bob
//! recoloured, or a memo they both edited. For those — code name, colour and
//! definition fields, code parent and sort order, memo title and body,
//! descriptor values, framework cell summaries, document name, set name,
//! transcript format — Misket does a **three-way merge against a stored
//! base** (`sync_points`, schema 12): the scalar state as it stood the last
//! time we pulled from that copy.
//!
//! - ours unchanged since the base → take theirs
//! - theirs unchanged since the base → keep ours
//! - both changed, to different values → ask
//!
//! The first pull from a copy has no base. Then **ours wins** for every
//! scalar and the plan lists what differs as a note, which is the
//! conservative reading of "I have never merged with this person before". The
//! same holds for a row that is in both files but not in the base: it grew in
//! both copies independently and there is no telling who moved what.
//!
//! # Who "they" are
//!
//! A sync point is keyed by the other file's `project_id` and the coder that
//! file writes as — see [`their_coder`]: the most recent non-empty
//! `history.coder_id` in it, falling back to the `coders` row with the most
//! codings. That pair survives the file being renamed, copied or moved.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{activity, coders, history, migrations, transcripts, util};
use crate::error::{AppError, Result};
use crate::models::{
    CodePatch, CodeRow, CodeTreeSnapshot, Coder, Coding, DescriptorField, DescriptorValue,
    DocumentSnapshot, ExcerptSnapshot, ExcerptWithCodes, FrameworkCellRow, FrameworkMatrix,
    FrameworkMatrixWithCells, Memo, MergeCoder, MergeConflict, MergeDecision, MergePlan,
    MergeReport, SavedFilter, SetInfo, SetWithMembers, SyncPoint, TagRow,
};
use crate::text::transcript::TranscriptFormat;

// ---------------------------------------------------------------- the other file

/// The other copy, open read-only, with the three things that identify it.
struct Other {
    conn: Connection,
    path: PathBuf,
    /// What to call it in a sentence: the coder who writes in it, else the
    /// project's name, else the file name.
    display_name: String,
    project_id: String,
    /// The coder that file writes as (see [`their_coder`]).
    coder_id: String,
    /// How far its history had run when we read it.
    head: Option<i64>,
}

/// Open another project file for reading, and refuse the cases a pull cannot
/// make sense of.
///
/// The other file is opened `SQLITE_OPEN_READ_ONLY` and never migrated: it is
/// somebody else's file, and upgrading it behind their back would rewrite
/// their project on their disk. A file older than this build is refused with
/// the one thing that fixes it — its owner opening it once.
fn open_other(conn: &Connection, other_path: &Path) -> Result<Other> {
    if !other_path.is_file() {
        return Err(AppError::NotFound(format!(
            "no project at {}",
            other_path.display()
        )));
    }
    if let Some(ours) = conn.path().filter(|p| !p.is_empty()) {
        let same = std::fs::canonicalize(ours)
            .ok()
            .zip(std::fs::canonicalize(other_path).ok())
            .map(|(a, b)| a == b)
            .unwrap_or(false);
        if same {
            return Err(AppError::Validation(
                "that is this project, not another copy of it".into(),
            ));
        }
    }
    let other = Connection::open_with_flags(other_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let app_id: i32 = other.query_row("PRAGMA application_id", [], |r| r.get(0))?;
    if app_id != super::APPLICATION_ID {
        return Err(AppError::Validation(format!(
            "{} is not a Misket project",
            other_path.display()
        )));
    }
    let version = migrations::current_version(&other)?;
    let latest = migrations::latest_version();
    if version > latest {
        return Err(AppError::NewerSchema(version));
    }
    if version < latest {
        return Err(AppError::Validation(format!(
            "{} was last written by an older version of Misket (schema {version}, this build \
             reads {latest}). Ask whoever owns it to open it once in this version — that \
             upgrades it — and then pull again.",
            file_label(other_path)
        )));
    }
    other.execute_batch("PRAGMA foreign_keys = ON")?;
    let project_id = super::meta(&other, "project_id")?.unwrap_or_default();
    let coder_id = their_coder(&other)?;
    let head: Option<i64> = other
        .query_row("SELECT max(id) FROM history", [], |r| r.get(0))
        .optional()?
        .flatten();
    let display_name = coders::get(&other, &coder_id)?
        .map(|c| c.name)
        .filter(|n| !n.trim().is_empty())
        .or_else(|| super::meta(&other, "name").ok().flatten())
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| file_label(other_path));
    Ok(Other {
        conn: other,
        path: other_path.to_path_buf(),
        display_name,
        project_id,
        coder_id,
        head,
    })
}

/// `study.bob.misket` → `study.bob`, for a sentence about a file.
fn file_label(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// Which coder a project file writes as.
///
/// The local coder id lives in the app's settings, not in the file, so it
/// cannot be read out of somebody else's project directly. What *is* in the
/// file is who signed its edits: the most recent non-empty `history.coder_id`
/// is whoever last worked in it, which is the owner in every case a shared
/// folder produces. A file with no signed history at all (one that predates
/// schema 11 and was never opened since) falls back to the `coders` row with
/// the most codings, and then to the first row there.
pub fn their_coder(conn: &Connection) -> Result<String> {
    let latest: Option<String> = conn
        .query_row(
            "SELECT coder_id FROM history WHERE coder_id <> '' ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = latest.filter(|s| !s.is_empty()) {
        return Ok(id);
    }
    let busiest: Option<String> = conn
        .query_row(
            "SELECT c.id FROM coders c
               LEFT JOIN excerpt_codes ec ON ec.coder_id = c.id
              GROUP BY c.id
              ORDER BY count(ec.excerpt_id) DESC, c.created_at, c.id
              LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    Ok(busiest.unwrap_or_default())
}

// ------------------------------------------------------------------- reading a side

/// One `excerpts` row, without the DTO's derived fields.
#[derive(Debug, Clone)]
struct ExRow {
    id: String,
    document_id: String,
    kind: String,
    start_pos: Option<i64>,
    end_pos: Option<i64>,
    geometry: Option<String>,
    snapshot: Option<String>,
    created_at: String,
    updated_at: String,
}

impl ExRow {
    /// What makes two excerpts the same passage when their ids differ: the
    /// document, the kind, and the range or the rectangle.
    fn shape(&self, document_id: &str) -> String {
        format!(
            "{document_id}\u{0}{}\u{0}{:?}\u{0}{:?}\u{0}{}",
            self.kind,
            self.start_pos,
            self.end_pos,
            self.geometry.as_deref().unwrap_or("")
        )
    }
}

/// Everything a pull reads out of one project file.
struct Side {
    documents: Vec<DocumentSnapshot>,
    codes: Vec<CodeRow>,
    /// Code id → the excerpt held up as its example.
    examples: BTreeMap<String, String>,
    excerpts: Vec<ExRow>,
    tags: Vec<TagRow>,
    memos: Vec<Memo>,
    fields: Vec<DescriptorField>,
    values: Vec<DescriptorValue>,
    sets: Vec<(SetInfo, Vec<String>)>,
    filters: Vec<SavedFilter>,
    matrices: Vec<FrameworkMatrix>,
    cells: Vec<FrameworkCellRow>,
    coders: Vec<Coder>,
}

fn read_side(conn: &Connection) -> Result<Side> {
    let documents = conn
        .prepare(
            "SELECT id, kind, name, source_path, source_format, content_hash, media_json,
                    text_length, sort_order, created_at, updated_at, transcript_json
               FROM documents ORDER BY sort_order, id",
        )?
        .query_map([], |r| {
            Ok(DocumentSnapshot {
                id: r.get(0)?,
                kind: r.get(1)?,
                name: r.get(2)?,
                source_path: r.get(3)?,
                source_format: r.get(4)?,
                content_hash: r.get(5)?,
                media_json: r.get(6)?,
                media_mime: None,
                text_length: r.get(7)?,
                sort_order: r.get(8)?,
                created_at: r.get(9)?,
                updated_at: r.get(10)?,
                transcript_json: r.get(11)?,
                ..Default::default()
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let codes = conn
        .prepare(
            "SELECT id, parent_id, name, color, description, inclusion, exclusion, shortcut,
                    sort_order, created_at, updated_at
               FROM codes ORDER BY sort_order, name",
        )?
        .query_map([], |r| {
            Ok(CodeRow {
                id: r.get(0)?,
                parent_id: r.get(1)?,
                name: r.get(2)?,
                color: r.get(3)?,
                description: r.get(4)?,
                inclusion: r.get(5)?,
                exclusion: r.get(6)?,
                shortcut: r.get(7)?,
                sort_order: r.get(8)?,
                created_at: r.get(9)?,
                updated_at: r.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let examples = conn
        .prepare("SELECT id, example_excerpt_id FROM codes WHERE example_excerpt_id IS NOT NULL")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<BTreeMap<String, String>>>()?;

    let excerpts = conn
        .prepare(
            "SELECT id, document_id, kind, start_pos, end_pos, geometry, snapshot,
                    created_at, updated_at
               FROM excerpts ORDER BY document_id, start_pos, id",
        )?
        .query_map([], |r| {
            Ok(ExRow {
                id: r.get(0)?,
                document_id: r.get(1)?,
                kind: r.get(2)?,
                start_pos: r.get(3)?,
                end_pos: r.get(4)?,
                geometry: r.get(5)?,
                snapshot: r.get(6)?,
                created_at: r.get(7)?,
                updated_at: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let tags = conn
        .prepare(
            "SELECT excerpt_id, code_id, coder_id, created_at FROM excerpt_codes
              ORDER BY excerpt_id, code_id, coder_id",
        )?
        .query_map([], |r| {
            Ok(TagRow {
                excerpt_id: r.get(0)?,
                code_id: r.get(1)?,
                coder_id: r.get(2)?,
                created_at: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let memos = conn
        .prepare(
            "SELECT id, document_id, code_id, excerpt_id, title, body, coder_id,
                    created_at, updated_at
               FROM memos ORDER BY created_at, id",
        )?
        .query_map([], |r| {
            Ok(Memo {
                id: r.get(0)?,
                document_id: r.get(1)?,
                code_id: r.get(2)?,
                excerpt_id: r.get(3)?,
                title: r.get(4)?,
                body: r.get(5)?,
                coder_id: r.get(6)?,
                created_at: r.get(7)?,
                updated_at: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let fields = super::descriptors::list_fields(conn)?;
    let values = conn
        .prepare(
            "SELECT document_id, field_id, value FROM descriptor_values
              ORDER BY document_id, field_id",
        )?
        .query_map([], |r| {
            Ok(DescriptorValue {
                document_id: r.get(0)?,
                field_id: r.get(1)?,
                value: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut sets = vec![];
    for kind in ["code", "document"] {
        for info in super::sets::list_sets(conn, kind)? {
            let members = super::sets::set_members(conn, &info.id)?;
            sets.push((info, members));
        }
    }
    let filters = super::sets::list_saved_filters(conn)?;
    let matrices = super::framework::list_matrices(conn)?;
    let cells = conn
        .prepare(
            "SELECT matrix_id, row_key, code_id, summary, updated_at FROM framework_cells
              ORDER BY matrix_id, row_key, code_id",
        )?
        .query_map([], |r| {
            Ok(FrameworkCellRow {
                matrix_id: r.get(0)?,
                row_key: r.get(1)?,
                code_id: r.get(2)?,
                summary: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let coders = conn
        .prepare("SELECT id, name, color, created_at FROM coders ORDER BY created_at, id")?
        .query_map([], |r| {
            Ok(Coder {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                created_at: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(Side {
        documents,
        codes,
        examples,
        excerpts,
        tags,
        memos,
        fields,
        values,
        sets,
        filters,
        matrices,
        cells,
        coders,
    })
}

fn read_text(conn: &Connection, id: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT text FROM documents WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .optional()?
        .flatten())
}

fn read_media(conn: &Connection, id: &str) -> Result<Option<(String, Vec<u8>)>> {
    Ok(conn
        .query_row(
            "SELECT mime, bytes FROM media_blobs WHERE document_id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

// ------------------------------------------------------------------- the base

/// The mergeable scalar state of a project, small enough to keep a copy of in
/// every sync point.
///
/// Keyed by *our* ids throughout, so comparing the other copy against it
/// means mapping their ids over first. Written and read only here, so the
/// shape can change whenever the rules do: an unreadable base simply means
/// "no base", which is the same as a first pull.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Base {
    #[serde(default)]
    codes: BTreeMap<String, CodeScalars>,
    /// Memo id → `(title, body)`.
    #[serde(default)]
    memos: BTreeMap<String, (String, String)>,
    /// `documentId\0fieldId` → value.
    #[serde(default)]
    values: BTreeMap<String, String>,
    /// `matrixId\0rowKey\0codeId` → summary.
    #[serde(default)]
    cells: BTreeMap<String, String>,
    /// Document id → `(name, transcript format)`.
    #[serde(default)]
    documents: BTreeMap<String, (String, String)>,
    /// Set id → name.
    #[serde(default)]
    sets: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct CodeScalars {
    name: String,
    color: String,
    description: String,
    inclusion: String,
    exclusion: String,
    parent: String,
    sort: i64,
}

impl CodeScalars {
    fn of(row: &CodeRow) -> Self {
        Self {
            name: row.name.clone(),
            color: row.color.clone(),
            description: row.description.clone(),
            inclusion: row.inclusion.clone(),
            exclusion: row.exclusion.clone(),
            parent: row.parent_id.clone().unwrap_or_default(),
            sort: row.sort_order,
        }
    }
    /// The fields, as `(label, ours)` pairs, for a conflict the user reads.
    fn fields(&self) -> Vec<(&'static str, String)> {
        vec![
            ("name", self.name.clone()),
            ("colour", self.color.clone()),
            ("description", self.description.clone()),
            ("inclusion", self.inclusion.clone()),
            ("exclusion", self.exclusion.clone()),
            ("parent", self.parent.clone()),
            ("order", self.sort.to_string()),
        ]
    }
}

fn value_key(document_id: &str, field_id: &str) -> String {
    format!("{document_id}\u{0}{field_id}")
}

fn cell_key(matrix_id: &str, row_key: &str, code_id: &str) -> String {
    format!("{matrix_id}\u{0}{row_key}\u{0}{code_id}")
}

/// The stored transcript format of a document, without the speaker cache, so
/// two files that detected the same format compare equal.
fn format_of(transcript_json: Option<&str>) -> String {
    let Some(raw) = transcript_json else {
        return String::new();
    };
    match serde_json::from_str::<transcripts::StoredTranscript>(raw) {
        Ok(stored) => serde_json::to_string(&stored.format).unwrap_or_default(),
        Err(_) => String::new(),
    }
}

/// Read the sync point for one copy, if we have ever pulled from it.
fn sync_point(conn: &Connection, project_id: &str, coder_id: &str) -> Result<Option<SyncPoint>> {
    Ok(conn
        .query_row(
            "SELECT other_project_id, other_coder_id, at, our_node_id, their_node_id, base_json
               FROM sync_points WHERE other_project_id = ?1 AND other_coder_id = ?2",
            params![project_id, coder_id],
            |r| {
                Ok(SyncPoint {
                    other_project_id: r.get(0)?,
                    other_coder_id: r.get(1)?,
                    at: r.get(2)?,
                    our_node_id: r.get(3)?,
                    their_node_id: r.get(4)?,
                    base_json: r.get(5)?,
                })
            },
        )
        .optional()?)
}

/// Every sync point in this project, newest first — "copies you have pulled
/// from".
pub fn sync_points(conn: &Connection) -> Result<Vec<SyncPoint>> {
    Ok(conn
        .prepare(
            "SELECT other_project_id, other_coder_id, at, our_node_id, their_node_id, base_json
               FROM sync_points ORDER BY at DESC",
        )?
        .query_map([], |r| {
            Ok(SyncPoint {
                other_project_id: r.get(0)?,
                other_coder_id: r.get(1)?,
                at: r.get(2)?,
                our_node_id: r.get(3)?,
                their_node_id: r.get(4)?,
                base_json: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

/// The scalar state of this project right now, to store as the next base.
fn base_of(conn: &Connection) -> Result<Base> {
    let side = read_side(conn)?;
    let mut base = Base::default();
    for c in &side.codes {
        base.codes.insert(c.id.clone(), CodeScalars::of(c));
    }
    for m in &side.memos {
        base.memos
            .insert(m.id.clone(), (m.title.clone(), m.body.clone()));
    }
    for v in &side.values {
        base.values
            .insert(value_key(&v.document_id, &v.field_id), v.value.clone());
    }
    for c in &side.cells {
        base.cells.insert(
            cell_key(&c.matrix_id, &c.row_key, &c.code_id),
            c.summary.clone(),
        );
    }
    for d in &side.documents {
        base.documents.insert(
            d.id.clone(),
            (d.name.clone(), format_of(d.transcript_json.as_deref())),
        );
    }
    for (s, _) in &side.sets {
        base.sets.insert(s.id.clone(), s.name.clone());
    }
    Ok(base)
}

/// What a three-way comparison of one scalar says to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pick {
    /// Both sides agree; nothing to do.
    Same,
    /// Ours has not moved since the base, so theirs is the newer answer.
    Theirs,
    /// Theirs has not moved, or there is no base to judge by.
    Ours,
    /// Both moved, to different values.
    Conflict,
}

/// The three-way rule, in one place.
///
/// `base` is `None` on a first pull, and for a row that is in both copies but
/// not in the base — grown independently on both sides, with no telling who
/// changed what. Both mean "keep ours", and the difference is reported as a
/// note rather than as a question.
fn pick(base: Option<&str>, ours: &str, theirs: &str) -> Pick {
    if ours == theirs {
        return Pick::Same;
    }
    match base {
        None => Pick::Ours,
        Some(b) if b == ours => Pick::Theirs,
        Some(b) if b == theirs => Pick::Ours,
        Some(_) => Pick::Conflict,
    }
}

// ------------------------------------------------------------------- mapping

/// Their ids, rewritten onto ours wherever the two copies turned out to be
/// talking about the same thing.
#[derive(Debug, Default)]
struct Mapping {
    document: HashMap<String, String>,
    code: HashMap<String, String>,
    excerpt: HashMap<String, String>,
    field: HashMap<String, String>,
    set: HashMap<String, String>,
    matrix: HashMap<String, String>,
    /// Their codes that will not exist here at all after the pull, because
    /// the user chose to drop a code we had deleted.
    dropped_codes: HashSet<String>,
}

impl Mapping {
    /// Their id, as this project spells it. Unmatched ids are kept as they
    /// are: a row we are about to create keeps the id it was born with, so
    /// the next pull matches it outright.
    fn id(map: &HashMap<String, String>, id: &str) -> String {
        map.get(id).cloned().unwrap_or_else(|| id.to_string())
    }
}

/// A deterministic id derived from what it stands for, so pulling twice makes
/// the same one rather than a second copy.
///
/// Shaped like a UUID (and stamped version 5, "name-based") because
/// everything else in a project file is one; the hash underneath is SHA-256
/// rather than SHA-1, which no reader here cares about.
fn derived_id(kind: &str, parts: &[&str]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(kind.as_bytes());
    for p in parts {
        h.update([0u8]);
        h.update(p.as_bytes());
    }
    let d = h.finalize();
    let mut b = [0u8; 16];
    b.copy_from_slice(&d[..16]);
    b[6] = (b[6] & 0x0f) | 0x50;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

// ------------------------------------------------------------------- the work

/// One scalar change to a code, as the payload vocabulary wants it.
struct CodeEdit {
    code_id: String,
    patch: CodePatch,
    updated_at: String,
    /// `(parent, index)` when the code also moves.
    move_to: Option<(Option<String>, i64)>,
}

/// A code's example excerpt: `(code, theirs, ours, their `updated_at`, ours)`.
type CodeExample = (String, Option<String>, Option<String>, String, String);

/// A set's membership: `(set, the union, ours, their `updated_at`, ours)`.
type SetMembership = (String, Vec<String>, Vec<String>, String, String);

/// Everything a pull is going to write, worked out before anything is.
#[derive(Default)]
struct Work {
    coders: Vec<Coder>,
    coders_before: Vec<Coder>,
    coders_new: Vec<String>,
    new_documents: Vec<(DocumentSnapshot, Option<String>, Option<Vec<u8>>)>,
    document_renames: Vec<(String, String, String, String)>,
    transcript_sets: Vec<(String, Option<TranscriptFormat>, Option<TranscriptFormat>)>,
    new_codes: CodeTreeSnapshot,
    code_edits: Vec<(CodeEdit, CodeEdit)>,
    new_excerpts: Vec<ExcerptSnapshot>,
    add_tags: Vec<TagRow>,
    /// `(code, their example, ours, their updated_at, ours)`.
    code_examples: Vec<CodeExample>,
    memos: Vec<Memo>,
    memos_before: Vec<Memo>,
    memos_new: Vec<String>,
    new_fields: Vec<DescriptorField>,
    set_values: Vec<(String, String, Option<String>, Option<String>)>,
    new_sets: Vec<SetWithMembers>,
    set_members: Vec<SetMembership>,
    new_filters: Vec<SavedFilter>,
    new_matrices: Vec<FrameworkMatrixWithCells>,
    cells: Vec<(FrameworkCellRow, String, String)>,
}

// ------------------------------------------------------------------- planning

/// What pulling from `other_path` would do, without doing any of it.
pub fn preview(conn: &Connection, other_path: &Path) -> Result<MergePlan> {
    let other = open_other(conn, other_path)?;
    Ok(build(conn, &other, &[])?.0)
}

/// The defaults a plan proposes, as decisions, so an apply with no decisions
/// at all still does something sensible.
fn decide(decisions: &[MergeDecision], plan: &MergePlan) -> HashMap<String, String> {
    let given: HashMap<&str, &str> = decisions
        .iter()
        .map(|d| (d.conflict_id.as_str(), d.choice.as_str()))
        .collect();
    plan.conflicts
        .iter()
        .map(|c| {
            let chosen = given
                .get(c.id.as_str())
                .filter(|choice| c.choices.iter().any(|(id, _)| id == **choice))
                .map(|s| s.to_string())
                .unwrap_or_else(|| c.default.clone());
            (c.id.clone(), chosen)
        })
        .collect()
}

#[allow(clippy::too_many_lines)]
fn build(
    conn: &Connection,
    other: &Other,
    decisions: &[MergeDecision],
) -> Result<(MergePlan, Work)> {
    let ours = read_side(conn)?;
    let theirs = read_side(&other.conn)?;
    let local = history::local_coder(conn);
    let our_project_id = super::meta(conn, "project_id")?.unwrap_or_default();
    let point = sync_point(conn, &other.project_id, &other.coder_id)?;
    let base: Option<Base> = point
        .as_ref()
        .and_then(|p| serde_json::from_str::<Base>(&p.base_json).ok());
    let first_pull = base.is_none();

    let mut plan = MergePlan {
        other_name: other.display_name.clone(),
        other_path: other.path.display().to_string(),
        other_project_id: other.project_id.clone(),
        same_project: !our_project_id.is_empty() && our_project_id == other.project_id,
        first_pull,
        ..Default::default()
    };
    let mut work = Work::default();
    let mut map = Mapping::default();
    let mut notes: Vec<String> = vec![];
    let mut conflicts: Vec<MergeConflict> = vec![];

    if !plan.same_project {
        notes.push(format!(
            "{} is a different project ({}), not another copy of this one. Everything in it \
             will arrive as new material.",
            other.display_name,
            short_id(&other.project_id)
        ));
    }
    if first_pull {
        notes.push(
            "This is the first pull from this copy, so there is no shared starting point to \
             judge edits against: anything you have both changed keeps your version, and any \
             difference is noted here."
                .into(),
        );
    }

    // ------------------------------------------------------------- coders
    let ours_by_id: HashMap<&str, &Coder> =
        ours.coders.iter().map(|c| (c.id.as_str(), c)).collect();
    for c in &theirs.coders {
        if c.id == local || c.id.is_empty() {
            continue; // never overwrite our own row with their idea of it
        }
        match ours_by_id.get(c.id.as_str()) {
            Some(existing) if *existing == c => {}
            Some(existing) => {
                work.coders_before.push((*existing).clone());
                work.coders.push(c.clone());
            }
            None => {
                work.coders_new.push(c.id.clone());
                work.coders.push(c.clone());
            }
        }
    }

    // ---------------------------------------------------------- documents
    let our_docs_by_id: HashMap<&str, &DocumentSnapshot> =
        ours.documents.iter().map(|d| (d.id.as_str(), d)).collect();
    let mut our_docs_by_hash: HashMap<&str, &DocumentSnapshot> = HashMap::new();
    for d in &ours.documents {
        our_docs_by_hash.entry(d.content_hash.as_str()).or_insert(d);
    }
    let mut next_sort = ours
        .documents
        .iter()
        .map(|d| d.sort_order)
        .max()
        .unwrap_or(-1)
        + 1;
    for d in &theirs.documents {
        let matched = our_docs_by_id
            .get(d.id.as_str())
            .copied()
            .map(|m| (m, true))
            .or_else(|| {
                our_docs_by_hash
                    .get(d.content_hash.as_str())
                    .copied()
                    .map(|m| (m, false))
            });
        match matched {
            Some((m, by_id)) => {
                map.document.insert(d.id.clone(), m.id.clone());
                if by_id {
                    plan.documents.matched += 1;
                } else {
                    plan.documents.by_name += 1;
                    notes.push(format!(
                        "“{}” is the same text as your “{}” under a different id; their \
                         excerpts will land on yours.",
                        d.name, m.name
                    ));
                }
                // Scalars: the name, and how the document marks its speakers.
                let (base_name, base_format) = base
                    .as_ref()
                    .and_then(|b| b.documents.get(&m.id))
                    .cloned()
                    .map(|(n, f)| (Some(n), Some(f)))
                    .unwrap_or((None, None));
                match pick(base_name.as_deref(), &m.name, &d.name) {
                    Pick::Theirs => work.document_renames.push((
                        m.id.clone(),
                        d.name.clone(),
                        d.updated_at.clone(),
                        m.name.clone(),
                    )),
                    Pick::Conflict | Pick::Ours if m.name != d.name => notes.push(format!(
                        "Document “{}” is called “{}” in {}'s copy; yours keeps its name.",
                        m.name, d.name, other.display_name
                    )),
                    _ => {}
                }
                let our_format = format_of(m.transcript_json.as_deref());
                let their_format = format_of(d.transcript_json.as_deref());
                if pick(base_format.as_deref(), &our_format, &their_format) == Pick::Theirs {
                    work.transcript_sets.push((
                        m.id.clone(),
                        parse_format(&their_format),
                        parse_format(&our_format),
                    ));
                }
            }
            None => {
                plan.documents.new += 1;
                let mut snapshot = d.clone();
                snapshot.sort_order = next_sort;
                next_sort += 1;
                let text = read_text(&other.conn, &d.id)?;
                let media = read_media(&other.conn, &d.id)?;
                if let Some((mime, _)) = &media {
                    snapshot.media_mime = Some(mime.clone());
                }
                work.new_documents
                    .push((snapshot, text, media.map(|(_, b)| b)));
            }
        }
    }

    // -------------------------------------------------------------- codes
    let our_codes_by_id: HashMap<&str, &CodeRow> =
        ours.codes.iter().map(|c| (c.id.as_str(), c)).collect();
    // `(our parent id or "", lowercased name)` → our code id, kept up to date
    // as their new codes claim places in our tree.
    let mut by_place: HashMap<(String, String), String> = ours
        .codes
        .iter()
        .map(|c| {
            (
                (
                    c.parent_id.clone().unwrap_or_default(),
                    c.name.to_lowercase(),
                ),
                c.id.clone(),
            )
        })
        .collect();
    let our_shortcuts: HashSet<String> = ours
        .codes
        .iter()
        .filter_map(|c| c.shortcut.clone())
        .collect();
    let their_children: HashMap<String, Vec<&CodeRow>> = {
        let mut m: HashMap<String, Vec<&CodeRow>> = HashMap::new();
        for c in &theirs.codes {
            m.entry(c.parent_id.clone().unwrap_or_default())
                .or_default()
                .push(c);
        }
        for v in m.values_mut() {
            v.sort_by(|a, b| a.sort_order.cmp(&b.sort_order).then(a.id.cmp(&b.id)));
        }
        m
    };
    let decisions_map = {
        // Conflicts are discovered as we go, so decisions are looked up by the
        // id the discovery will give them.
        let given: HashMap<String, String> = decisions
            .iter()
            .map(|d| (d.conflict_id.clone(), d.choice.clone()))
            .collect();
        given
    };
    let choose = |id: &str, default: &str| -> String {
        decisions_map
            .get(id)
            .cloned()
            .unwrap_or_else(|| default.to_string())
    };

    let mut queue: Vec<(String, Option<String>)> = their_children
        .get("")
        .map(|v| v.iter().map(|c| (c.id.clone(), None)).collect())
        .unwrap_or_default();
    let mut new_sort: HashMap<String, i64> = HashMap::new();
    while let Some((their_id, our_parent)) = queue.pop() {
        let Some(c) = theirs.codes.iter().find(|x| x.id == their_id) else {
            continue;
        };
        let parent_key = our_parent.clone().unwrap_or_default();
        let existing = our_codes_by_id
            .get(their_id.as_str())
            .copied()
            .map(|m| (m.id.clone(), true))
            .or_else(|| {
                by_place
                    .get(&(parent_key.clone(), c.name.to_lowercase()))
                    .map(|id| (id.clone(), false))
            });
        let our_id = match existing {
            Some((our_id, by_id)) => {
                if by_id {
                    plan.codes.matched += 1;
                } else {
                    plan.codes.by_name += 1;
                    notes.push(format!(
                        "“{}” already exists here under a different id; their codings of it \
                         join yours.",
                        c.name
                    ));
                }
                if let Some(our_code) = our_codes_by_id.get(our_id.as_str()).copied() {
                    plan_code_scalars(
                        our_code,
                        c,
                        base.as_ref(),
                        &map,
                        other,
                        &choose,
                        &mut conflicts,
                        &mut notes,
                        &mut work,
                    );
                }
                our_id
            }
            None => {
                // A code we once had and deleted is a different question from
                // one we have never seen, and only a base can tell them apart.
                let deleted_here = base
                    .as_ref()
                    .map(|b| b.codes.contains_key(&their_id))
                    .unwrap_or(false);
                let used_there = theirs.tags.iter().any(|t| t.code_id == their_id);
                if deleted_here {
                    let id = format!("code.deletedHere:{their_id}");
                    conflicts.push(MergeConflict {
                        id: id.clone(),
                        kind: "code.deletedHere".into(),
                        title: format!(
                            "“{}” was deleted here, and {} used it",
                            c.name, other.display_name
                        ),
                        field: String::new(),
                        ours: "deleted".into(),
                        theirs: format!(
                            "{} coding{}",
                            theirs.tags.iter().filter(|t| t.code_id == their_id).count(),
                            if used_there { "s" } else { "" }
                        ),
                        choices: vec![
                            (
                                "restore".into(),
                                "Bring the code back, with their codings".into(),
                            ),
                            (
                                "drop".into(),
                                "Leave it deleted, and drop their codings".into(),
                            ),
                        ],
                        default: "restore".into(),
                    });
                    if choose(&id, "restore") == "drop" {
                        map.dropped_codes.insert(their_id.clone());
                        continue;
                    }
                }
                plan.codes.new += 1;
                let sort = *new_sort
                    .entry(parent_key.clone())
                    .and_modify(|v| *v += 1)
                    .or_insert_with(|| {
                        ours.codes
                            .iter()
                            .filter(|x| x.parent_id.clone().unwrap_or_default() == parent_key)
                            .map(|x| x.sort_order)
                            .max()
                            .unwrap_or(-1)
                            + 1
                    });
                let mut row = c.clone();
                row.parent_id = our_parent.clone();
                row.sort_order = sort;
                if row
                    .shortcut
                    .as_ref()
                    .map(|s| our_shortcuts.contains(s))
                    .unwrap_or(false)
                {
                    notes.push(format!(
                        "“{}” keeps its shortcut here; {}'s copy uses the same key for another \
                         code.",
                        c.name, other.display_name
                    ));
                    row.shortcut = None;
                }
                by_place.insert((parent_key, c.name.to_lowercase()), row.id.clone());
                work.new_codes.codes.push(row);
                their_id.clone()
            }
        };
        map.code.insert(their_id.clone(), our_id.clone());
        if let Some(children) = their_children.get(&their_id) {
            for child in children.iter().rev() {
                queue.push((child.id.clone(), Some(our_id.clone())));
            }
        }
    }
    // Parents before children, which `codes::restore_subtree` relies on.
    order_parents_first(&mut work.new_codes.codes);

    // ----------------------------------------------------------- excerpts
    let our_ex_by_id: HashMap<&str, &ExRow> =
        ours.excerpts.iter().map(|e| (e.id.as_str(), e)).collect();
    let our_ex_by_shape: HashMap<String, &ExRow> = ours
        .excerpts
        .iter()
        .map(|e| (e.shape(&e.document_id), e))
        .collect();
    let mut their_new_excerpts: Vec<&ExRow> = vec![];
    for e in &theirs.excerpts {
        let Some(document_id) = map.document.get(&e.document_id).cloned().or_else(|| {
            theirs
                .documents
                .iter()
                .any(|d| d.id == e.document_id)
                .then(|| e.document_id.clone())
        }) else {
            continue;
        };
        let by_id = our_ex_by_id
            .get(e.id.as_str())
            .copied()
            .filter(|m| m.document_id == document_id);
        let matched = by_id.or_else(|| our_ex_by_shape.get(&e.shape(&document_id)).copied());
        match matched {
            Some(m) => {
                map.excerpt.insert(e.id.clone(), m.id.clone());
                if by_id.is_some() {
                    plan.excerpts.matched += 1;
                } else {
                    plan.excerpts.by_name += 1;
                }
            }
            None => {
                plan.excerpts.new += 1;
                // An id already taken by an excerpt in another document has
                // to give way, or the insert would collide.
                let id = if our_ex_by_id.contains_key(e.id.as_str()) {
                    derived_id("excerpt", &[&e.id, &document_id])
                } else {
                    e.id.clone()
                };
                map.excerpt.insert(e.id.clone(), id);
                their_new_excerpts.push(e);
            }
        }
    }
    for e in their_new_excerpts {
        let document_id = Mapping::id(&map.document, &e.document_id);
        let id = Mapping::id(&map.excerpt, &e.id);
        let tags: Vec<TagRow> = theirs
            .tags
            .iter()
            .filter(|t| t.excerpt_id == e.id && !map.dropped_codes.contains(&t.code_id))
            .map(|t| TagRow {
                excerpt_id: id.clone(),
                code_id: Mapping::id(&map.code, &t.code_id),
                coder_id: t.coder_id.clone(),
                created_at: t.created_at.clone(),
            })
            .collect();
        let mut code_ids: Vec<String> = vec![];
        for t in &tags {
            if !code_ids.contains(&t.code_id) {
                code_ids.push(t.code_id.clone());
            }
        }
        plan.codings.new += tags.len() as i64;
        work.new_excerpts.push(ExcerptSnapshot {
            excerpt: ExcerptWithCodes {
                id,
                document_id,
                kind: e.kind.clone(),
                start_pos: e.start_pos,
                end_pos: e.end_pos,
                geometry: e.geometry.clone(),
                snapshot: e.snapshot.clone(),
                codings: tags
                    .iter()
                    .map(|t| Coding {
                        code_id: t.code_id.clone(),
                        coder_id: t.coder_id.clone(),
                    })
                    .collect(),
                code_ids,
                memo_count: 0,
                created_at: e.created_at.clone(),
                updated_at: e.updated_at.clone(),
            },
            memos: vec![],
            tags,
        });
    }

    // ------------------------------------------------------------ codings
    let our_tags: HashSet<(String, String, String)> = ours
        .tags
        .iter()
        .map(|t| (t.excerpt_id.clone(), t.code_id.clone(), t.coder_id.clone()))
        .collect();
    let new_excerpt_ids: HashSet<String> = work
        .new_excerpts
        .iter()
        .map(|s| s.excerpt.id.clone())
        .collect();
    for t in &theirs.tags {
        if map.dropped_codes.contains(&t.code_id) {
            continue;
        }
        let excerpt_id = Mapping::id(&map.excerpt, &t.excerpt_id);
        if new_excerpt_ids.contains(&excerpt_id) {
            continue; // arrives with the excerpt itself
        }
        let code_id = Mapping::id(&map.code, &t.code_id);
        if !map.excerpt.contains_key(&t.excerpt_id) {
            continue; // an excerpt in a document we could not place
        }
        let key = (excerpt_id.clone(), code_id.clone(), t.coder_id.clone());
        if our_tags.contains(&key) {
            plan.codings.matched += 1;
            continue;
        }
        plan.codings.new += 1;
        work.add_tags.push(TagRow {
            excerpt_id,
            code_id,
            coder_id: t.coder_id.clone(),
            created_at: t.created_at.clone(),
        });
    }

    // The code an excerpt is held up as the example of only makes sense once
    // that excerpt exists here, so it is settled after them — and only where
    // we have no example of our own to overwrite.
    for (their_code, their_excerpt) in &theirs.examples {
        if map.dropped_codes.contains(their_code) {
            continue;
        }
        let Some(code_id) = map.code.get(their_code).cloned() else {
            continue;
        };
        let Some(excerpt_id) = map.excerpt.get(their_excerpt).cloned() else {
            continue;
        };
        let was = ours.examples.get(&code_id).cloned();
        if was.is_some() || was.as_deref() == Some(excerpt_id.as_str()) {
            continue;
        }
        let their_updated = theirs
            .codes
            .iter()
            .find(|c| c.id == *their_code)
            .map(|c| c.updated_at.clone())
            .unwrap_or_else(util::now);
        let our_updated = ours
            .codes
            .iter()
            .find(|c| c.id == code_id)
            .map(|c| c.updated_at.clone())
            .unwrap_or_else(|| their_updated.clone());
        work.code_examples
            .push((code_id, Some(excerpt_id), was, their_updated, our_updated));
    }

    // -------------------------------------------------------------- memos
    let our_memos_by_id: HashMap<&str, &Memo> =
        ours.memos.iter().map(|m| (m.id.as_str(), m)).collect();
    for m in &theirs.memos {
        let Some(target) = map_memo_target(m, &map, &theirs) else {
            notes.push(format!(
                "A memo from {}'s copy has nothing to hang on here and was left behind.",
                other.display_name
            ));
            continue;
        };
        match our_memos_by_id.get(m.id.as_str()).copied() {
            None => {
                plan.memos.new += 1;
                let mut memo = m.clone();
                memo.document_id = target.0;
                memo.code_id = target.1;
                memo.excerpt_id = target.2;
                work.memos_new.push(memo.id.clone());
                work.memos.push(memo);
            }
            Some(existing) => {
                plan.memos.matched += 1;
                let base_pair = base.as_ref().and_then(|b| b.memos.get(&m.id)).cloned();
                let ours_text = format!("{}\u{0}{}", existing.title, existing.body);
                let theirs_text = format!("{}\u{0}{}", m.title, m.body);
                let base_text = base_pair.map(|(t, b)| format!("{t}\u{0}{b}"));
                match pick(base_text.as_deref(), &ours_text, &theirs_text) {
                    Pick::Same => {}
                    Pick::Ours => {
                        if ours_text != theirs_text {
                            notes.push(format!(
                                "Memo “{}” reads differently in {}'s copy; yours stands.",
                                title_of(existing),
                                other.display_name
                            ));
                        }
                    }
                    Pick::Theirs => {
                        let mut memo = m.clone();
                        memo.document_id = target.0;
                        memo.code_id = target.1;
                        memo.excerpt_id = target.2;
                        work.memos_before.push((*existing).clone());
                        work.memos.push(memo);
                    }
                    Pick::Conflict => {
                        let id = format!("memo:{}", m.id);
                        conflicts.push(MergeConflict {
                            id: id.clone(),
                            kind: "memo".into(),
                            title: format!(
                                "Memo “{}” was edited on both sides",
                                title_of(existing)
                            ),
                            field: String::new(),
                            ours: preview_text(&existing.body),
                            theirs: preview_text(&m.body),
                            choices: vec![
                                ("both".into(), "Keep both, as two memos".into()),
                                ("ours".into(), "Keep mine".into()),
                                ("theirs".into(), "Take theirs".into()),
                            ],
                            default: "both".into(),
                        });
                        match choose(&id, "both").as_str() {
                            "theirs" => {
                                let mut memo = m.clone();
                                memo.document_id = target.0;
                                memo.code_id = target.1;
                                memo.excerpt_id = target.2;
                                work.memos_before.push((*existing).clone());
                                work.memos.push(memo);
                            }
                            "both" => {
                                let mut memo = m.clone();
                                memo.id = derived_id("memo", &[&m.id, &other.coder_id]);
                                memo.document_id = target.0;
                                memo.code_id = target.1;
                                memo.excerpt_id = target.2;
                                memo.title = format!("{} ({})", title_of(m), other.display_name);
                                if !ours.memos.iter().any(|x| x.id == memo.id) {
                                    work.memos_new.push(memo.id.clone());
                                    work.memos.push(memo);
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    // -------------------------------------------------------- descriptors
    let our_fields_by_id: HashMap<&str, &DescriptorField> =
        ours.fields.iter().map(|f| (f.id.as_str(), f)).collect();
    let our_fields_by_name: HashMap<String, &DescriptorField> = ours
        .fields
        .iter()
        .map(|f| (f.name.to_lowercase(), f))
        .collect();
    let mut next_field_sort = ours.fields.iter().map(|f| f.sort_order).max().unwrap_or(-1) + 1;
    for f in &theirs.fields {
        let matched = our_fields_by_id
            .get(f.id.as_str())
            .copied()
            .map(|m| (m, true))
            .or_else(|| {
                our_fields_by_name
                    .get(&f.name.to_lowercase())
                    .copied()
                    .map(|m| (m, false))
            });
        match matched {
            Some((m, by_id)) => {
                map.field.insert(f.id.clone(), m.id.clone());
                if by_id {
                    plan.descriptor_fields.matched += 1;
                } else {
                    plan.descriptor_fields.by_name += 1;
                }
                if m.kind != f.kind {
                    notes.push(format!(
                        "The attribute “{}” is a {} field here and a {} field in {}'s copy; \
                         yours keeps its kind.",
                        m.name, m.kind, f.kind, other.display_name
                    ));
                }
            }
            None => {
                plan.descriptor_fields.new += 1;
                let mut field = f.clone();
                field.sort_order = next_field_sort;
                next_field_sort += 1;
                work.new_fields.push(field);
            }
        }
    }
    let our_values: HashMap<String, &DescriptorValue> = ours
        .values
        .iter()
        .map(|v| (value_key(&v.document_id, &v.field_id), v))
        .collect();
    let our_doc_ids: HashSet<&str> = ours.documents.iter().map(|d| d.id.as_str()).collect();
    for v in &theirs.values {
        let document_id = Mapping::id(&map.document, &v.document_id);
        let field_id = Mapping::id(&map.field, &v.field_id);
        let key = value_key(&document_id, &field_id);
        match our_values.get(&key) {
            None => {
                plan.descriptor_values.new += 1;
                work.set_values
                    .push((document_id, field_id, Some(v.value.clone()), None));
            }
            Some(existing) => {
                plan.descriptor_values.matched += 1;
                let b = base.as_ref().and_then(|b| b.values.get(&key)).cloned();
                match pick(b.as_deref(), &existing.value, &v.value) {
                    Pick::Same => {}
                    Pick::Ours => {}
                    Pick::Theirs => work.set_values.push((
                        document_id,
                        field_id,
                        Some(v.value.clone()),
                        Some(existing.value.clone()),
                    )),
                    Pick::Conflict => {
                        let id = format!("descriptor.value:{document_id}:{field_id}");
                        let field_name = our_fields_by_id
                            .get(field_id.as_str())
                            .map(|f| f.name.clone())
                            .unwrap_or_else(|| field_id.clone());
                        let doc_name = ours
                            .documents
                            .iter()
                            .find(|d| d.id == document_id)
                            .map(|d| d.name.clone())
                            .unwrap_or_else(|| document_id.clone());
                        conflicts.push(MergeConflict {
                            id: id.clone(),
                            kind: "descriptor.value".into(),
                            title: format!("“{field_name}” for “{doc_name}”"),
                            field: field_name,
                            ours: existing.value.clone(),
                            theirs: v.value.clone(),
                            choices: vec![
                                ("ours".into(), "Keep mine".into()),
                                ("theirs".into(), "Take theirs".into()),
                            ],
                            default: "ours".into(),
                        });
                        if choose(&id, "ours") == "theirs" {
                            work.set_values.push((
                                document_id,
                                field_id,
                                Some(v.value.clone()),
                                Some(existing.value.clone()),
                            ));
                        }
                    }
                }
            }
        }
        let _ = &our_doc_ids;
    }

    // --------------------------------------------------------------- sets
    let our_sets_by_id: HashMap<&str, &(SetInfo, Vec<String>)> =
        ours.sets.iter().map(|s| (s.0.id.as_str(), s)).collect();
    let our_sets_by_name: HashMap<(String, String), &(SetInfo, Vec<String>)> = ours
        .sets
        .iter()
        .map(|s| ((s.0.kind.clone(), s.0.name.to_lowercase()), s))
        .collect();
    for (info, members) in &theirs.sets {
        let their_members: Vec<String> = members
            .iter()
            .map(|m| {
                if info.kind == "code" {
                    Mapping::id(&map.code, m)
                } else {
                    Mapping::id(&map.document, m)
                }
            })
            .filter(|m| !map.dropped_codes.contains(m))
            .collect();
        let matched = our_sets_by_id
            .get(info.id.as_str())
            .copied()
            .filter(|m| m.0.kind == info.kind)
            .map(|m| (m, true))
            .or_else(|| {
                our_sets_by_name
                    .get(&(info.kind.clone(), info.name.to_lowercase()))
                    .copied()
                    .map(|m| (m, false))
            });
        match matched {
            Some(((our_info, our_members), by_id)) => {
                map.set.insert(info.id.clone(), our_info.id.clone());
                if by_id {
                    plan.sets.matched += 1;
                } else {
                    plan.sets.by_name += 1;
                }
                let mut union = our_members.clone();
                for m in &their_members {
                    if !union.contains(m) {
                        union.push(m.clone());
                    }
                }
                if union != *our_members {
                    work.set_members.push((
                        our_info.id.clone(),
                        union,
                        our_members.clone(),
                        info.updated_at.clone(),
                        our_info.updated_at.clone(),
                    ));
                }
                let b = base
                    .as_ref()
                    .and_then(|b| b.sets.get(&our_info.id))
                    .cloned();
                if pick(b.as_deref(), &our_info.name, &info.name) == Pick::Theirs {
                    notes.push(format!(
                        "The set “{}” is called “{}” in {}'s copy; renaming sets is left to \
                         you, so yours keeps its name.",
                        our_info.name, info.name, other.display_name
                    ));
                }
            }
            None => {
                plan.sets.new += 1;
                work.new_sets.push(SetWithMembers {
                    set: info.clone(),
                    member_ids: their_members,
                });
            }
        }
    }

    // ------------------------------------------------------------ filters
    let our_filter_ids: HashSet<&str> = ours.filters.iter().map(|f| f.id.as_str()).collect();
    let our_filter_names: HashSet<String> =
        ours.filters.iter().map(|f| f.name.to_lowercase()).collect();
    let mut next_filter_sort = ours
        .filters
        .iter()
        .map(|f| f.sort_order)
        .max()
        .unwrap_or(-1)
        + 1;
    for f in &theirs.filters {
        if our_filter_ids.contains(f.id.as_str())
            || our_filter_names.contains(&f.name.to_lowercase())
        {
            plan.filters.matched += 1;
            continue;
        }
        plan.filters.new += 1;
        let mut filter = f.clone();
        filter.sort_order = next_filter_sort;
        next_filter_sort += 1;
        work.new_filters.push(filter);
    }

    // ---------------------------------------------------------- framework
    let our_matrices_by_id: HashMap<&str, &FrameworkMatrix> =
        ours.matrices.iter().map(|m| (m.id.as_str(), m)).collect();
    let our_matrices_by_name: HashMap<String, &FrameworkMatrix> = ours
        .matrices
        .iter()
        .map(|m| (m.name.to_lowercase(), m))
        .collect();
    for m in &theirs.matrices {
        let matched = our_matrices_by_id
            .get(m.id.as_str())
            .copied()
            .map(|x| (x, true))
            .or_else(|| {
                our_matrices_by_name
                    .get(&m.name.to_lowercase())
                    .copied()
                    .map(|x| (x, false))
            });
        match matched {
            Some((x, by_id)) => {
                map.matrix.insert(m.id.clone(), x.id.clone());
                if by_id {
                    plan.framework_matrices.matched += 1;
                } else {
                    plan.framework_matrices.by_name += 1;
                }
            }
            None => {
                plan.framework_matrices.new += 1;
                let mut matrix = m.clone();
                matrix.row_field_id = matrix.row_field_id.map(|f| Mapping::id(&map.field, &f));
                matrix.row_set_id = matrix.row_set_id.map(|s| Mapping::id(&map.set, &s));
                matrix.code_set_id = matrix.code_set_id.map(|s| Mapping::id(&map.set, &s));
                matrix.code_ids = matrix
                    .code_ids
                    .iter()
                    .filter(|c| !map.dropped_codes.contains(*c))
                    .map(|c| Mapping::id(&map.code, c))
                    .collect();
                work.new_matrices.push(FrameworkMatrixWithCells {
                    matrix,
                    cells: vec![],
                });
            }
        }
    }
    let our_cells: HashMap<String, &FrameworkCellRow> = ours
        .cells
        .iter()
        .map(|c| (cell_key(&c.matrix_id, &c.row_key, &c.code_id), c))
        .collect();
    for c in &theirs.cells {
        if map.dropped_codes.contains(&c.code_id) {
            continue;
        }
        let matrix_id = Mapping::id(&map.matrix, &c.matrix_id);
        let code_id = Mapping::id(&map.code, &c.code_id);
        // A row key is a document id when the matrix has document rows, and a
        // descriptor value otherwise; mapping a value is a no-op.
        let row_key = Mapping::id(&map.document, &c.row_key);
        let key = cell_key(&matrix_id, &row_key, &code_id);
        let row = FrameworkCellRow {
            matrix_id: matrix_id.clone(),
            row_key: row_key.clone(),
            code_id: code_id.clone(),
            summary: c.summary.clone(),
            updated_at: c.updated_at.clone(),
        };
        match our_cells.get(&key) {
            None => {
                plan.framework_cells.new += 1;
                if let Some(m) = work
                    .new_matrices
                    .iter_mut()
                    .find(|m| m.matrix.id == matrix_id)
                {
                    m.cells
                        .push((row_key, code_id, c.summary.clone(), c.updated_at.clone()));
                } else {
                    work.cells.push((row, String::new(), String::new()));
                }
            }
            Some(existing) => {
                plan.framework_cells.matched += 1;
                let b = base.as_ref().and_then(|b| b.cells.get(&key)).cloned();
                match pick(b.as_deref(), &existing.summary, &c.summary) {
                    Pick::Same | Pick::Ours => {}
                    Pick::Theirs => work.cells.push((
                        row,
                        existing.summary.clone(),
                        existing.updated_at.clone(),
                    )),
                    Pick::Conflict => {
                        let id = format!("framework.cell:{matrix_id}:{row_key}:{code_id}");
                        conflicts.push(MergeConflict {
                            id: id.clone(),
                            kind: "framework.cell".into(),
                            title: format!(
                                "A framework summary in “{}” was written on both sides",
                                ours.matrices
                                    .iter()
                                    .find(|x| x.id == matrix_id)
                                    .map(|x| x.name.clone())
                                    .unwrap_or_else(|| matrix_id.clone())
                            ),
                            field: String::new(),
                            ours: preview_text(&existing.summary),
                            theirs: preview_text(&c.summary),
                            choices: vec![
                                ("ours".into(), "Keep mine".into()),
                                ("theirs".into(), "Take theirs".into()),
                            ],
                            default: "ours".into(),
                        });
                        if choose(&id, "ours") == "theirs" {
                            work.cells.push((
                                row,
                                existing.summary.clone(),
                                existing.updated_at.clone(),
                            ));
                        }
                    }
                }
            }
        }
    }

    // ------------------------------------------------------- the coder list
    let mut incoming: HashMap<String, i64> = HashMap::new();
    for t in work
        .add_tags
        .iter()
        .chain(work.new_excerpts.iter().flat_map(|e| e.tags.iter()))
    {
        *incoming.entry(t.coder_id.clone()).or_default() += 1;
    }
    let mut seen: HashSet<String> = HashSet::new();
    let mut by_coder: Vec<MergeCoder> = vec![];
    for c in &theirs.coders {
        seen.insert(c.id.clone());
        by_coder.push(MergeCoder {
            coding_count: theirs.tags.iter().filter(|t| t.coder_id == c.id).count() as i64,
            incoming_count: incoming.get(&c.id).copied().unwrap_or(0),
            is_theirs: c.id == other.coder_id,
            is_local: c.id == local,
            id: c.id.clone(),
            name: if c.name.trim().is_empty() {
                c.id.clone()
            } else {
                c.name.clone()
            },
            color: if c.color.trim().is_empty() {
                coders::color_for(&c.id)
            } else {
                c.color.clone()
            },
        });
    }
    for t in &theirs.tags {
        if t.coder_id.is_empty() || !seen.insert(t.coder_id.clone()) {
            continue;
        }
        by_coder.push(MergeCoder {
            id: t.coder_id.clone(),
            name: t.coder_id.clone(),
            color: coders::color_for(&t.coder_id),
            coding_count: theirs
                .tags
                .iter()
                .filter(|x| x.coder_id == t.coder_id)
                .count() as i64,
            incoming_count: incoming.get(&t.coder_id).copied().unwrap_or(0),
            is_theirs: t.coder_id == other.coder_id,
            is_local: t.coder_id == local,
        });
    }
    by_coder.sort_by(|a, b| {
        b.incoming_count
            .cmp(&a.incoming_count)
            .then(b.coding_count.cmp(&a.coding_count))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    plan.other_coders = by_coder;

    notes.sort();
    notes.dedup();
    conflicts.sort_by(|a, b| a.id.cmp(&b.id));
    conflicts.dedup_by(|a, b| a.id == b.id);
    plan.notes = notes;
    plan.conflicts = conflicts;
    Ok((plan, work))
}

/// The scalar three-way for one matched code, and the conflict it raises.
#[allow(clippy::too_many_arguments)]
fn plan_code_scalars(
    ours: &CodeRow,
    theirs: &CodeRow,
    base: Option<&Base>,
    map: &Mapping,
    other: &Other,
    choose: &impl Fn(&str, &str) -> String,
    conflicts: &mut Vec<MergeConflict>,
    notes: &mut Vec<String>,
    work: &mut Work,
) {
    let our_scalars = CodeScalars::of(ours);
    let mut their_scalars = CodeScalars::of(theirs);
    // Their parent, spelled the way this project spells it.
    their_scalars.parent = theirs
        .parent_id
        .as_ref()
        .map(|p| Mapping::id(&map.code, p))
        .unwrap_or_default();
    if our_scalars == their_scalars {
        return;
    }
    let base_scalars = base.and_then(|b| b.codes.get(&ours.id));
    let mut take: Vec<&'static str> = vec![];
    let mut clash: Vec<&'static str> = vec![];
    for ((label, our_v), (_, their_v)) in our_scalars.fields().iter().zip(their_scalars.fields()) {
        let b = base_scalars.map(|b| match *label {
            "name" => b.name.clone(),
            "colour" => b.color.clone(),
            "description" => b.description.clone(),
            "inclusion" => b.inclusion.clone(),
            "exclusion" => b.exclusion.clone(),
            "parent" => b.parent.clone(),
            _ => b.sort.to_string(),
        });
        match pick(b.as_deref(), our_v, &their_v) {
            Pick::Theirs => take.push(label),
            Pick::Conflict => clash.push(label),
            Pick::Ours if base.is_none() => notes.push(format!(
                "“{}” differs from {}'s copy ({label}); yours stands until you have pulled \
                 from them once.",
                ours.name, other.display_name
            )),
            _ => {}
        }
    }
    if !clash.is_empty() {
        let id = format!("code.scalar:{}", ours.id);
        conflicts.push(MergeConflict {
            id: id.clone(),
            kind: "code.scalar".into(),
            title: format!("“{}” was edited on both sides", ours.name),
            field: clash.join(", "),
            ours: describe_code(&our_scalars),
            theirs: describe_code(&their_scalars),
            choices: vec![
                ("ours".into(), "Keep mine".into()),
                ("theirs".into(), "Take theirs".into()),
            ],
            default: "ours".into(),
        });
        if choose(&id, "ours") == "theirs" {
            take.extend(clash);
        }
    }
    if take.is_empty() {
        return;
    }
    let want = |f: &str| take.contains(&f);
    let patch = CodePatch {
        name: want("name").then(|| their_scalars.name.clone()),
        color: want("colour").then(|| their_scalars.color.clone()),
        description: want("description").then(|| their_scalars.description.clone()),
        inclusion: want("inclusion").then(|| their_scalars.inclusion.clone()),
        exclusion: want("exclusion").then(|| their_scalars.exclusion.clone()),
        ..Default::default()
    };
    let back = CodePatch {
        name: want("name").then(|| our_scalars.name.clone()),
        color: want("colour").then(|| our_scalars.color.clone()),
        description: want("description").then(|| our_scalars.description.clone()),
        inclusion: want("inclusion").then(|| our_scalars.inclusion.clone()),
        exclusion: want("exclusion").then(|| our_scalars.exclusion.clone()),
        ..Default::default()
    };
    let moves = want("parent") || want("order");
    work.code_edits.push((
        CodeEdit {
            code_id: ours.id.clone(),
            patch,
            updated_at: theirs.updated_at.clone(),
            move_to: moves.then(|| {
                (
                    Some(their_scalars.parent.clone()).filter(|p| !p.is_empty()),
                    their_scalars.sort,
                )
            }),
        },
        CodeEdit {
            code_id: ours.id.clone(),
            patch: back,
            updated_at: ours.updated_at.clone(),
            move_to: moves.then(|| (ours.parent_id.clone(), ours.sort_order)),
        },
    ));
}

fn describe_code(s: &CodeScalars) -> String {
    let mut parts = vec![s.name.clone()];
    if !s.description.is_empty() {
        parts.push(preview_text(&s.description));
    }
    parts.push(s.color.clone());
    parts.join(" · ")
}

fn preview_text(s: &str) -> String {
    activity::elide(s.trim(), 140)
}

fn title_of(m: &Memo) -> String {
    if m.title.trim().is_empty() {
        preview_text(&m.body)
    } else {
        m.title.clone()
    }
}

fn short_id(id: &str) -> String {
    id.chars().take(8).collect()
}

fn parse_format(serialized: &str) -> Option<TranscriptFormat> {
    if serialized.is_empty() {
        return None;
    }
    serde_json::from_str(serialized).ok()
}

/// Their memo's target, as this project spells it, or `None` when the thing
/// it was written about did not make it over.
type MemoTargetIds = (Option<String>, Option<String>, Option<String>);
fn map_memo_target(m: &Memo, map: &Mapping, theirs: &Side) -> Option<MemoTargetIds> {
    if let Some(code_id) = &m.code_id {
        if map.dropped_codes.contains(code_id) {
            return None;
        }
        return Some((None, Some(Mapping::id(&map.code, code_id)), None));
    }
    if let Some(excerpt_id) = &m.excerpt_id {
        if !map.excerpt.contains_key(excerpt_id) {
            return None;
        }
        return Some((None, None, Some(Mapping::id(&map.excerpt, excerpt_id))));
    }
    if let Some(document_id) = &m.document_id {
        if !map.document.contains_key(document_id)
            && !theirs.documents.iter().any(|d| d.id == *document_id)
        {
            return None;
        }
        return Some((Some(Mapping::id(&map.document, document_id)), None, None));
    }
    Some((None, None, None))
}

/// Sort code rows so every parent comes before its children.
fn order_parents_first(rows: &mut Vec<CodeRow>) {
    let ids: HashSet<String> = rows.iter().map(|c| c.id.clone()).collect();
    let mut out: Vec<CodeRow> = Vec::with_capacity(rows.len());
    let mut placed: HashSet<String> = HashSet::new();
    let mut pending: Vec<CodeRow> = std::mem::take(rows);
    while !pending.is_empty() {
        let (ready, rest): (Vec<CodeRow>, Vec<CodeRow>) = pending.into_iter().partition(|c| {
            c.parent_id
                .as_ref()
                .map(|p| !ids.contains(p) || placed.contains(p))
                .unwrap_or(true)
        });
        if ready.is_empty() {
            // A cycle cannot happen in a tree, but never loop forever.
            out.extend(rest);
            break;
        }
        for c in &ready {
            placed.insert(c.id.clone());
        }
        out.extend(ready);
        pending = rest;
    }
    *rows = out;
}

// ------------------------------------------------------------------- applying

/// Record one node and run its forward payload, exactly as a redo would.
///
/// Everything a pull writes goes through this, so every step of it carries an
/// inverse written in the vocabulary [`history`] already knows how to walk —
/// which is why undoing a whole pull needs no code of its own.
#[allow(clippy::too_many_arguments)]
fn step(
    conn: &Connection,
    kind: &str,
    target_kind: &str,
    target_id: Option<&str>,
    summary: &str,
    detail: Value,
    forward: Value,
    inverse: Value,
    blobs: &[(&str, &[u8])],
) -> Result<()> {
    let id = history::record_with_blobs(
        conn,
        &activity::actor(conn),
        kind,
        target_kind,
        target_id,
        summary,
        &detail,
        Some(forward),
        Some(inverse),
        blobs,
    )?;
    if id == 0 {
        return Ok(());
    }
    let node = history::get(conn, id)?;
    history::apply_forward(conn, &node)
}

/// Pull another copy's work into this project.
///
/// One [`history::group`] labelled "Pulled from <name>'s copy", so Ctrl-Z
/// takes the whole thing back; nothing is ever deleted, and the other file is
/// never written to. `decisions` answers the conflicts
/// [`preview`] listed — anything unanswered takes the default the plan
/// proposed, so an apply with no decisions is the safe reading of the plan.
pub fn apply(
    conn: &Connection,
    other_path: &Path,
    decisions: &[MergeDecision],
) -> Result<MergeReport> {
    let other = open_other(conn, other_path)?;
    // Planned once to learn the defaults, and again with every decision
    // settled, so a conflict the caller did not answer still resolves the way
    // the preview said it would.
    let (proposed, _) = build(conn, &other, decisions)?;
    let settled: Vec<MergeDecision> = decide(decisions, &proposed)
        .into_iter()
        .map(|(conflict_id, choice)| MergeDecision {
            conflict_id,
            choice,
        })
        .collect();
    let (plan, work) = build(conn, &other, &settled)?;

    let summary = format!("Pulled from {}'s copy", other.display_name);
    history::group(conn, &summary, |conn| {
        let tx = util::tx(conn)?;
        let report = execute(&tx, &other, &plan, work)?;
        history::relabel_group(&tx, &report.summary)?;
        tx.commit()?;
        Ok(report)
    })
}

#[allow(clippy::too_many_lines)]
fn execute(conn: &Connection, other: &Other, plan: &MergePlan, work: Work) -> Result<MergeReport> {
    let mut report = MergeReport {
        other_name: other.display_name.clone(),
        conflicts_resolved: plan.conflicts.len() as i64,
        by_coder: plan
            .other_coders
            .iter()
            .filter(|c| c.incoming_count > 0)
            .cloned()
            .collect(),
        ..Default::default()
    };

    // The leading node: who these rows belong to. It comes first so the group
    // wears its label, and so every coding that follows has a name behind it.
    step(
        conn,
        "project.pulled",
        "project",
        None,
        &format!("Pulled from {}'s copy", other.display_name),
        json!({
            "otherName": other.display_name,
            "otherPath": other.path.display().to_string(),
            "otherProjectId": other.project_id,
            "sameProject": plan.same_project,
            "firstPull": plan.first_pull,
            "documents": plan.documents.new,
            "codes": plan.codes.new,
            "excerpts": plan.excerpts.new,
            "codings": plan.codings.new,
            "memos": plan.memos.new,
            "conflicts": plan.conflicts.len(),
        }),
        history::payload(&history::PullChange {
            coders: work.coders.clone(),
            ..Default::default()
        }),
        history::payload(&history::PullChange {
            drop_coders: work.coders_new.clone(),
            coders: work.coders_before.clone(),
            ..Default::default()
        }),
        &[],
    )?;

    // ---------------------------------------------------------- documents
    for (snapshot, text, media) in work.new_documents {
        let mut blobs: Vec<(&str, &[u8])> = vec![];
        if let Some(t) = &text {
            blobs.push(("text", t.as_bytes()));
        }
        if let Some(m) = &media {
            blobs.push(("media", m.as_slice()));
        }
        step(
            conn,
            "document.imported",
            "document",
            Some(&snapshot.id),
            &format!("Pulled document “{}”", snapshot.name),
            json!({ "name": snapshot.name, "from": other.display_name }),
            history::payload(&history::DocumentOp::Restore {
                snapshot: Box::new(snapshot.clone()),
            }),
            history::payload(&history::DocumentOp::Drop {
                document_id: snapshot.id.clone(),
            }),
            &blobs,
        )?;
        report.documents += 1;
    }
    for (id, name, updated_at, was) in work.document_renames {
        step(
            conn,
            "document.renamed",
            "document",
            Some(&id),
            &format!("Renamed “{was}” to “{name}”"),
            json!({ "from": was, "to": name }),
            history::payload(&history::DocumentOp::Rename {
                document_id: id.clone(),
                name: name.clone(),
                updated_at,
            }),
            history::payload(&history::DocumentOp::Rename {
                document_id: id.clone(),
                name: was,
                updated_at: current_updated_at(conn, "documents", &id),
            }),
            &[],
        )?;
    }
    for (id, format, was) in work.transcript_sets {
        step(
            conn,
            "transcript.format_set",
            "document",
            Some(&id),
            "Took their transcript format",
            json!({ "documentId": id }),
            history::payload(&history::TranscriptChange {
                document_id: Some(id.clone()),
                format,
            }),
            history::payload(&history::TranscriptChange {
                document_id: Some(id.clone()),
                format: was,
            }),
            &[],
        )?;
    }

    // -------------------------------------------------------------- codes
    if !work.new_codes.codes.is_empty() {
        let ids: Vec<String> = work.new_codes.codes.iter().map(|c| c.id.clone()).collect();
        let names: Vec<String> = work
            .new_codes
            .codes
            .iter()
            .map(|c| c.name.clone())
            .collect();
        report.codes = ids.len() as i64;
        step(
            conn,
            "code.created",
            "code",
            ids.first().map(String::as_str),
            &format!(
                "Pulled {} code{}",
                ids.len(),
                if ids.len() == 1 { "" } else { "s" }
            ),
            json!({ "names": names, "from": other.display_name }),
            history::payload(&history::CodeOp::Restore {
                snapshot: work.new_codes.clone(),
                reparent: vec![],
                remove_tags: vec![],
            }),
            history::payload(&history::CodeOp::Drop {
                code_ids: ids.clone(),
            }),
            &[],
        )?;
    }
    for (forward, inverse) in work.code_edits {
        let name = activity::code_name(conn, &forward.code_id);
        step(
            conn,
            "code.updated",
            "code",
            Some(&forward.code_id),
            &format!("Took {}'s edits to “{}”", other.display_name, name),
            json!({ "codeId": forward.code_id }),
            history::payload(&history::CodeOp::Update {
                code_id: forward.code_id.clone(),
                patch: Box::new(forward.patch.clone()),
                updated_at: forward.updated_at.clone(),
            }),
            history::payload(&history::CodeOp::Update {
                code_id: inverse.code_id.clone(),
                patch: Box::new(inverse.patch.clone()),
                updated_at: inverse.updated_at.clone(),
            }),
            &[],
        )?;
        if let (Some((parent, index)), Some((was_parent, was_index))) =
            (forward.move_to, inverse.move_to)
        {
            step(
                conn,
                "code.moved",
                "code",
                Some(&forward.code_id),
                &format!("Moved “{name}” where {} has it", other.display_name),
                json!({ "codeId": forward.code_id }),
                history::payload(&history::CodeOp::Move {
                    code_id: forward.code_id.clone(),
                    parent_id: parent,
                    index,
                    updated_at: forward.updated_at.clone(),
                }),
                history::payload(&history::CodeOp::Move {
                    code_id: forward.code_id.clone(),
                    parent_id: was_parent,
                    index: was_index,
                    updated_at: inverse.updated_at.clone(),
                }),
                &[],
            )?;
        }
    }

    // ----------------------------------------------------------- excerpts
    if !work.new_excerpts.is_empty() {
        let ids: Vec<String> = work
            .new_excerpts
            .iter()
            .map(|e| e.excerpt.id.clone())
            .collect();
        report.excerpts = ids.len() as i64;
        report.codings += work
            .new_excerpts
            .iter()
            .map(|e| e.tags.len() as i64)
            .sum::<i64>();
        step(
            conn,
            "excerpt.restored",
            "excerpt",
            ids.first().map(String::as_str),
            &format!(
                "Pulled {} excerpt{}",
                ids.len(),
                if ids.len() == 1 { "" } else { "s" }
            ),
            json!({ "from": other.display_name, "count": ids.len() }),
            history::payload(&history::ExcerptChange {
                restore_excerpts: work.new_excerpts.clone(),
                ..Default::default()
            }),
            history::payload(&history::ExcerptChange {
                delete_excerpts: ids.clone(),
                ..Default::default()
            }),
            &[],
        )?;
    }
    if !work.add_tags.is_empty() {
        report.codings += work.add_tags.len() as i64;
        step(
            conn,
            "bulk.codes_added",
            "excerpt",
            work.add_tags.first().map(|t| t.excerpt_id.as_str()),
            &format!(
                "Pulled {} coding{}",
                work.add_tags.len(),
                if work.add_tags.len() == 1 { "" } else { "s" }
            ),
            json!({ "from": other.display_name, "count": work.add_tags.len() }),
            history::payload(&history::ExcerptChange {
                add_tags: work.add_tags.clone(),
                ..Default::default()
            }),
            history::payload(&history::ExcerptChange {
                remove_tags: work.add_tags.clone(),
                ..Default::default()
            }),
            &[],
        )?;
    }

    for (code_id, example, was, updated_at, was_at) in work.code_examples {
        step(
            conn,
            "code.updated",
            "code",
            Some(&code_id),
            &format!(
                "Took {}'s example excerpt for “{}”",
                other.display_name,
                activity::code_name(conn, &code_id)
            ),
            json!({ "codeId": code_id }),
            history::payload(&history::CodeOp::Update {
                code_id: code_id.clone(),
                patch: Box::new(CodePatch {
                    example_excerpt_id: Some(example),
                    ..Default::default()
                }),
                updated_at,
            }),
            history::payload(&history::CodeOp::Update {
                code_id: code_id.clone(),
                patch: Box::new(CodePatch {
                    example_excerpt_id: Some(was),
                    ..Default::default()
                }),
                updated_at: was_at,
            }),
            &[],
        )?;
    }

    // -------------------------------------------------------------- memos
    if !work.memos.is_empty() {
        report.memos = work.memos.len() as i64;
        step(
            conn,
            "memo.created",
            "memo",
            work.memos.first().map(|m| m.id.as_str()),
            &format!(
                "Pulled {} memo{}",
                work.memos.len(),
                if work.memos.len() == 1 { "" } else { "s" }
            ),
            json!({ "from": other.display_name, "count": work.memos.len() }),
            history::payload(&history::MemoChange {
                restore: work.memos.clone(),
                ..Default::default()
            }),
            history::payload(&history::MemoChange {
                delete: work.memos_new.clone(),
                restore: work.memos_before.clone(),
            }),
            &[],
        )?;
    }

    // -------------------------------------------------------- descriptors
    for field in work.new_fields {
        let order: Vec<String> = field_order(conn, Some(&field.id))?;
        let before: Vec<String> = field_order(conn, None)?;
        report.descriptor_fields += 1;
        step(
            conn,
            "descriptor.field_created",
            "descriptor_field",
            Some(&field.id),
            &format!("Pulled the attribute “{}”", field.name),
            json!({ "name": field.name, "from": other.display_name }),
            history::payload(&history::DescriptorOp::Field {
                field: Box::new(field.clone()),
                values: None,
                order,
            }),
            history::payload(&history::DescriptorOp::DropField {
                field_id: field.id.clone(),
                order: before,
            }),
            &[],
        )?;
    }
    for (document_id, field_id, value, was) in work.set_values {
        report.descriptor_values += 1;
        step(
            conn,
            "descriptor.value_set",
            "document",
            Some(&document_id),
            "Pulled a document attribute",
            json!({ "fieldId": field_id, "value": value }),
            history::payload(&history::DescriptorOp::SetValue {
                document_id: document_id.clone(),
                field_id: field_id.clone(),
                value,
            }),
            history::payload(&history::DescriptorOp::SetValue {
                document_id: document_id.clone(),
                field_id: field_id.clone(),
                value: was,
            }),
            &[],
        )?;
    }

    // --------------------------------------------------------------- sets
    for set in work.new_sets {
        report.sets += 1;
        step(
            conn,
            "set.created",
            "set",
            Some(&set.set.id),
            &format!("Pulled the set “{}”", set.set.name),
            json!({ "name": set.set.name, "kind": set.set.kind }),
            history::payload(&history::SetOp::Restore {
                set: Box::new(set.clone()),
            }),
            history::payload(&history::SetOp::Drop {
                set_id: set.set.id.clone(),
            }),
            &[],
        )?;
    }
    for (set_id, members, was, updated_at, was_updated_at) in work.set_members {
        step(
            conn,
            "set.members_changed",
            "set",
            Some(&set_id),
            "Pulled set members",
            json!({ "count": members.len() }),
            history::payload(&history::SetOp::Members {
                set_id: set_id.clone(),
                member_ids: members,
                updated_at,
            }),
            history::payload(&history::SetOp::Members {
                set_id: set_id.clone(),
                member_ids: was,
                updated_at: was_updated_at,
            }),
            &[],
        )?;
    }
    for filter in work.new_filters {
        report.filters += 1;
        step(
            conn,
            "filter.saved",
            "filter",
            Some(&filter.id),
            &format!("Pulled the saved filter “{}”", filter.name),
            json!({ "name": filter.name }),
            history::payload(&history::SetOp::RestoreFilter {
                filter: Box::new(filter.clone()),
            }),
            history::payload(&history::SetOp::DropFilter {
                filter_id: filter.id.clone(),
            }),
            &[],
        )?;
    }

    // ---------------------------------------------------------- framework
    for saved in work.new_matrices {
        report.framework_matrices += 1;
        report.framework_cells += saved.cells.len() as i64;
        step(
            conn,
            "framework.matrix_created",
            "framework_matrix",
            Some(&saved.matrix.id),
            &format!("Pulled the framework matrix “{}”", saved.matrix.name),
            json!({ "name": saved.matrix.name }),
            history::payload(&history::FrameworkOp::Restore {
                saved: Box::new(saved.clone()),
            }),
            history::payload(&history::FrameworkOp::Drop {
                matrix_id: saved.matrix.id.clone(),
            }),
            &[],
        )?;
    }
    for (cell, was, was_at) in work.cells {
        report.framework_cells += 1;
        step(
            conn,
            "framework.cell_set",
            "framework_matrix",
            Some(&cell.matrix_id),
            "Pulled a framework summary",
            json!({ "rowKey": cell.row_key, "codeId": cell.code_id }),
            history::payload(&history::FrameworkOp::Cell {
                matrix_id: cell.matrix_id.clone(),
                row_key: cell.row_key.clone(),
                code_id: cell.code_id.clone(),
                summary: cell.summary.clone(),
                updated_at: cell.updated_at.clone(),
            }),
            history::payload(&history::FrameworkOp::Cell {
                matrix_id: cell.matrix_id.clone(),
                row_key: cell.row_key.clone(),
                code_id: cell.code_id.clone(),
                summary: was,
                updated_at: was_at,
            }),
            &[],
        )?;
    }

    // --------------------------------------------------------- sync point
    let before = sync_point(conn, &other.project_id, &other.coder_id)?;
    let point = SyncPoint {
        other_project_id: other.project_id.clone(),
        other_coder_id: other.coder_id.clone(),
        at: util::now(),
        our_node_id: history::head(conn)?,
        their_node_id: other.head,
        base_json: serde_json::to_string(&base_of(conn)?)?,
    };
    let inverse = match &before {
        Some(p) => history::PullChange {
            sync_points: vec![p.clone()],
            ..Default::default()
        },
        None => history::PullChange {
            drop_sync_points: vec![(other.project_id.clone(), other.coder_id.clone())],
            ..Default::default()
        },
    };
    report.summary = summarize(&report);
    step(
        conn,
        "project.sync_point",
        "project",
        None,
        &format!("Noted where {}'s copy stood", other.display_name),
        json!({
            "otherProjectId": other.project_id,
            "otherCoderId": other.coder_id,
        }),
        history::payload(&history::PullChange {
            sync_points: vec![point],
            ..Default::default()
        }),
        history::payload(&inverse),
        &[],
    )?;
    Ok(report)
}

/// The sentence the history shows for a whole pull.
fn summarize(report: &MergeReport) -> String {
    let mut parts: Vec<String> = vec![];
    let plural = |n: i64, one: &str, many: &str| format!("{n} {}", if n == 1 { one } else { many });
    for (n, one, many) in [
        (report.codings, "coding", "codings"),
        (report.excerpts, "excerpt", "excerpts"),
        (report.codes, "code", "codes"),
        (report.documents, "document", "documents"),
        (report.memos, "memo", "memos"),
    ] {
        if n > 0 {
            parts.push(plural(n, one, many));
        }
    }
    if parts.is_empty() {
        return format!("Pulled from {}'s copy: nothing new", report.other_name);
    }
    format!(
        "Pulled from {}'s copy: {}",
        report.other_name,
        parts.join(", ")
    )
}

/// Every descriptor field id in order, optionally with one appended because
/// it is about to exist.
fn field_order(conn: &Connection, appended: Option<&str>) -> Result<Vec<String>> {
    let mut ids: Vec<String> = conn
        .prepare("SELECT id FROM descriptor_fields ORDER BY sort_order, created_at")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if let Some(id) = appended {
        if !ids.iter().any(|x| x == id) {
            ids.push(id.to_string());
        }
    }
    Ok(ids)
}

fn current_updated_at(conn: &Connection, table: &str, id: &str) -> String {
    conn.query_row(
        &format!("SELECT updated_at FROM {table} WHERE id = ?1"),
        [id],
        |r| r.get::<_, String>(0),
    )
    .unwrap_or_else(|_| util::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::history::tests::{assert_same, dump_state};
    use crate::db::{codes, descriptors, documents, excerpts, memos, sets, OpenProject};
    use crate::models::{ApplyCodesInput, MemoTarget, NewDescriptorField};

    const TEXT: &str = "Alpha beta gamma delta epsilon zeta eta theta iota kappa.";

    /// A project file on disk, signed by one coder.
    fn project(path: &Path, id: &str, name: &str) -> OpenProject {
        let p = OpenProject::create(path, "Study", "test").unwrap();
        super::activity::set_actor(&p.conn, name).unwrap();
        coders::ensure_local(&p.conn, id, name, "").unwrap();
        p
    }

    /// The other researcher's copy: the same file, opened as somebody else.
    fn fork(from: &OpenProject, to: &Path, id: &str, name: &str) -> OpenProject {
        std::fs::copy(&from.path, to).unwrap();
        let p = OpenProject::open(to).unwrap();
        super::activity::set_actor(&p.conn, name).unwrap();
        coders::ensure_local(&p.conn, id, name, "").unwrap();
        p
    }

    fn code_it(conn: &Connection, doc: &str, code: &str, start: i64, end: i64) -> String {
        excerpts::apply_codes(
            conn,
            ApplyCodesInput {
                document_id: doc.to_string(),
                start_pos: Some(start),
                end_pos: Some(end),
                code_ids: vec![code.to_string()],
                ..Default::default()
            },
        )
        .unwrap()
        .excerpt
        .id
    }

    fn codings(conn: &Connection) -> Vec<(String, String)> {
        conn.prepare("SELECT code_id, coder_id FROM excerpt_codes ORDER BY code_id, coder_id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    fn code_named(conn: &Connection, name: &str) -> Option<String> {
        conn.query_row(
            "SELECT id FROM codes WHERE name = ?1 COLLATE NOCASE",
            [name],
            |r| r.get(0),
        )
        .optional()
        .unwrap()
    }

    fn name_of(conn: &Connection, id: &str) -> String {
        conn.query_row("SELECT name FROM codes WHERE id = ?1", [id], |r| r.get(0))
            .unwrap()
    }

    /// Ada's project with one document and one code, and Bob's fork of it.
    struct Pair {
        _dir: tempfile::TempDir,
        ada: OpenProject,
        bob_path: PathBuf,
        doc: String,
        alpha: String,
    }

    impl Pair {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let ada = project(&dir.path().join("study.ada.misket"), "ada", "Ada");
            let doc = documents::create(&ada.conn, documents::tests::new_doc(TEXT))
                .unwrap()
                .summary
                .id;
            let alpha = codes::tests::mk(&ada.conn, "Alpha", None).id;
            let bob_path = dir.path().join("study.bob.misket");
            Self {
                _dir: dir,
                ada,
                bob_path,
                doc,
                alpha,
            }
        }
        /// Open Bob's copy, let `f` work in it, and close it again.
        fn bob(&self, f: impl FnOnce(&OpenProject)) {
            let bob = if self.bob_path.exists() {
                let p = OpenProject::open(&self.bob_path).unwrap();
                super::activity::set_actor(&p.conn, "Bob").unwrap();
                coders::ensure_local(&p.conn, "bob", "Bob", "").unwrap();
                p
            } else {
                fork(&self.ada, &self.bob_path, "bob", "Bob")
            };
            f(&bob);
            drop(bob);
        }
        fn pull(&self) -> MergeReport {
            apply(&self.ada.conn, &self.bob_path, &[]).unwrap()
        }
        fn pull_with(&self, decisions: &[(&str, &str)]) -> MergeReport {
            let decisions: Vec<MergeDecision> = decisions
                .iter()
                .map(|(id, choice)| MergeDecision {
                    conflict_id: (*id).to_string(),
                    choice: (*choice).to_string(),
                })
                .collect();
            apply(&self.ada.conn, &self.bob_path, &decisions).unwrap()
        }
        fn plan(&self) -> MergePlan {
            preview(&self.ada.conn, &self.bob_path).unwrap()
        }
    }

    // ------------------------------------------------------------ the union

    #[test]
    fn disjoint_codings_by_two_coders_are_unioned() {
        let p = Pair::new();
        code_it(&p.ada.conn, &p.doc, &p.alpha, 0, 5);
        let beta = codes::tests::mk(&p.ada.conn, "Beta", None).id;
        p.bob(|bob| {
            code_it(&bob.conn, &p.doc, &p.alpha, 6, 10);
        });

        let plan = p.plan();
        assert!(plan.same_project);
        assert!(plan.first_pull);
        assert_eq!(plan.excerpts.new, 1);
        assert_eq!(plan.codings.new, 1);
        assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
        assert_eq!(
            plan.other_coders
                .iter()
                .find(|c| c.id == "bob")
                .map(|c| c.incoming_count),
            Some(1)
        );

        let report = p.pull();
        assert_eq!(report.codings, 1);
        assert_eq!(report.excerpts, 1);
        assert!(report.summary.contains("Bob"), "{}", report.summary);
        let rows = codings(&p.ada.conn);
        assert_eq!(rows.len(), 2);
        assert!(rows.contains(&(p.alpha.clone(), "ada".into())));
        assert!(rows.contains(&(p.alpha.clone(), "bob".into())));
        // Nothing of ours went away, and Bob's row travelled with his work.
        assert!(codes::get(&p.ada.conn, &beta).is_ok());
        assert_eq!(
            coders::get(&p.ada.conn, "bob").unwrap().unwrap().name,
            "Bob"
        );
    }

    #[test]
    fn the_same_passage_coded_by_both_is_one_excerpt_and_two_codings() {
        let p = Pair::new();
        code_it(&p.ada.conn, &p.doc, &p.alpha, 0, 5);
        p.bob(|bob| {
            code_it(&bob.conn, &p.doc, &p.alpha, 0, 5);
        });
        let plan = p.plan();
        assert_eq!(plan.excerpts.new, 0);
        assert_eq!(plan.excerpts.matched, 1);
        assert_eq!(plan.codings.new, 1);
        p.pull();
        let n: i64 = p
            .ada
            .conn
            .query_row("SELECT count(*) FROM excerpts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        assert_eq!(codings(&p.ada.conn).len(), 2);
    }

    #[test]
    fn a_code_bob_created_is_matched_to_ours_by_name() {
        let p = Pair::new();
        p.bob(|bob| {
            // The copy is taken here, before either of them invents "Trust".
            code_it(&bob.conn, &p.doc, &p.alpha, 0, 5);
        });
        let ours = codes::tests::mk(&p.ada.conn, "Trust", None).id;
        p.bob(|bob| {
            let theirs = codes::tests::mk(&bob.conn, "trust", None).id;
            assert_ne!(theirs, ours);
            code_it(&bob.conn, &p.doc, &theirs, 6, 10);
        });
        let plan = p.plan();
        assert_eq!(plan.codes.by_name, 1, "{:?}", plan.notes);
        assert_eq!(plan.codes.new, 0);
        p.pull();
        // One "Trust", carrying Bob's coding.
        let n: i64 = p
            .ada
            .conn
            .query_row(
                "SELECT count(*) FROM codes WHERE name = 'Trust' COLLATE NOCASE",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
        assert!(codings(&p.ada.conn).contains(&(ours, "bob".to_string())));
    }

    #[test]
    fn a_document_matched_by_hash_takes_their_excerpts_onto_ours() {
        let dir = tempfile::tempdir().unwrap();
        let ada = project(&dir.path().join("a.misket"), "ada", "Ada");
        let our_doc = documents::create(&ada.conn, documents::tests::new_doc(TEXT))
            .unwrap()
            .summary
            .id;
        // A separate project with the same text: same hash, different id.
        let bob_path = dir.path().join("b.misket");
        let their_doc = {
            let bob = project(&bob_path, "bob", "Bob");
            let doc = documents::create(&bob.conn, documents::tests::new_doc(TEXT))
                .unwrap()
                .summary
                .id;
            let code = codes::tests::mk(&bob.conn, "Alpha", None).id;
            code_it(&bob.conn, &doc, &code, 0, 5);
            doc
        };
        assert_ne!(our_doc, their_doc);

        let plan = preview(&ada.conn, &bob_path).unwrap();
        assert!(!plan.same_project, "a different project is flagged");
        assert!(plan.notes.iter().any(|n| n.contains("different project")));
        assert_eq!(plan.documents.by_name, 1);
        assert_eq!(plan.documents.new, 0);
        assert_eq!(plan.excerpts.new, 1);

        apply(&ada.conn, &bob_path, &[]).unwrap();
        let docs: i64 = ada
            .conn
            .query_row("SELECT count(*) FROM documents", [], |r| r.get(0))
            .unwrap();
        assert_eq!(docs, 1, "one document, not two copies of the same text");
        let on: String = ada
            .conn
            .query_row("SELECT document_id FROM excerpts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(on, our_doc, "their excerpt landed on our document");
    }

    // ------------------------------------------------------ three-way rules

    /// A first pull that establishes the base, so the next one has something
    /// to compare against.
    fn with_base() -> Pair {
        let p = Pair::new();
        p.bob(|bob| {
            code_it(&bob.conn, &p.doc, &p.alpha, 0, 5);
        });
        p.pull();
        p
    }

    #[test]
    fn a_rename_only_they_made_comes_over() {
        let p = with_base();
        p.bob(|bob| {
            codes::update(
                &bob.conn,
                &p.alpha,
                CodePatch {
                    name: Some("Alpha renamed".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        });
        let plan = p.plan();
        assert!(!plan.first_pull);
        assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
        p.pull();
        assert_eq!(name_of(&p.ada.conn, &p.alpha), "Alpha renamed");
    }

    #[test]
    fn a_rename_only_we_made_stays_ours() {
        let p = with_base();
        codes::update(
            &p.ada.conn,
            &p.alpha,
            CodePatch {
                name: Some("Ours".into()),
                ..Default::default()
            },
        )
        .unwrap();
        p.bob(|bob| {
            // Bob works, but not on the code's name.
            code_it(&bob.conn, &p.doc, &p.alpha, 6, 10);
        });
        let plan = p.plan();
        assert!(plan.conflicts.is_empty(), "{:?}", plan.conflicts);
        p.pull();
        assert_eq!(name_of(&p.ada.conn, &p.alpha), "Ours");
    }

    #[test]
    fn a_rename_on_both_sides_is_a_conflict_and_both_answers_work() {
        let p = with_base();
        codes::update(
            &p.ada.conn,
            &p.alpha,
            CodePatch {
                name: Some("Ada's name".into()),
                ..Default::default()
            },
        )
        .unwrap();
        p.bob(|bob| {
            codes::update(
                &bob.conn,
                &p.alpha,
                CodePatch {
                    name: Some("Bob's name".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        });
        let plan = p.plan();
        assert_eq!(plan.conflicts.len(), 1, "{:?}", plan.conflicts);
        let c = &plan.conflicts[0];
        assert_eq!(c.kind, "code.scalar");
        assert_eq!(c.default, "ours");
        assert!(c.field.contains("name"), "{}", c.field);
        assert!(c.ours.contains("Ada's name") && c.theirs.contains("Bob's name"));

        // The default answer, first.
        p.pull();
        assert_eq!(name_of(&p.ada.conn, &p.alpha), "Ada's name");
        history::undo(&p.ada.conn).unwrap().unwrap();
        // And the other one.
        p.pull_with(&[(c.id.as_str(), "theirs")]);
        assert_eq!(name_of(&p.ada.conn, &p.alpha), "Bob's name");
    }

    #[test]
    fn a_code_we_deleted_and_they_used_is_a_question_with_two_answers() {
        let p = with_base();
        // Bob keeps using Alpha; Ada decides it was a bad code.
        p.bob(|bob| {
            code_it(&bob.conn, &p.doc, &p.alpha, 6, 10);
        });
        codes::delete(
            &p.ada.conn,
            &p.alpha,
            crate::models::ChildrenStrategy::Delete,
        )
        .unwrap();
        assert!(code_named(&p.ada.conn, "Alpha").is_none());

        let plan = p.plan();
        let c = plan
            .conflicts
            .iter()
            .find(|c| c.kind == "code.deletedHere")
            .unwrap_or_else(|| panic!("no deletion conflict in {:?}", plan.conflicts));
        assert_eq!(c.default, "restore");

        p.pull_with(&[(c.id.as_str(), "restore")]);
        let back = code_named(&p.ada.conn, "Alpha").expect("the code came back");
        assert!(codings(&p.ada.conn)
            .iter()
            .any(|(code, coder)| *code == back && coder == "bob"));

        history::undo(&p.ada.conn).unwrap().unwrap();
        assert!(code_named(&p.ada.conn, "Alpha").is_none());

        p.pull_with(&[(c.id.as_str(), "drop")]);
        assert!(code_named(&p.ada.conn, "Alpha").is_none());
        assert!(
            codings(&p.ada.conn).is_empty(),
            "their codings of it were dropped too"
        );
    }

    #[test]
    fn a_memo_edited_on_both_sides_can_be_kept_twice() {
        let p = with_base();
        let memo = memos::create(
            &p.ada.conn,
            MemoTarget {
                code_id: Some(p.alpha.clone()),
                ..Default::default()
            },
            "Why Alpha",
            "First thoughts.",
        )
        .unwrap()
        .id;
        // Bob has to have it before he can edit it, and a pull only ever
        // writes to the file that asked for it — so Bob pulls from Ada.
        p.bob(|bob| {
            apply(&bob.conn, &p.ada.path, &[]).unwrap();
            assert!(memos::get(&bob.conn, &memo).is_ok());
        });
        // And Ada pulls back, which moves her base past the memo.
        p.pull();
        p.bob(|bob| {
            memos::update(&bob.conn, &memo, "Why Alpha", "Bob disagrees.").unwrap();
        });
        memos::update(&p.ada.conn, &memo, "Why Alpha", "Ada elaborates.").unwrap();

        let plan = p.plan();
        let c = plan
            .conflicts
            .iter()
            .find(|c| c.kind == "memo")
            .unwrap_or_else(|| panic!("no memo conflict in {:?}", plan.conflicts));
        assert_eq!(c.default, "both");

        p.pull();
        let bodies: Vec<String> = p
            .ada
            .conn
            .prepare("SELECT body FROM memos ORDER BY body")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(bodies, vec!["Ada elaborates.", "Bob disagrees."]);

        history::undo(&p.ada.conn).unwrap().unwrap();
        p.pull_with(&[(c.id.as_str(), "theirs")]);
        let body: String = p
            .ada
            .conn
            .query_row("SELECT body FROM memos", [], |r| r.get(0))
            .unwrap();
        assert_eq!(body, "Bob disagrees.");
    }

    #[test]
    fn a_second_pull_brings_only_what_is_new_and_asks_nothing_twice() {
        let p = with_base();
        let first = p.plan();
        assert!(
            first.is_empty(),
            "the copy has nothing new left: {first:#?}"
        );
        let report = p.pull();
        assert_eq!(report.codings, 0);
        assert_eq!(report.summary, "Pulled from Bob's copy: nothing new");

        p.bob(|bob| {
            code_it(&bob.conn, &p.doc, &p.alpha, 17, 22);
        });
        let plan = p.plan();
        assert_eq!(plan.codings.new, 1);
        assert_eq!(plan.excerpts.new, 1);
        assert!(plan.conflicts.is_empty());
        let report = p.pull();
        assert_eq!(report.codings, 1);
        // And a third pull has nothing to do.
        assert!(p.plan().is_empty());
    }

    // ----------------------------------------------------------------- undo

    #[test]
    fn a_whole_pull_undoes_and_redoes_in_one_step() {
        let p = Pair::new();
        code_it(&p.ada.conn, &p.doc, &p.alpha, 0, 5);
        let field = descriptors::create_field(
            &p.ada.conn,
            NewDescriptorField {
                name: "Site".into(),
                kind: "text".into(),
                options: None,
            },
        )
        .unwrap()
        .id;
        p.bob(|bob| {
            let gamma = codes::tests::mk(&bob.conn, "Gamma", None).id;
            let child = codes::tests::mk(&bob.conn, "Gamma detail", Some(&gamma)).id;
            code_it(&bob.conn, &p.doc, &gamma, 6, 10);
            code_it(&bob.conn, &p.doc, &child, 11, 16);
            code_it(&bob.conn, &p.doc, &p.alpha, 0, 5);
            let their_doc = documents::create(
                &bob.conn,
                documents::tests::new_doc("A second interview, only Bob has it."),
            )
            .unwrap()
            .summary
            .id;
            code_it(&bob.conn, &their_doc, &gamma, 2, 8);
            descriptors::set_value(&bob.conn, &their_doc, &field, Some("Ward B")).unwrap();
            memos::create(
                &bob.conn,
                MemoTarget {
                    code_id: Some(gamma.clone()),
                    ..Default::default()
                },
                "Gamma",
                "Bob's note.",
            )
            .unwrap();
            sets::create_set(
                &bob.conn,
                "code",
                "Round 1",
                std::slice::from_ref(&gamma),
                None,
            )
            .unwrap();
            sets::save_filter(
                &bob.conn,
                "Bob's filter",
                &crate::models::ExcerptFilter::default(),
            )
            .unwrap();
        });

        let before = dump_state(&p.ada.conn);
        let report = p.pull();
        assert!(report.documents == 1 && report.codes == 2 && report.memos == 1);
        let after = dump_state(&p.ada.conn);
        assert_ne!(before, after);

        let undone = history::undo(&p.ada.conn).unwrap().unwrap();
        assert_same(&before, &dump_state(&p.ada.conn), "pull: undo");
        let redone = history::redo(&p.ada.conn, None).unwrap().unwrap();
        assert_same(&after, &dump_state(&p.ada.conn), "pull: redo");
        assert_eq!(undone.id, redone.id, "one step, not many");
        assert_eq!(undone.kind, "project.pulled");
        assert!(undone.summary.contains("Bob"), "{}", undone.summary);
    }

    // ----------------------------------------------------------- refusals

    #[test]
    fn pulling_this_very_file_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("study.misket");
        let ada = project(&path, "ada", "Ada");
        let err = preview(&ada.conn, &path).unwrap_err();
        assert!(
            matches!(&err, AppError::Validation(m) if m.contains("this project")),
            "{err:?}"
        );
        let missing = dir.path().join("nope.misket");
        assert!(matches!(
            preview(&ada.conn, &missing).unwrap_err(),
            AppError::NotFound(_)
        ));
    }

    #[test]
    fn a_newer_or_older_schema_is_refused_rather_than_migrated() {
        let p = Pair::new();
        p.bob(|bob| {
            code_it(&bob.conn, &p.doc, &p.alpha, 0, 5);
        });
        let latest = migrations::latest_version();

        {
            let bob = Connection::open(&p.bob_path).unwrap();
            bob.execute_batch(&format!("PRAGMA user_version = {}", latest + 1))
                .unwrap();
        }
        match preview(&p.ada.conn, &p.bob_path).unwrap_err() {
            AppError::NewerSchema(v) => assert_eq!(v, latest + 1),
            e => panic!("{e:?}"),
        }

        {
            let bob = Connection::open(&p.bob_path).unwrap();
            bob.execute_batch(&format!("PRAGMA user_version = {}", latest - 1))
                .unwrap();
        }
        let err = preview(&p.ada.conn, &p.bob_path).unwrap_err();
        assert!(
            matches!(&err, AppError::Validation(m) if m.contains("older version")),
            "{err:?}"
        );
        // And their file is untouched: we never migrated it.
        let still = Connection::open(&p.bob_path).unwrap();
        let v: i64 = still
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, latest - 1);
    }

    #[test]
    fn a_pull_never_writes_to_the_other_file() {
        let p = Pair::new();
        code_it(&p.ada.conn, &p.doc, &p.alpha, 0, 5);
        p.bob(|bob| {
            code_it(&bob.conn, &p.doc, &p.alpha, 6, 10);
        });
        let before = std::fs::read(&p.bob_path).unwrap();
        p.pull();
        assert_eq!(
            before,
            std::fs::read(&p.bob_path).unwrap(),
            "their file is byte-for-byte what it was"
        );
    }

    #[test]
    fn their_coder_is_whoever_last_signed_their_history() {
        let p = Pair::new();
        p.bob(|bob| {
            code_it(&bob.conn, &p.doc, &p.alpha, 0, 5);
            assert_eq!(their_coder(&bob.conn).unwrap(), "bob");
        });
        p.pull();
        let points = sync_points(&p.ada.conn).unwrap();
        assert_eq!(points.len(), 1);
        assert_eq!(points[0].other_coder_id, "bob");
        assert!(points[0].their_node_id.is_some());
        assert!(!points[0].base_json.is_empty());
    }
}
