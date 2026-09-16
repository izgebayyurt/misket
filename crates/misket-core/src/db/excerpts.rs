//! Excerpts: coded ranges of a document. Text ranges and image regions share
//! this table; video ranges will reuse it too.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::{codes, descriptors, documents, memos, sets, text, util};
use crate::error::{AppError, Result};
use crate::models::{
    ApplyCodesInput, ApplyResult, DescriptorFilter, ExcerptDetail, ExcerptFilter, ExcerptPage,
    ExcerptRow, ExcerptSnapshot, ExcerptWithCodes, MergeResult, Rect,
};

const CONTEXT_CHARS: i64 = 120;

/// Slack allowed when a region is checked against the image bounds: the UI
/// works in device pixels, so a millionth of the width is far below one pixel.
const GEOMETRY_EPSILON: f64 = 1e-6;

const COLUMNS: &str = "e.id, e.document_id, e.kind, e.start_pos, e.end_pos, e.geometry, e.snapshot,
     (SELECT count(*) FROM memos m WHERE m.excerpt_id = e.id) AS memo_count,
     e.created_at, e.updated_at";

fn from_row(r: &Row) -> rusqlite::Result<ExcerptWithCodes> {
    Ok(ExcerptWithCodes {
        id: r.get(0)?,
        document_id: r.get(1)?,
        kind: r.get(2)?,
        start_pos: r.get(3)?,
        end_pos: r.get(4)?,
        geometry: r.get(5)?,
        snapshot: r.get(6)?,
        code_ids: vec![],
        memo_count: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

fn code_ids_for(conn: &Connection, excerpt_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT ec.code_id FROM excerpt_codes ec JOIN codes c ON c.id = ec.code_id
         WHERE ec.excerpt_id = ?1 ORDER BY c.sort_order, c.name",
    )?;
    let ids = stmt
        .query_map([excerpt_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids)
}

/// Fill `code_ids` for a batch of excerpts with one query.
fn attach_codes(conn: &Connection, excerpts: &mut [ExcerptWithCodes]) -> Result<()> {
    if excerpts.is_empty() {
        return Ok(());
    }
    let mut stmt = conn.prepare(
        "SELECT ec.excerpt_id, ec.code_id FROM excerpt_codes ec JOIN codes c ON c.id = ec.code_id
         ORDER BY c.sort_order, c.name",
    )?;
    let pairs: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut by_excerpt: std::collections::HashMap<String, Vec<String>> = Default::default();
    for (eid, cid) in pairs {
        by_excerpt.entry(eid).or_default().push(cid);
    }
    for e in excerpts.iter_mut() {
        if let Some(ids) = by_excerpt.remove(&e.id) {
            e.code_ids = ids;
        }
    }
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> Result<ExcerptWithCodes> {
    let mut e = conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM excerpts e WHERE e.id = ?1"),
            [id],
            from_row,
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("excerpt {id} not found")))?;
    e.code_ids = code_ids_for(conn, id)?;
    Ok(e)
}

pub fn list_for_document(conn: &Connection, document_id: &str) -> Result<Vec<ExcerptWithCodes>> {
    documents::get_summary(conn, document_id)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM excerpts e WHERE e.document_id = ?1
         ORDER BY e.start_pos, e.end_pos, e.created_at, e.id"
    ))?;
    let mut rows: Vec<ExcerptWithCodes> = stmt
        .query_map([document_id], from_row)?
        .collect::<rusqlite::Result<_>>()?;
    attach_codes(conn, &mut rows)?;
    Ok(rows)
}

fn ensure_codes_exist(conn: &Connection, code_ids: &[String]) -> Result<()> {
    for id in code_ids {
        codes::get(conn, id)?;
    }
    Ok(())
}

/// Validate and canonicalize an image region.
///
/// Rectangles are stored rounded to six decimals so that two drags of the
/// same region produce byte-identical JSON, which is what makes the partial
/// unique index on `(document_id, geometry)` behave like the text one.
pub fn canonical_geometry(rect: &Rect) -> Result<String> {
    let round = |v: f64| (v * 1e6).round() / 1e6;
    let invalid = || {
        AppError::Validation(format!(
            "region ({}, {}) {}×{} is not inside the image: x and y must be ≥ 0, \
             width and height > 0, and the rectangle must stay within 1×1",
            rect.x, rect.y, rect.w, rect.h
        ))
    };
    if ![rect.x, rect.y, rect.w, rect.h]
        .iter()
        .all(|v| v.is_finite())
    {
        return Err(invalid());
    }
    let r = Rect {
        x: round(rect.x),
        y: round(rect.y),
        w: round(rect.w),
        h: round(rect.h),
    };
    if r.x < 0.0
        || r.y < 0.0
        || r.w <= 0.0
        || r.h <= 0.0
        || r.x + r.w > 1.0 + GEOMETRY_EPSILON
        || r.y + r.h > 1.0 + GEOMETRY_EPSILON
    {
        return Err(invalid());
    }
    Ok(serde_json::to_string(&r)?)
}

/// A short human-readable stand-in for the excerpted pixels, so the excerpt
/// browser, the exports and the memo lists always have something to show.
pub fn region_snapshot(rect: &Rect) -> String {
    let pct = |v: f64| (v * 100.0).round() as i64;
    format!(
        "region {}%×{}% at ({}%, {}%)",
        pct(rect.w),
        pct(rect.h),
        pct(rect.x),
        pct(rect.y)
    )
}

/// What `apply_codes` is about to code: a text range or an image region.
enum Target {
    Text {
        start: i64,
        end: i64,
        snapshot: String,
    },
    Region {
        geometry: String,
        snapshot: String,
    },
}

/// Create the excerpt for this exact range or region if needed, then attach
/// codes. `input.kind` defaults to `text`; `image_region` carries a geometry
/// instead of offsets and upserts on the exact same rectangle.
pub fn apply_codes(conn: &Connection, input: ApplyCodesInput) -> Result<ApplyResult> {
    let kind = input.kind.as_deref().unwrap_or("text");
    let target = match kind {
        "text" => {
            let (doc_text, len) = documents::get_text(conn, &input.document_id)?;
            let (start, end) = match (input.start_pos, input.end_pos) {
                (Some(s), Some(e)) => (s, e),
                _ => {
                    return Err(AppError::Validation(
                        "a text excerpt needs a start and an end".into(),
                    ))
                }
            };
            if start < 0 || end <= start || end > len {
                return Err(AppError::Validation(format!(
                    "range {start}..{end} is outside the document (length {len})"
                )));
            }
            let snapshot = text::cp_slice(&doc_text, start, end)
                .ok_or_else(|| AppError::Validation("invalid range".into()))?
                .to_string();
            Target::Text {
                start,
                end,
                snapshot,
            }
        }
        "image_region" => {
            let doc = documents::get_summary(conn, &input.document_id)?;
            if doc.kind != "image" {
                return Err(AppError::Validation(format!(
                    "{:?} is not an image document",
                    doc.name
                )));
            }
            let rect = input
                .geometry
                .ok_or_else(|| AppError::Validation("an image excerpt needs a region".into()))?;
            Target::Region {
                geometry: canonical_geometry(&rect)?,
                snapshot: region_snapshot(&rect),
            }
        }
        other => {
            return Err(AppError::Validation(format!(
                "unknown excerpt kind {other:?}"
            )))
        }
    };
    ensure_codes_exist(conn, &input.code_ids)?;
    let tx = conn.unchecked_transaction()?;
    let now = util::now();
    let (id, created) = match &target {
        Target::Text {
            start,
            end,
            snapshot,
        } => {
            let existing: Option<String> = tx
                .query_row(
                    "SELECT id FROM excerpts WHERE document_id = ?1 AND kind = 'text' AND start_pos = ?2 AND end_pos = ?3",
                    params![input.document_id, start, end],
                    |r| r.get(0),
                )
                .optional()?;
            match existing {
                Some(id) => (id, false),
                None => {
                    let id = util::new_id();
                    tx.execute(
                        "INSERT INTO excerpts (id, document_id, kind, start_pos, end_pos, snapshot, created_at, updated_at)
                         VALUES (?1, ?2, 'text', ?3, ?4, ?5, ?6, ?6)",
                        params![id, input.document_id, start, end, snapshot, now],
                    )?;
                    (id, true)
                }
            }
        }
        Target::Region { geometry, snapshot } => {
            let existing: Option<String> = tx
                .query_row(
                    "SELECT id FROM excerpts WHERE document_id = ?1 AND kind = 'image_region' AND geometry = ?2",
                    params![input.document_id, geometry],
                    |r| r.get(0),
                )
                .optional()?;
            match existing {
                Some(id) => (id, false),
                None => {
                    let id = util::new_id();
                    tx.execute(
                        "INSERT INTO excerpts (id, document_id, kind, geometry, snapshot, created_at, updated_at)
                         VALUES (?1, ?2, 'image_region', ?3, ?4, ?5, ?5)",
                        params![id, input.document_id, geometry, snapshot, now],
                    )?;
                    (id, true)
                }
            }
        }
    };
    let mut added = vec![];
    for code_id in &input.code_ids {
        let n = tx.execute(
            "INSERT OR IGNORE INTO excerpt_codes (excerpt_id, code_id, created_at) VALUES (?1, ?2, ?3)",
            params![id, code_id, now],
        )?;
        if n > 0 {
            added.push(code_id.clone());
        }
    }
    if !added.is_empty() && !created {
        tx.execute(
            "UPDATE excerpts SET updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
    }
    tx.commit()?;
    Ok(ApplyResult {
        excerpt: get(conn, &id)?,
        created,
        added_code_ids: added,
    })
}

pub fn add_codes(conn: &Connection, id: &str, code_ids: &[String]) -> Result<ExcerptWithCodes> {
    get(conn, id)?;
    ensure_codes_exist(conn, code_ids)?;
    let now = util::now();
    let tx = conn.unchecked_transaction()?;
    for code_id in code_ids {
        tx.execute(
            "INSERT OR IGNORE INTO excerpt_codes (excerpt_id, code_id, created_at) VALUES (?1, ?2, ?3)",
            params![id, code_id, now],
        )?;
    }
    tx.execute(
        "UPDATE excerpts SET updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    tx.commit()?;
    get(conn, id)
}

pub fn remove_code(conn: &Connection, id: &str, code_id: &str) -> Result<ExcerptWithCodes> {
    get(conn, id)?;
    conn.execute(
        "DELETE FROM excerpt_codes WHERE excerpt_id = ?1 AND code_id = ?2",
        params![id, code_id],
    )?;
    conn.execute(
        "UPDATE excerpts SET updated_at = ?2 WHERE id = ?1",
        params![id, util::now()],
    )?;
    get(conn, id)
}

/// Delete an excerpt and return everything needed to restore it.
pub fn delete(conn: &Connection, id: &str) -> Result<ExcerptSnapshot> {
    let excerpt = get(conn, id)?;
    let memos = memos::list_for_excerpt(conn, id)?;
    conn.execute("DELETE FROM excerpts WHERE id = ?1", [id])?;
    Ok(ExcerptSnapshot { excerpt, memos })
}

/// Reinsert a deleted excerpt with its original ids (for undo). Memos that
/// still exist (because a merge moved them to another excerpt) are moved back.
pub fn restore(conn: &Connection, snapshot: &ExcerptSnapshot) -> Result<ExcerptWithCodes> {
    let e = &snapshot.excerpt;
    documents::get_summary(conn, &e.document_id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO excerpts (id, document_id, kind, start_pos, end_pos, geometry, snapshot, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            e.id,
            e.document_id,
            e.kind,
            e.start_pos,
            e.end_pos,
            e.geometry,
            e.snapshot,
            e.created_at,
            e.updated_at
        ],
    )
    .map_err(|err| {
        if err.to_string().contains("UNIQUE") {
            AppError::Conflict(if e.kind == "image_region" {
                "an excerpt for this region already exists".into()
            } else {
                "an excerpt with this range already exists".to_string()
            })
        } else {
            AppError::from(err)
        }
    })?;
    for code_id in &e.code_ids {
        // Codes deleted in the meantime are silently dropped.
        tx.execute(
            "INSERT OR IGNORE INTO excerpt_codes (excerpt_id, code_id, created_at)
             SELECT ?1, id, ?3 FROM codes WHERE id = ?2",
            params![e.id, code_id, e.updated_at],
        )?;
    }
    for m in &snapshot.memos {
        // `ON CONFLICT` covers undoing a merge: the memos were re-pointed to
        // the survivor rather than deleted, so they are moved back here.
        tx.execute(
            "INSERT INTO memos (id, excerpt_id, title, body, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               excerpt_id = excluded.excerpt_id, title = excluded.title,
               body = excluded.body, updated_at = excluded.updated_at",
            params![m.id, e.id, m.title, m.body, m.created_at, m.updated_at],
        )?;
    }
    tx.commit()?;
    get(conn, &e.id)
}

/// The `[start, end)` range of a text excerpt, or a `Validation` error for
/// image regions and video ranges.
fn text_range(e: &ExcerptWithCodes) -> Result<(i64, i64)> {
    match (e.kind.as_str(), e.start_pos, e.end_pos) {
        ("text", Some(s), Some(end)) => Ok((s, end)),
        _ => Err(AppError::Validation(format!(
            "excerpt {} is not a text range",
            e.id
        ))),
    }
}

fn check_range(start: i64, end: i64, len: i64) -> Result<()> {
    if start < 0 || end <= start || end > len {
        return Err(AppError::Validation(format!(
            "range {start}..{end} is outside the document (length {len})"
        )));
    }
    Ok(())
}

/// Is `[start, end)` already taken by a text excerpt other than `except`?
/// The unique index `excerpts_text_range_uq` allows one text excerpt per exact
/// range, so an occupied range is a `Conflict` rather than a silent merge.
fn range_taken(
    conn: &Connection,
    document_id: &str,
    start: i64,
    end: i64,
    except: &[&str],
) -> Result<bool> {
    let id: Option<String> = conn
        .query_row(
            "SELECT id FROM excerpts
             WHERE document_id = ?1 AND kind = 'text' AND start_pos = ?2 AND end_pos = ?3",
            params![document_id, start, end],
            |r| r.get(0),
        )
        .optional()?;
    Ok(match id {
        Some(id) => !except.contains(&id.as_str()),
        None => false,
    })
}

fn snapshot_of(doc_text: &str, start: i64, end: i64) -> Result<String> {
    text::cp_slice(doc_text, start, end)
        .map(str::to_string)
        .ok_or_else(|| AppError::Validation(format!("range {start}..{end} is not sliceable")))
}

/// Move a text excerpt's boundaries, recomputing its snapshot from the
/// document text. Codes and memos stay where they are, so undo is another
/// `update_range` back to the old offsets.
pub fn update_range(
    conn: &Connection,
    id: &str,
    start_pos: i64,
    end_pos: i64,
) -> Result<ExcerptWithCodes> {
    let excerpt = get(conn, id)?;
    text_range(&excerpt)?;
    let (doc_text, len) = documents::get_text(conn, &excerpt.document_id)?;
    check_range(start_pos, end_pos, len)?;
    if range_taken(conn, &excerpt.document_id, start_pos, end_pos, &[id])? {
        return Err(AppError::Conflict(
            "another excerpt already covers exactly this range".into(),
        ));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE excerpts SET start_pos = ?2, end_pos = ?3, snapshot = ?4, updated_at = ?5
         WHERE id = ?1",
        params![
            id,
            start_pos,
            end_pos,
            snapshot_of(&doc_text, start_pos, end_pos)?,
            util::now()
        ],
    )?;
    tx.commit()?;
    get(conn, id)
}

/// Split a text excerpt at code point `at` into `[start, at)` and `[at, end)`.
/// The left half keeps the original id (and its memos); the right half is a
/// new excerpt carrying the same codes. Inverted by `merge_adjacent`.
pub fn split(conn: &Connection, id: &str, at: i64) -> Result<(ExcerptWithCodes, ExcerptWithCodes)> {
    let excerpt = get(conn, id)?;
    let (start, end) = text_range(&excerpt)?;
    if at <= start || at >= end {
        return Err(AppError::Validation(format!(
            "split point {at} is not inside {start}..{end}"
        )));
    }
    let (doc_text, _) = documents::get_text(conn, &excerpt.document_id)?;
    for (s, e) in [(start, at), (at, end)] {
        if range_taken(conn, &excerpt.document_id, s, e, &[id])? {
            return Err(AppError::Conflict(
                "one half of the split is already covered by another excerpt".into(),
            ));
        }
    }
    let now = util::now();
    let right_id = util::new_id();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE excerpts SET end_pos = ?2, snapshot = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, at, snapshot_of(&doc_text, start, at)?, now],
    )?;
    tx.execute(
        "INSERT INTO excerpts (id, document_id, kind, start_pos, end_pos, snapshot, created_at, updated_at)
         VALUES (?1, ?2, 'text', ?3, ?4, ?5, ?6, ?6)",
        params![
            right_id,
            excerpt.document_id,
            at,
            end,
            snapshot_of(&doc_text, at, end)?,
            now
        ],
    )?;
    for code_id in &excerpt.code_ids {
        tx.execute(
            "INSERT OR IGNORE INTO excerpt_codes (excerpt_id, code_id, created_at) VALUES (?1, ?2, ?3)",
            params![right_id, code_id, now],
        )?;
    }
    tx.commit()?;
    Ok((get(conn, id)?, get(conn, &right_id)?))
}

/// Merge two touching or overlapping text excerpts of one document into
/// `[min start, max end)`. `left_id` survives with the union of both code
/// sets and both memo sets; `right_id` is deleted. The returned
/// [`MergeResult`] carries everything needed to invert this.
pub fn merge_adjacent(conn: &Connection, left_id: &str, right_id: &str) -> Result<MergeResult> {
    if left_id == right_id {
        return Err(AppError::Validation(
            "an excerpt cannot be merged with itself".into(),
        ));
    }
    let left = get(conn, left_id)?;
    let right = get(conn, right_id)?;
    if left.document_id != right.document_id {
        return Err(AppError::Validation(
            "excerpts from different documents cannot be merged".into(),
        ));
    }
    let (ls, le) = text_range(&left)?;
    let (rs, re) = text_range(&right)?;
    if ls > re || rs > le {
        return Err(AppError::Validation(
            "the excerpts neither touch nor overlap".into(),
        ));
    }
    let (start, end) = (ls.min(rs), le.max(re));
    let (doc_text, len) = documents::get_text(conn, &left.document_id)?;
    check_range(start, end, len)?;
    if range_taken(conn, &left.document_id, start, end, &[left_id, right_id])? {
        return Err(AppError::Conflict(
            "another excerpt already covers exactly the merged range".into(),
        ));
    }
    let removed = ExcerptSnapshot {
        excerpt: right.clone(),
        memos: memos::list_for_excerpt(conn, right_id)?,
    };
    let added: Vec<String> = right
        .code_ids
        .iter()
        .filter(|c| !left.code_ids.contains(c))
        .cloned()
        .collect();
    let now = util::now();
    let tx = conn.unchecked_transaction()?;
    // Memos move to the survivor before the row goes, so nothing cascades away.
    tx.execute(
        "UPDATE memos SET excerpt_id = ?1, updated_at = ?3 WHERE excerpt_id = ?2",
        params![left_id, right_id, now],
    )?;
    tx.execute("DELETE FROM excerpts WHERE id = ?1", [right_id])?;
    for code_id in &added {
        tx.execute(
            "INSERT OR IGNORE INTO excerpt_codes (excerpt_id, code_id, created_at) VALUES (?1, ?2, ?3)",
            params![left_id, code_id, now],
        )?;
    }
    tx.execute(
        "UPDATE excerpts SET start_pos = ?2, end_pos = ?3, snapshot = ?4, updated_at = ?5
         WHERE id = ?1",
        params![
            left_id,
            start,
            end,
            snapshot_of(&doc_text, start, end)?,
            now
        ],
    )?;
    tx.commit()?;
    Ok(MergeResult {
        excerpt: get(conn, left_id)?,
        removed,
        previous_start_pos: ls,
        previous_end_pos: le,
        added_code_ids: added,
    })
}

fn context(doc_text: &str, start: i64, end: i64) -> (String, String) {
    let before_start = (start - CONTEXT_CHARS).max(0);
    let before = text::cp_slice(doc_text, before_start, start).unwrap_or("");
    let total = text::cp_len(doc_text);
    let after = text::cp_slice(doc_text, end, (end + CONTEXT_CHARS).min(total)).unwrap_or("");
    (before.replace('\n', " "), after.replace('\n', " "))
}

pub fn detail(conn: &Connection, id: &str) -> Result<ExcerptDetail> {
    let excerpt = get(conn, id)?;
    let doc = documents::get(conn, &excerpt.document_id)?;
    let (context_before, context_after) = match (excerpt.start_pos, excerpt.end_pos, &doc.text) {
        (Some(s), Some(e), Some(t)) if excerpt.kind == "text" => context(t, s, e),
        _ => (String::new(), String::new()),
    };
    Ok(ExcerptDetail {
        excerpt,
        document_name: doc.summary.name,
        context_before,
        context_after,
        memos: memos::list_for_excerpt(conn, id)?,
    })
}

/// Turn one descriptor condition into an EXISTS / NOT EXISTS subquery over
/// `descriptor_values`, joined to the excerpt through its document.
///
/// Number fields are compared with `CAST(value AS REAL)`; every other kind
/// compares as text (choice and date values are stored canonically, so plain
/// string comparison is the right order for dates too).
fn descriptor_clause(
    conn: &Connection,
    cond: &DescriptorFilter,
) -> Result<(String, Vec<rusqlite::types::Value>)> {
    use rusqlite::types::Value;

    let field = descriptors::get_field(conn, &cond.field_id)?;
    let numeric = field.kind == "number";
    let lhs = if numeric {
        "CAST(dv.value AS REAL)"
    } else {
        "dv.value COLLATE NOCASE"
    };
    let operand = |raw: &str| -> Result<Value> {
        let canonical = descriptors::canonical_value(&field, raw)?;
        Ok(if numeric {
            Value::Real(canonical.parse::<f64>().unwrap_or_default())
        } else {
            Value::from(canonical)
        })
    };
    let need = |n: usize| -> Result<()> {
        if cond.values.len() < n {
            return Err(AppError::Validation(format!(
                "the {:?} filter on {:?} needs {n} value{}",
                cond.op,
                field.name,
                if n == 1 { "" } else { "s" }
            )));
        }
        Ok(())
    };

    let mut args = vec![Value::from(field.id.clone())];
    let (negate, predicate) = match cond.op.as_str() {
        "empty" => (true, String::new()),
        "notEmpty" => (false, String::new()),
        "eq" | "neq" => {
            need(1)?;
            args.push(operand(&cond.values[0])?);
            (cond.op == "neq", format!(" AND {lhs} = ?"))
        }
        "contains" => {
            need(1)?;
            args.push(Value::from(cond.values[0].trim().to_string()));
            (
                false,
                " AND instr(lower(dv.value), lower(?)) > 0".to_string(),
            )
        }
        "gt" | "lt" => {
            need(1)?;
            args.push(operand(&cond.values[0])?);
            let op = if cond.op == "gt" { ">" } else { "<" };
            (false, format!(" AND {lhs} {op} ?"))
        }
        "between" => {
            need(2)?;
            args.push(operand(&cond.values[0])?);
            args.push(operand(&cond.values[1])?);
            (false, format!(" AND {lhs} BETWEEN ? AND ?"))
        }
        "in" => {
            need(1)?;
            for v in &cond.values {
                args.push(operand(v)?);
            }
            let ph = cond
                .values
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");
            (false, format!(" AND {lhs} IN ({ph})"))
        }
        other => {
            return Err(AppError::Validation(format!(
                "unknown descriptor operator {other:?}"
            )))
        }
    };
    let exists = if negate { "NOT EXISTS" } else { "EXISTS" };
    Ok((
        format!(
            "{exists} (SELECT 1 FROM descriptor_values dv
                WHERE dv.document_id = e.document_id AND dv.field_id = ?{predicate})"
        ),
        args,
    ))
}

/// Query excerpts across the project with code/document filters and paging.
pub fn query(conn: &Connection, filter: &ExcerptFilter) -> Result<ExcerptPage> {
    let mut where_clauses = vec!["1 = 1".to_string()];
    let mut args: Vec<rusqlite::types::Value> = vec![];

    // A code set stands for all of its codes, so it is simply unioned into the
    // picked code ids before anything else looks at them; the same for
    // document sets and document ids.
    let code_sets = filter.code_set_ids.as_deref().unwrap_or_default();
    let code_ids = sets::union_with_sets(conn, filter.code_ids.as_deref(), code_sets)?;
    let wants_codes = !code_ids.is_empty() || !code_sets.is_empty();
    if wants_codes {
        if code_ids.is_empty() {
            // Only empty or unknown sets were picked: nothing can match.
            where_clauses.push("0 = 1".into());
        } else {
            // Any of the listed codes by default; with `require_all_codes`
            // every one of them must be present, each still standing for its
            // whole subtree when descendants are included.
            let groups: Vec<Vec<String>> = if filter.require_all_codes {
                code_ids.iter().map(|id| vec![id.clone()]).collect()
            } else {
                vec![code_ids.clone()]
            };
            for group in groups {
                let ids = if filter.include_descendants {
                    codes::descendant_ids(conn, &group)?
                } else {
                    group
                };
                if ids.is_empty() {
                    // Only unknown code ids: nothing can match.
                    where_clauses.push("0 = 1".into());
                    continue;
                }
                let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                where_clauses.push(format!(
                    "e.id IN (SELECT excerpt_id FROM excerpt_codes WHERE code_id IN ({ph}))"
                ));
                args.extend(ids.into_iter().map(rusqlite::types::Value::from));
            }
        }
    }
    let doc_sets = filter.document_set_ids.as_deref().unwrap_or_default();
    let doc_ids = sets::union_with_sets(conn, filter.document_ids.as_deref(), doc_sets)?;
    if !doc_ids.is_empty() || !doc_sets.is_empty() {
        if doc_ids.is_empty() {
            where_clauses.push("0 = 1".into());
        } else {
            let ph = doc_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            where_clauses.push(format!("e.document_id IN ({ph})"));
            args.extend(doc_ids.into_iter().map(rusqlite::types::Value::from));
        }
    }
    if filter.uncoded_only {
        where_clauses
            .push("NOT EXISTS (SELECT 1 FROM excerpt_codes ec WHERE ec.excerpt_id = e.id)".into());
    }
    if let Some(other_code) = &filter.overlaps_code_id {
        // Only text excerpts overlap in this sense (`co_occurrence` never
        // counts image regions), so an image excerpt can never match.
        let ids = if filter.include_descendants {
            codes::descendant_ids(conn, std::slice::from_ref(other_code))?
        } else {
            vec![other_code.clone()]
        };
        if ids.is_empty() {
            where_clauses.push("0 = 1".into());
        } else {
            let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            where_clauses.push(format!(
                "e.kind = 'text' AND EXISTS (
                    SELECT 1 FROM excerpts o
                    JOIN excerpt_codes oc ON oc.excerpt_id = o.id
                    WHERE o.document_id = e.document_id AND o.kind = 'text'
                      AND o.start_pos < e.end_pos AND e.start_pos < o.end_pos
                      AND oc.code_id IN ({ph})
                )"
            ));
            args.extend(ids.into_iter().map(rusqlite::types::Value::from));
        }
    }
    for cond in filter.descriptors.iter().flatten() {
        let (sql, cond_args) = descriptor_clause(conn, cond)?;
        where_clauses.push(sql);
        args.extend(cond_args);
    }
    let where_sql = where_clauses.join(" AND ");

    let total: i64 = conn.query_row(
        &format!("SELECT count(*) FROM excerpts e WHERE {where_sql}"),
        rusqlite::params_from_iter(args.iter()),
        |r| r.get(0),
    )?;

    let limit = filter.limit.clamp(1, 1000);
    let offset = filter.offset.max(0);
    let sql = format!(
        "SELECT {COLUMNS}, d.name,
            substr(d.text, max(1, e.start_pos - {CONTEXT_CHARS} + 1), min(e.start_pos, {CONTEXT_CHARS})) AS before_ctx,
            substr(d.text, e.end_pos + 1, {CONTEXT_CHARS}) AS after_ctx
         FROM excerpts e JOIN documents d ON d.id = e.document_id
         WHERE {where_sql}
         ORDER BY d.sort_order, d.created_at, e.start_pos, e.end_pos, e.created_at, e.id
         LIMIT ? OFFSET ?"
    );
    let mut page_args = args.clone();
    page_args.push(limit.into());
    page_args.push(offset.into());
    let mut stmt = conn.prepare(&sql)?;
    let rows: Vec<(ExcerptWithCodes, String, Option<String>, Option<String>)> = stmt
        .query_map(rusqlite::params_from_iter(page_args.iter()), |r| {
            Ok((from_row(r)?, r.get(10)?, r.get(11)?, r.get(12)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut excerpts: Vec<ExcerptWithCodes> = rows.iter().map(|(e, ..)| e.clone()).collect();
    attach_codes(conn, &mut excerpts)?;
    let out = excerpts
        .into_iter()
        .zip(rows)
        .map(|(excerpt, (_, document_name, before, after))| ExcerptRow {
            excerpt,
            document_name,
            context_before: before.unwrap_or_default().replace('\n', " "),
            context_after: after.unwrap_or_default().replace('\n', " "),
        })
        .collect();
    Ok(ExcerptPage { rows: out, total })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::codes::tests::mk as mk_code;
    use crate::db::descriptors::tests::mk_field;
    use crate::db::documents::tests::{new_doc, new_image};
    use crate::db::OpenProject;
    use crate::models::MemoTarget;

    fn setup() -> (OpenProject, String, String, String) {
        let p = OpenProject::in_memory("t").unwrap();
        let doc = documents::create(&p.conn, new_doc("héllo wörld 😀 end")).unwrap();
        let a = mk_code(&p.conn, "A", None);
        let b = mk_code(&p.conn, "B", Some(&a.id));
        (p, doc.summary.id, a.id, b.id)
    }

    fn apply(conn: &Connection, doc: &str, s: i64, e: i64, codes: &[&str]) -> ApplyResult {
        apply_codes(conn, text_input(doc, s, e, codes)).unwrap()
    }

    fn text_input(doc: &str, s: i64, e: i64, codes: &[&str]) -> ApplyCodesInput {
        ApplyCodesInput {
            document_id: doc.into(),
            start_pos: Some(s),
            end_pos: Some(e),
            code_ids: codes.iter().map(|c| c.to_string()).collect(),
            ..Default::default()
        }
    }

    fn region_input(doc: &str, rect: Rect, codes: &[&str]) -> ApplyCodesInput {
        ApplyCodesInput {
            document_id: doc.into(),
            kind: Some("image_region".into()),
            geometry: Some(rect),
            code_ids: codes.iter().map(|c| c.to_string()).collect(),
            ..Default::default()
        }
    }

    fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect { x, y, w, h }
    }

    #[test]
    fn apply_creates_then_upserts_on_same_range() {
        let (p, doc, a, b) = setup();
        let r1 = apply(&p.conn, &doc, 6, 13, &[&a]);
        assert!(r1.created);
        assert_eq!(r1.excerpt.snapshot.as_deref(), Some("wörld 😀"));
        assert_eq!(r1.added_code_ids, vec![a.clone()]);
        let r2 = apply(&p.conn, &doc, 6, 13, &[&a, &b]);
        assert!(!r2.created);
        assert_eq!(r2.excerpt.id, r1.excerpt.id);
        assert_eq!(r2.added_code_ids, vec![b.clone()]);
        assert_eq!(r2.excerpt.code_ids.len(), 2);
        assert_eq!(list_for_document(&p.conn, &doc).unwrap().len(), 1);
    }

    #[test]
    fn range_validation() {
        let (p, doc, a, _) = setup();
        for (s, e) in [(-1, 3), (3, 3), (5, 2), (0, 99)] {
            let r = apply_codes(&p.conn, text_input(&doc, s, e, &[&a]));
            assert!(matches!(r, Err(AppError::Validation(_))), "{s}..{e}");
        }
        // A text excerpt without offsets, and an unknown kind, are rejected.
        assert!(matches!(
            apply_codes(
                &p.conn,
                ApplyCodesInput {
                    document_id: doc.clone(),
                    code_ids: vec![a.clone()],
                    ..Default::default()
                }
            ),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            apply_codes(
                &p.conn,
                ApplyCodesInput {
                    kind: Some("video_range".into()),
                    ..text_input(&doc, 0, 1, &[&a])
                }
            ),
            Err(AppError::Validation(_))
        ));
        // Whole document is fine (length 16 code points).
        apply(&p.conn, &doc, 0, 16, &[&a]);
        assert!(matches!(
            apply_codes(&p.conn, text_input(&doc, 0, 1, &["nope"])),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn add_remove_delete_restore_roundtrip() {
        let (p, doc, a, b) = setup();
        let r = apply(&p.conn, &doc, 0, 5, &[&a]);
        let id = r.excerpt.id.clone();
        let e = add_codes(&p.conn, &id, std::slice::from_ref(&b)).unwrap();
        assert_eq!(e.code_ids.len(), 2);
        let e = remove_code(&p.conn, &id, &a).unwrap();
        assert_eq!(e.code_ids, vec![b.clone()]);
        memos::create(
            &p.conn,
            MemoTarget {
                excerpt_id: Some(id.clone()),
                ..Default::default()
            },
            "t",
            "note",
        )
        .unwrap();
        let snap = delete(&p.conn, &id).unwrap();
        assert_eq!(snap.memos.len(), 1);
        assert!(matches!(get(&p.conn, &id), Err(AppError::NotFound(_))));
        let restored = restore(&p.conn, &snap).unwrap();
        assert_eq!(restored.id, id);
        assert_eq!(restored.code_ids, vec![b.clone()]);
        assert_eq!(restored.memo_count, 1);
        assert!(matches!(
            restore(&p.conn, &snap),
            Err(AppError::Conflict(_))
        ));
        // Deleting the document cascades.
        documents::delete(&p.conn, &doc).unwrap();
        assert!(matches!(get(&p.conn, &id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn update_range_moves_boundaries_and_recomputes_the_snapshot() {
        // "héllo wörld 😀 end": 17 code points, the emoji is one.
        let (p, doc, a, _) = setup();
        let id = apply(&p.conn, &doc, 0, 5, &[&a]).excerpt.id;
        let before = get(&p.conn, &id).unwrap();
        // `now()` has millisecond precision; make the bump observable.
        std::thread::sleep(std::time::Duration::from_millis(2));

        let e = update_range(&p.conn, &id, 6, 13).unwrap();
        assert_eq!((e.start_pos, e.end_pos), (Some(6), Some(13)));
        assert_eq!(e.snapshot.as_deref(), Some("wörld 😀"));
        assert_eq!(e.code_ids, vec![a.clone()]);
        assert_ne!(e.updated_at, before.updated_at);

        // One code point past the emoji, and the whole document.
        assert_eq!(
            update_range(&p.conn, &id, 12, 13)
                .unwrap()
                .snapshot
                .as_deref(),
            Some("😀")
        );
        assert_eq!(
            update_range(&p.conn, &id, 0, 17)
                .unwrap()
                .snapshot
                .as_deref(),
            Some("héllo wörld 😀 end")
        );

        // Bad ranges are rejected and nothing changes.
        for (s, e2) in [(-1, 5), (5, 5), (7, 3), (0, 18)] {
            assert!(
                matches!(
                    update_range(&p.conn, &id, s, e2),
                    Err(AppError::Validation(_))
                ),
                "{s}..{e2}"
            );
        }
        let unchanged = get(&p.conn, &id).unwrap();
        assert_eq!(
            (unchanged.start_pos, unchanged.end_pos),
            (Some(0), Some(17))
        );

        // An occupied range is a conflict, but moving onto itself is fine.
        let other = apply(&p.conn, &doc, 0, 5, &[&a]).excerpt.id;
        assert!(matches!(
            update_range(&p.conn, &id, 0, 5),
            Err(AppError::Conflict(_))
        ));
        assert!(update_range(&p.conn, &other, 0, 5).is_ok());
        assert!(matches!(
            update_range(&p.conn, "nope", 0, 1),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn split_keeps_the_left_id_and_copies_codes() {
        let (p, doc, a, b) = setup();
        let id = apply(&p.conn, &doc, 0, 17, &[&a, &b]).excerpt.id;
        memos::create(
            &p.conn,
            MemoTarget {
                excerpt_id: Some(id.clone()),
                ..Default::default()
            },
            "t",
            "note",
        )
        .unwrap();

        assert!(matches!(
            split(&p.conn, &id, 0),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            split(&p.conn, &id, 17),
            Err(AppError::Validation(_))
        ));

        let (left, right) = split(&p.conn, &id, 6).unwrap();
        assert_eq!(left.id, id);
        assert_ne!(right.id, id);
        assert_eq!((left.start_pos, left.end_pos), (Some(0), Some(6)));
        assert_eq!((right.start_pos, right.end_pos), (Some(6), Some(17)));
        assert_eq!(left.snapshot.as_deref(), Some("héllo "));
        assert_eq!(right.snapshot.as_deref(), Some("wörld 😀 end"));
        assert_eq!(left.code_ids, vec![a.clone(), b.clone()]);
        assert_eq!(right.code_ids, vec![a.clone(), b.clone()]);
        // Memos stay on the original (left) excerpt.
        assert_eq!(left.memo_count, 1);
        assert_eq!(right.memo_count, 0);
        assert_eq!(list_for_document(&p.conn, &doc).unwrap().len(), 2);

        // Splitting where a half is already taken conflicts.
        let (l2, r2) = split(&p.conn, &right.id, 12).unwrap();
        assert_eq!(l2.snapshot.as_deref(), Some("wörld "));
        assert_eq!(r2.snapshot.as_deref(), Some("😀 end"));
        let whole = apply(&p.conn, &doc, 6, 17, &[]).excerpt.id;
        assert!(matches!(
            split(&p.conn, &whole, 12),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn merge_unions_codes_repoints_memos_and_is_invertible() {
        let (p, doc, a, b) = setup();
        let left = apply(&p.conn, &doc, 0, 6, &[&a]).excerpt.id;
        let right = apply(&p.conn, &doc, 6, 13, &[&b]).excerpt.id;
        let memo = memos::create(
            &p.conn,
            MemoTarget {
                excerpt_id: Some(right.clone()),
                ..Default::default()
            },
            "t",
            "note",
        )
        .unwrap();

        let r = merge_adjacent(&p.conn, &left, &right).unwrap();
        assert_eq!(r.excerpt.id, left);
        assert_eq!(
            (r.excerpt.start_pos, r.excerpt.end_pos),
            (Some(0), Some(13))
        );
        assert_eq!(r.excerpt.snapshot.as_deref(), Some("héllo wörld 😀"));
        assert_eq!(r.excerpt.code_ids, vec![a.clone(), b.clone()]);
        assert_eq!(r.excerpt.memo_count, 1);
        assert_eq!(r.added_code_ids, vec![b.clone()]);
        assert_eq!((r.previous_start_pos, r.previous_end_pos), (0, 6));
        assert_eq!(r.removed.excerpt.id, right);
        assert_eq!(r.removed.memos.len(), 1);
        assert!(matches!(get(&p.conn, &right), Err(AppError::NotFound(_))));
        assert_eq!(
            memos::get(&p.conn, &memo.id).unwrap().excerpt_id.as_deref(),
            Some(left.as_str())
        );

        // Undo, exactly as the frontend does it.
        for c in &r.added_code_ids {
            remove_code(&p.conn, &left, c).unwrap();
        }
        update_range(&p.conn, &left, r.previous_start_pos, r.previous_end_pos).unwrap();
        let back = restore(&p.conn, &r.removed).unwrap();
        assert_eq!(back.id, right);
        assert_eq!(back.code_ids, vec![b.clone()]);
        assert_eq!(back.memo_count, 1);
        assert_eq!(get(&p.conn, &left).unwrap().code_ids, vec![a.clone()]);
        assert_eq!(
            get(&p.conn, &left).unwrap().snapshot.as_deref(),
            Some("héllo ")
        );
        assert_eq!(
            memos::get(&p.conn, &memo.id).unwrap().excerpt_id.as_deref(),
            Some(right.as_str())
        );
    }

    #[test]
    fn merge_validates_adjacency_documents_and_overlap() {
        let (p, doc, a, _) = setup();
        let doc2 = documents::create(&p.conn, new_doc("second document text"))
            .unwrap()
            .summary
            .id;
        let one = apply(&p.conn, &doc, 0, 5, &[&a]).excerpt.id;
        let far = apply(&p.conn, &doc, 12, 16, &[&a]).excerpt.id;
        let elsewhere = apply(&p.conn, &doc2, 0, 6, &[&a]).excerpt.id;

        assert!(matches!(
            merge_adjacent(&p.conn, &one, &one),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            merge_adjacent(&p.conn, &one, &elsewhere),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            merge_adjacent(&p.conn, &one, &far),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            merge_adjacent(&p.conn, &one, "nope"),
            Err(AppError::NotFound(_))
        ));

        // Overlapping ranges merge, in either order, and the right one wins
        // the larger end.
        let overlap = apply(&p.conn, &doc, 3, 11, &[&a]).excerpt.id;
        let r = merge_adjacent(&p.conn, &overlap, &one).unwrap();
        assert_eq!(
            (r.excerpt.start_pos, r.excerpt.end_pos),
            (Some(0), Some(11))
        );
        assert_eq!(r.excerpt.id, overlap);

        // A range already held by a third excerpt is a conflict.
        let next = apply(&p.conn, &doc, 11, 14, &[&a]).excerpt.id;
        apply(&p.conn, &doc, 0, 14, &[&a]);
        assert!(matches!(
            merge_adjacent(&p.conn, &overlap, &next),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn detail_and_query_with_descendants_documents_paging() {
        let (p, doc, a, b) = setup();
        let doc2 = documents::create(&p.conn, new_doc("second document text"))
            .unwrap()
            .summary
            .id;
        let e1 = apply(&p.conn, &doc, 0, 5, &[&a]).excerpt.id;
        let e2 = apply(&p.conn, &doc, 6, 11, &[&b]).excerpt.id;
        let e3 = apply(&p.conn, &doc2, 0, 6, &[]).excerpt.id;

        let d = detail(&p.conn, &e2).unwrap();
        assert_eq!(d.context_before, "héllo ");
        assert_eq!(d.excerpt.snapshot.as_deref(), Some("wörld"));
        assert_eq!(d.context_after, " 😀 end");

        let all = query(&p.conn, &ExcerptFilter::default()).unwrap();
        assert_eq!(all.total, 3);
        assert_eq!(
            all.rows
                .iter()
                .map(|r| r.excerpt.id.clone())
                .collect::<Vec<_>>(),
            vec![e1.clone(), e2.clone(), e3.clone()]
        );
        assert_eq!(all.rows[1].context_before, "héllo ");
        assert_eq!(all.rows[1].context_after, " 😀 end");

        let by_a = query(
            &p.conn,
            &ExcerptFilter {
                code_ids: Some(vec![a.clone()]),
                include_descendants: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_a.total, 2);
        let by_a_only = query(
            &p.conn,
            &ExcerptFilter {
                code_ids: Some(vec![a.clone()]),
                include_descendants: false,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_a_only.total, 1);
        // require_all_codes: the excerpt must carry every listed code.
        let both = query(
            &p.conn,
            &ExcerptFilter {
                code_ids: Some(vec![a.clone(), b.clone()]),
                require_all_codes: true,
                include_descendants: false,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(both.total, 0);
        add_codes(&p.conn, &e2, std::slice::from_ref(&a)).unwrap();
        let both = query(
            &p.conn,
            &ExcerptFilter {
                code_ids: Some(vec![a.clone(), b.clone()]),
                require_all_codes: true,
                include_descendants: false,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(both.total, 1);
        assert_eq!(both.rows[0].excerpt.id, e2);
        // A stands for its subtree, so "A and B" still matches via B ⊂ A.
        let with_sub = query(
            &p.conn,
            &ExcerptFilter {
                code_ids: Some(vec![a.clone(), b.clone()]),
                require_all_codes: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(with_sub.total, 1);
        let unknown = query(
            &p.conn,
            &ExcerptFilter {
                code_ids: Some(vec![a.clone(), "nope".into()]),
                require_all_codes: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(unknown.total, 0);

        let uncoded = query(
            &p.conn,
            &ExcerptFilter {
                uncoded_only: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(uncoded.rows[0].excerpt.id, e3);
        let doc2_only = query(
            &p.conn,
            &ExcerptFilter {
                document_ids: Some(vec![doc2.clone()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(doc2_only.total, 1);
        let page = query(
            &p.conn,
            &ExcerptFilter {
                limit: 1,
                offset: 1,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 3);
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].excerpt.id, e2);
    }

    #[test]
    fn code_and_document_sets_expand_into_the_filter() {
        let (p, doc, a, b) = setup();
        let mut other = new_doc("second document text");
        other.name = "Doc 2".into();
        let doc2 = documents::create(&p.conn, other).unwrap().summary.id;
        let c = mk_code(&p.conn, "C", None);
        let e1 = apply(&p.conn, &doc, 0, 5, &[&a]).excerpt.id;
        let e2 = apply(&p.conn, &doc, 6, 11, &[&c.id]).excerpt.id;
        let e3 = apply(&p.conn, &doc2, 0, 6, &[&c.id]).excerpt.id;

        let code_set = sets::create_set(&p.conn, "code", "Both", &[a.clone(), c.id.clone()], None)
            .unwrap()
            .id;
        let doc_set = sets::create_set(
            &p.conn,
            "document",
            "Wave 1",
            std::slice::from_ref(&doc),
            None,
        )
        .unwrap()
        .id;

        // A code set behaves exactly like ticking each of its codes.
        let by_set = query(
            &p.conn,
            &ExcerptFilter {
                code_set_ids: Some(vec![code_set.clone()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_set.total, 3);
        assert_eq!(
            by_set
                .rows
                .iter()
                .map(|r| r.excerpt.id.clone())
                .collect::<Vec<_>>(),
            vec![e1.clone(), e2.clone(), e3.clone()]
        );

        // Combined with a document set, which narrows it to one document.
        let narrowed = query(
            &p.conn,
            &ExcerptFilter {
                code_set_ids: Some(vec![code_set.clone()]),
                document_set_ids: Some(vec![doc_set.clone()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(narrowed.total, 2);
        assert!(narrowed.rows.iter().all(|r| r.excerpt.document_id == doc));

        // Members union with explicitly picked ids rather than replacing them.
        let with_picked = query(
            &p.conn,
            &ExcerptFilter {
                code_ids: Some(vec![b.clone()]),
                code_set_ids: Some(vec![code_set.clone()]),
                document_ids: Some(vec![doc2.clone()]),
                document_set_ids: Some(vec![doc_set.clone()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(with_picked.total, 3);

        // `require_all_codes` treats a set as "all of these codes".
        let all_of = query(
            &p.conn,
            &ExcerptFilter {
                code_set_ids: Some(vec![code_set.clone()]),
                require_all_codes: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(all_of.total, 0);
        add_codes(&p.conn, &e2, std::slice::from_ref(&a)).unwrap();
        let all_of = query(
            &p.conn,
            &ExcerptFilter {
                code_set_ids: Some(vec![code_set.clone()]),
                require_all_codes: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(all_of.total, 1);
        assert_eq!(all_of.rows[0].excerpt.id, e2);

        // An empty (or unknown) set matches nothing rather than everything.
        let empty = sets::create_set(&p.conn, "code", "Empty", &[], None)
            .unwrap()
            .id;
        for f in [
            ExcerptFilter {
                code_set_ids: Some(vec![empty]),
                ..Default::default()
            },
            ExcerptFilter {
                document_set_ids: Some(vec!["nope".into()]),
                ..Default::default()
            },
        ] {
            assert_eq!(query(&p.conn, &f).unwrap().total, 0);
        }
    }

    /// `overlaps_code_id` should return exactly the excerpts that
    /// `analysis::co_occurrence` would pair with something tagged the other
    /// code: overlapping text ranges in the same document, or one excerpt
    /// carrying both codes itself.
    #[test]
    fn overlaps_code_id_finds_the_co_occurrence_pairs() {
        let (p, doc, a, b) = setup();
        // "héllo wörld 😀 end", 17 code points.
        let e1 = apply(&p.conn, &doc, 0, 5, &[&a]).excerpt.id; // overlaps e2
        let e2 = apply(&p.conn, &doc, 3, 8, &[&b]).excerpt.id; // overlaps e1
        let e3 = apply(&p.conn, &doc, 9, 13, &[&b]).excerpt.id; // isolated
                                                                // Carries both codes itself: a "self" pair, like the diagonal loop in
                                                                // `co_occurrence`. Overlaps e1 and e2, but not e3.
        let e_both = apply(&p.conn, &doc, 1, 4, &[&a, &b]).excerpt.id;

        let ids = |code: &str, other: &str| -> Vec<String> {
            query(
                &p.conn,
                &ExcerptFilter {
                    code_ids: Some(vec![code.to_string()]),
                    overlaps_code_id: Some(other.to_string()),
                    include_descendants: false,
                    ..Default::default()
                },
            )
            .unwrap()
            .rows
            .into_iter()
            .map(|r| r.excerpt.id)
            .collect()
        };

        assert_eq!(ids(&a, &b), vec![e1.clone(), e_both.clone()]);
        assert_eq!(ids(&b, &a), vec![e_both.clone(), e2.clone()]);
        assert!(!ids(&b, &a).contains(&e3));

        // An unknown code matches nothing rather than everything.
        let none = query(
            &p.conn,
            &ExcerptFilter {
                overlaps_code_id: Some("nope".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(none.total, 0);
    }

    #[test]
    fn overlaps_code_id_respects_include_descendants_and_ignores_image_excerpts() {
        let (p, doc, a, b) = setup(); // B is a child of A.
        let c = mk_code(&p.conn, "C", None).id;
        let e_c = apply(&p.conn, &doc, 0, 5, &[&c]).excerpt.id;
        // Tagged with B (a descendant of A), overlapping e_c, but never
        // tagged A itself.
        apply(&p.conn, &doc, 3, 8, &[&b]);

        let matches = |include_descendants: bool| -> i64 {
            query(
                &p.conn,
                &ExcerptFilter {
                    code_ids: Some(vec![c.clone()]),
                    overlaps_code_id: Some(a.clone()),
                    include_descendants,
                    ..Default::default()
                },
            )
            .unwrap()
            .total
        };
        assert_eq!(matches(true), 1); // B stands in for A's subtree.
        assert_eq!(matches(false), 0); // Direct A only: nothing carries it here.
        assert_eq!(
            query(
                &p.conn,
                &ExcerptFilter {
                    code_ids: Some(vec![c.clone()]),
                    overlaps_code_id: Some(a.clone()),
                    include_descendants: true,
                    ..Default::default()
                },
            )
            .unwrap()
            .rows[0]
                .excerpt
                .id,
            e_c
        );

        // Image excerpts never match: `co_occurrence` only counts text
        // ranges, so `overlaps_code_id` is text-only too.
        let (pi, image_doc, a2) = image_setup();
        let b2 = mk_code(&pi.conn, "B2", None).id;
        apply_codes(
            &pi.conn,
            region_input(&image_doc, rect(0.0, 0.0, 0.5, 0.5), &[&b2]),
        )
        .unwrap();
        let img_page = query(
            &pi.conn,
            &ExcerptFilter {
                overlaps_code_id: Some(a2),
                include_descendants: false,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(img_page.total, 0);
    }

    #[test]
    fn descriptor_conditions_filter_by_document_attributes() {
        let p = OpenProject::in_memory("t").unwrap();
        let mut north = new_doc("north transcript");
        north.name = "North".into();
        let mut south = new_doc("south transcript");
        south.name = "South".into();
        let mut plain = new_doc("no descriptors here");
        plain.name = "Plain".into();
        let north = documents::create(&p.conn, north).unwrap().summary.id;
        let south = documents::create(&p.conn, south).unwrap().summary.id;
        let plain = documents::create(&p.conn, plain).unwrap().summary.id;
        let a = mk_code(&p.conn, "A", None).id;

        let site = mk_field(&p.conn, "Site", "choice", &["North", "South"]);
        let age = mk_field(&p.conn, "Age", "number", &[]);
        let seen = mk_field(&p.conn, "Interviewed", "date", &[]);
        let note = mk_field(&p.conn, "Note", "text", &[]);
        let set = |doc: &str, field: &str, v: &str| {
            descriptors::set_value(&p.conn, doc, field, Some(v)).unwrap();
        };
        set(&north, &site.id, "North");
        set(&north, &age.id, "34");
        set(&north, &seen.id, "2024-03-01");
        set(&north, &note.id, "Rural clinic");
        set(&south, &site.id, "South");
        set(&south, &age.id, "9");
        set(&south, &seen.id, "2024-09-15");
        set(&south, &note.id, "Urban CLINIC annex");

        let e_north = apply(&p.conn, &north, 0, 5, &[&a]).excerpt.id;
        let e_south = apply(&p.conn, &south, 0, 5, &[&a]).excerpt.id;
        let e_plain = apply(&p.conn, &plain, 0, 2, &[&a]).excerpt.id;

        let ids = |conds: Vec<DescriptorFilter>| -> Vec<String> {
            let page = query(
                &p.conn,
                &ExcerptFilter {
                    descriptors: Some(conds),
                    ..Default::default()
                },
            )
            .unwrap();
            page.rows.into_iter().map(|r| r.excerpt.id).collect()
        };
        let cond = |field: &str, op: &str, values: &[&str]| DescriptorFilter {
            field_id: field.to_string(),
            op: op.to_string(),
            values: values.iter().map(|v| v.to_string()).collect(),
        };

        assert_eq!(
            ids(vec![cond(&site.id, "eq", &["north"])]),
            vec![e_north.clone()]
        );
        // "not equal" also matches documents with no value for the field.
        assert_eq!(
            ids(vec![cond(&site.id, "neq", &["North"])]),
            vec![e_south.clone(), e_plain.clone()]
        );
        assert_eq!(
            ids(vec![cond(&site.id, "in", &["North", "South"])]),
            vec![e_north.clone(), e_south.clone()]
        );
        assert_eq!(
            ids(vec![cond(&site.id, "empty", &[])]),
            vec![e_plain.clone()]
        );
        assert_eq!(
            ids(vec![cond(&site.id, "notEmpty", &[])]),
            vec![e_north.clone(), e_south.clone()]
        );
        // Numbers compare numerically, not as strings ("9" > "34" as text).
        assert_eq!(
            ids(vec![cond(&age.id, "gt", &["10"])]),
            vec![e_north.clone()]
        );
        assert_eq!(
            ids(vec![cond(&age.id, "lt", &["10"])]),
            vec![e_south.clone()]
        );
        assert_eq!(
            ids(vec![cond(&age.id, "between", &["5", "40"])]),
            vec![e_north.clone(), e_south.clone()]
        );
        assert_eq!(
            ids(vec![cond(
                &seen.id,
                "between",
                &["2024-01-01", "2024-06-30"]
            )]),
            vec![e_north.clone()]
        );
        assert_eq!(
            ids(vec![cond(&note.id, "contains", &["clinic"])]),
            vec![e_north.clone(), e_south.clone()]
        );
        // Several conditions are ANDed.
        assert_eq!(
            ids(vec![
                cond(&site.id, "notEmpty", &[]),
                cond(&age.id, "gt", &["20"]),
            ]),
            vec![e_north.clone()]
        );
        assert!(ids(vec![
            cond(&site.id, "eq", &["North"]),
            cond(&site.id, "eq", &["South"]),
        ])
        .is_empty());
        // Descriptor conditions combine with the other filters.
        let page = query(
            &p.conn,
            &ExcerptFilter {
                document_ids: Some(vec![south.clone()]),
                descriptors: Some(vec![cond(&site.id, "notEmpty", &[])]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.rows[0].excerpt.id, e_south);

        // Bad conditions are rejected rather than silently ignored.
        for bad in [
            cond(&site.id, "eq", &["East"]),
            cond(&age.id, "eq", &["old"]),
            cond(&seen.id, "eq", &["2024-13-01"]),
            cond(&age.id, "between", &["1"]),
            cond(&age.id, "startsWith", &["1"]),
            cond("nope", "eq", &["1"]),
        ] {
            let r = query(
                &p.conn,
                &ExcerptFilter {
                    descriptors: Some(vec![bad.clone()]),
                    ..Default::default()
                },
            );
            assert!(r.is_err(), "{bad:?}");
        }
    }

    // ------------------------------------------------------------- images

    fn image_setup() -> (OpenProject, String, String) {
        let p = OpenProject::in_memory("t").unwrap();
        let doc = documents::create_image(&p.conn, new_image(b"\x89PNG pixels"))
            .unwrap()
            .summary
            .id;
        let a = mk_code(&p.conn, "A", None).id;
        (p, doc, a)
    }

    /// Boundary edits are text-only: a region has no offsets to move.
    #[test]
    fn boundary_edits_reject_image_regions() {
        let (p, doc, a) = image_setup();
        let left = apply_codes(&p.conn, region_input(&doc, rect(0.1, 0.2, 0.3, 0.4), &[&a]))
            .unwrap()
            .excerpt
            .id;
        let right = apply_codes(&p.conn, region_input(&doc, rect(0.5, 0.5, 0.2, 0.2), &[&a]))
            .unwrap()
            .excerpt
            .id;
        assert!(matches!(
            update_range(&p.conn, &left, 0, 5),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            split(&p.conn, &left, 3),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            merge_adjacent(&p.conn, &left, &right),
            Err(AppError::Validation(_))
        ));
        // Nothing was changed by the attempts.
        assert_eq!(list_for_document(&p.conn, &doc).unwrap().len(), 2);
    }

    #[test]
    fn canonical_geometry_rounds_and_validates() {
        assert_eq!(
            canonical_geometry(&rect(0.3, 0.4, 0.12, 0.08)).unwrap(),
            r#"{"x":0.3,"y":0.4,"w":0.12,"h":0.08}"#
        );
        // Two drags that differ below the rounding step canonicalize equally.
        assert_eq!(
            canonical_geometry(&rect(0.30000004, 0.4, 0.12, 0.08)).unwrap(),
            canonical_geometry(&rect(0.29999996, 0.4, 0.12, 0.08)).unwrap()
        );
        // The whole image is fine, and so is a rectangle ending exactly at 1.
        canonical_geometry(&rect(0.0, 0.0, 1.0, 1.0)).unwrap();
        canonical_geometry(&rect(0.5, 0.5, 0.5, 0.5)).unwrap();
        for bad in [
            rect(-0.01, 0.0, 0.5, 0.5),
            rect(0.0, -0.01, 0.5, 0.5),
            rect(0.0, 0.0, 0.0, 0.5),
            rect(0.0, 0.0, 0.5, 0.0),
            rect(0.0, 0.0, 0.5, -0.5),
            rect(0.6, 0.0, 0.5, 0.5),
            rect(0.0, 0.6, 0.5, 0.5),
            rect(f64::NAN, 0.0, 0.5, 0.5),
            rect(0.0, 0.0, f64::INFINITY, 0.5),
        ] {
            assert!(
                matches!(canonical_geometry(&bad), Err(AppError::Validation(_))),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn region_snapshot_reads_as_percentages() {
        assert_eq!(
            region_snapshot(&rect(0.3, 0.4, 0.12, 0.08)),
            "region 12%×8% at (30%, 40%)"
        );
        assert_eq!(
            region_snapshot(&rect(0.0, 0.0, 1.0, 1.0)),
            "region 100%×100% at (0%, 0%)"
        );
    }

    #[test]
    fn apply_creates_an_image_region_then_upserts_on_the_same_rectangle() {
        let (p, doc, a) = image_setup();
        let b = mk_code(&p.conn, "B", None).id;
        let r1 = apply_codes(
            &p.conn,
            region_input(&doc, rect(0.3, 0.4, 0.12, 0.08), &[&a]),
        )
        .unwrap();
        assert!(r1.created);
        assert_eq!(r1.excerpt.kind, "image_region");
        assert_eq!(r1.excerpt.start_pos, None);
        assert_eq!(r1.excerpt.end_pos, None);
        assert_eq!(
            r1.excerpt.geometry.as_deref(),
            Some(r#"{"x":0.3,"y":0.4,"w":0.12,"h":0.08}"#)
        );
        assert_eq!(
            r1.excerpt.snapshot.as_deref(),
            Some("region 12%×8% at (30%, 40%)")
        );
        // The same rectangle (to within rounding) adds codes to the same excerpt.
        let r2 = apply_codes(
            &p.conn,
            region_input(&doc, rect(0.3000000001, 0.4, 0.12, 0.08), &[&a, &b]),
        )
        .unwrap();
        assert!(!r2.created);
        assert_eq!(r2.excerpt.id, r1.excerpt.id);
        assert_eq!(r2.added_code_ids, vec![b.clone()]);
        assert_eq!(list_for_document(&p.conn, &doc).unwrap().len(), 1);
        // A different rectangle is a different excerpt.
        let r3 = apply_codes(&p.conn, region_input(&doc, rect(0.1, 0.1, 0.2, 0.2), &[&a])).unwrap();
        assert!(r3.created);
        assert_eq!(list_for_document(&p.conn, &doc).unwrap().len(), 2);
    }

    #[test]
    fn image_regions_are_validated_against_the_document_and_the_bounds() {
        let (p, doc, a) = image_setup();
        // No geometry.
        assert!(matches!(
            apply_codes(
                &p.conn,
                ApplyCodesInput {
                    document_id: doc.clone(),
                    kind: Some("image_region".into()),
                    code_ids: vec![a.clone()],
                    ..Default::default()
                }
            ),
            Err(AppError::Validation(_))
        ));
        // Out of bounds.
        assert!(matches!(
            apply_codes(&p.conn, region_input(&doc, rect(0.9, 0.1, 0.2, 0.2), &[&a])),
            Err(AppError::Validation(_))
        ));
        // A text document cannot hold a region, and an image cannot hold text.
        let text_doc = documents::create(&p.conn, new_doc("words here"))
            .unwrap()
            .summary
            .id;
        assert!(matches!(
            apply_codes(
                &p.conn,
                region_input(&text_doc, rect(0.0, 0.0, 0.5, 0.5), &[&a])
            ),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            apply_codes(&p.conn, text_input(&doc, 0, 3, &[&a])),
            Err(AppError::NotFound(_))
        ));
        // An unknown code still fails before anything is written.
        assert!(matches!(
            apply_codes(
                &p.conn,
                region_input(&doc, rect(0.0, 0.0, 0.5, 0.5), &["nope"])
            ),
            Err(AppError::NotFound(_))
        ));
        assert!(list_for_document(&p.conn, &doc).unwrap().is_empty());
    }

    #[test]
    fn image_excerpts_survive_delete_restore_detail_and_query() {
        let (p, doc, a) = image_setup();
        let e = apply_codes(
            &p.conn,
            region_input(&doc, rect(0.25, 0.5, 0.25, 0.25), &[&a]),
        )
        .unwrap()
        .excerpt;
        memos::create(
            &p.conn,
            MemoTarget {
                excerpt_id: Some(e.id.clone()),
                ..Default::default()
            },
            "m",
            "what is in the corner",
        )
        .unwrap();

        // detail: no context text, but the snapshot and geometry are there.
        let d = detail(&p.conn, &e.id).unwrap();
        assert_eq!(d.context_before, "");
        assert_eq!(d.context_after, "");
        assert_eq!(d.excerpt.geometry, e.geometry);
        assert_eq!(d.document_name, "Poster");
        assert_eq!(d.memos.len(), 1);

        // query: image rows come back with empty context.
        let page = query(&p.conn, &ExcerptFilter::default()).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.rows[0].excerpt.id, e.id);
        assert_eq!(page.rows[0].context_before, "");
        assert_eq!(page.rows[0].context_after, "");
        assert_eq!(page.rows[0].excerpt.code_ids, vec![a.clone()]);

        // delete + restore keeps the geometry, and the region stays unique.
        let snap = delete(&p.conn, &e.id).unwrap();
        assert_eq!(snap.memos.len(), 1);
        let restored = restore(&p.conn, &snap).unwrap();
        assert_eq!(restored.id, e.id);
        assert_eq!(restored.geometry, e.geometry);
        assert_eq!(restored.memo_count, 1);
        assert!(matches!(
            restore(&p.conn, &snap),
            Err(AppError::Conflict(_))
        ));

        // Codes work the same way as on text.
        let b = mk_code(&p.conn, "B", None).id;
        let with_b = add_codes(&p.conn, &e.id, std::slice::from_ref(&b)).unwrap();
        assert_eq!(with_b.code_ids.len(), 2);
        assert_eq!(remove_code(&p.conn, &e.id, &a).unwrap().code_ids, vec![b]);

        // Deleting the image takes its excerpt (and blob) with it.
        documents::delete(&p.conn, &doc).unwrap();
        assert!(matches!(get(&p.conn, &e.id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn a_project_can_mix_text_and_image_excerpts() {
        let (p, image, a) = image_setup();
        let text_doc = documents::create(&p.conn, new_doc("héllo wörld"))
            .unwrap()
            .summary
            .id;
        let t = apply(&p.conn, &text_doc, 0, 5, &[&a]).excerpt.id;
        let r = apply_codes(
            &p.conn,
            region_input(&image, rect(0.0, 0.0, 0.5, 0.5), &[&a]),
        )
        .unwrap()
        .excerpt
        .id;
        let page = query(&p.conn, &ExcerptFilter::default()).unwrap();
        assert_eq!(page.total, 2);
        // Document order: the image was imported first.
        assert_eq!(
            page.rows
                .iter()
                .map(|row| row.excerpt.id.clone())
                .collect::<Vec<_>>(),
            vec![r, t]
        );
    }
}
