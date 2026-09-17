//! The codebook: a tree of codes (adjacency list with explicit sibling order).

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Value};

use super::history::{CodeOp, Reparent};
use super::{activity, history, util};
use crate::error::{AppError, Result};
use crate::models::{
    ChildrenStrategy, Code, CodeImpact, CodePatch, CodeRow, CodeTreeSnapshot, DeleteCodeReport,
    FrameworkCellRow, NewCode, SiblingGroup, TagRow,
};

/// Twelve distinguishable highlight colors; new codes cycle through them.
pub const PALETTE: [&str; 12] = [
    "#D9534F", "#F0AD4E", "#5CB85C", "#5BC0DE", "#8E6BBF", "#E96FA6", "#2E8B8B", "#C77D3C",
    "#4A6FA5", "#8AA63B", "#B05C8A", "#6C757D",
];

const COLUMNS: &str = "c.id, c.parent_id, c.name, c.color, c.description,
     c.inclusion, c.exclusion, c.example_excerpt_id, c.shortcut, c.sort_order,
     (SELECT count(DISTINCT ec.excerpt_id) FROM excerpt_codes ec
        WHERE ec.code_id = c.id) AS excerpt_count,
     c.created_at, c.updated_at";

fn from_row(r: &Row) -> rusqlite::Result<Code> {
    Ok(Code {
        id: r.get(0)?,
        parent_id: r.get(1)?,
        name: r.get(2)?,
        color: r.get(3)?,
        description: r.get(4)?,
        inclusion: r.get(5)?,
        exclusion: r.get(6)?,
        example_excerpt_id: r.get(7)?,
        shortcut: r.get(8)?,
        sort_order: r.get(9)?,
        excerpt_count: r.get(10)?,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

pub fn list(conn: &Connection) -> Result<Vec<Code>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM codes c ORDER BY c.parent_id IS NOT NULL, c.parent_id, c.sort_order, c.created_at"
    ))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Code> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM codes c WHERE c.id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("code {id} not found")))
}

fn validate_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("code name is required".into()));
    }
    Ok(name)
}

fn validate_color(color: &str) -> Result<()> {
    let ok = color.len() == 7
        && color.starts_with('#')
        && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    if ok {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "invalid color {color:?}; use #RRGGBB"
        )))
    }
}

fn validate_shortcut(shortcut: Option<&str>) -> Result<Option<String>> {
    match shortcut.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(s) => {
            let mut chars = s.chars();
            let c = chars.next().unwrap();
            if chars.next().is_some() || !(c.is_ascii_alphanumeric()) {
                return Err(AppError::Validation(
                    "shortcut must be a single letter or digit".into(),
                ));
            }
            Ok(Some(c.to_ascii_lowercase().to_string()))
        }
    }
}

fn map_unique(e: rusqlite::Error, name: &str, shortcut: Option<&str>) -> AppError {
    let msg = e.to_string();
    // SQLite names plain-column indexes by column ("codes.shortcut") and
    // expression indexes by index name ("index 'codes_sibling_name_uq'").
    if msg.contains("codes_sibling_name_uq") || msg.contains("codes.name") {
        AppError::Conflict(format!(
            "a code named {name:?} already exists at this level"
        ))
    } else if msg.contains("codes_shortcut_uq") || msg.contains("codes.shortcut") {
        AppError::Conflict(format!(
            "shortcut {:?} is already used by another code",
            shortcut.unwrap_or("")
        ))
    } else {
        AppError::from(e)
    }
}

fn next_sort_order(conn: &Connection, parent_id: Option<&str>) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM codes WHERE parent_id IS ?1",
        [parent_id],
        |r| r.get(0),
    )?)
}

fn ensure_exists(conn: &Connection, id: &str) -> Result<()> {
    get(conn, id).map(|_| ())
}

/// An example excerpt has to be a real excerpt; anything else is a `NotFound`
/// rather than a dangling pointer the UI would have to explain later.
fn validate_example(conn: &Connection, excerpt_id: Option<&str>) -> Result<Option<String>> {
    match excerpt_id.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(id) => {
            let exists: bool = conn.query_row(
                "SELECT EXISTS (SELECT 1 FROM excerpts WHERE id = ?1)",
                [id],
                |r| r.get(0),
            )?;
            if exists {
                Ok(Some(id.to_string()))
            } else {
                Err(AppError::NotFound(format!("excerpt {id} not found")))
            }
        }
    }
}

pub fn create(conn: &Connection, input: NewCode) -> Result<Code> {
    let name = validate_name(&input.name)?;
    if let Some(p) = &input.parent_id {
        ensure_exists(conn, p)?;
    }
    let color = match input.color {
        Some(c) => {
            validate_color(&c)?;
            c
        }
        None => {
            let n: i64 = conn.query_row("SELECT count(*) FROM codes", [], |r| r.get(0))?;
            PALETTE[(n as usize) % PALETTE.len()].to_string()
        }
    };
    let shortcut = validate_shortcut(input.shortcut.as_deref())?;
    let id = util::new_id();
    let now = util::now();
    let sort_order = next_sort_order(conn, input.parent_id.as_deref())?;
    conn.execute(
        "INSERT INTO codes (id, parent_id, name, color, description, inclusion, exclusion,
                            shortcut, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![
            id,
            input.parent_id,
            name,
            color,
            input.description.unwrap_or_default(),
            input.inclusion.unwrap_or_default(),
            input.exclusion.unwrap_or_default(),
            shortcut,
            sort_order,
            now
        ],
    )
    .map_err(|e| map_unique(e, name, shortcut.as_deref()))?;
    let code = get(conn, &id)?;
    // Redoing a create puts the very same row back, id and all, rather than
    // making a second code that only looks the same.
    let snapshot = snapshot_codes(conn, std::slice::from_ref(&id))?;
    activity::record(
        conn,
        "code.created",
        "code",
        Some(&code.id),
        format!("Created code \"{}\"", code.name),
        json!({
            "name": code.name,
            "parentId": code.parent_id,
            "parentName": code.parent_id.as_deref().map(|p| activity::code_name(conn, p)),
            "color": code.color,
            "description": code.description,
            "shortcut": code.shortcut,
        }),
        Some(history::payload(&CodeOp::Restore {
            snapshot,
            reparent: vec![],
            remove_tags: vec![],
        })),
        Some(history::payload(&CodeOp::Drop {
            code_ids: vec![code.id.clone()],
        })),
    )?;
    Ok(code)
}

pub fn update(conn: &Connection, id: &str, patch: CodePatch) -> Result<Code> {
    let current = get(conn, id)?;
    let name = match &patch.name {
        Some(n) => validate_name(n)?.to_string(),
        None => current.name.clone(),
    };
    let color = match &patch.color {
        Some(c) => {
            validate_color(c)?;
            c.clone()
        }
        None => current.color.clone(),
    };
    let description = patch.description.unwrap_or(current.description.clone());
    let inclusion = patch.inclusion.unwrap_or(current.inclusion.clone());
    let exclusion = patch.exclusion.unwrap_or(current.exclusion.clone());
    let shortcut = match patch.shortcut {
        Some(s) => validate_shortcut(s.as_deref())?,
        None => current.shortcut.clone(),
    };
    let example_excerpt_id = match patch.example_excerpt_id {
        Some(e) => validate_example(conn, e.as_deref())?,
        None => current.example_excerpt_id.clone(),
    };
    conn.execute(
        "UPDATE codes SET name = ?2, color = ?3, description = ?4, inclusion = ?5, exclusion = ?6,
                          shortcut = ?7, example_excerpt_id = ?8, updated_at = ?9
         WHERE id = ?1",
        params![
            id,
            name,
            color,
            description,
            inclusion,
            exclusion,
            shortcut,
            example_excerpt_id,
            util::now()
        ],
    )
    .map_err(|e| map_unique(e, &name, shortcut.as_deref()))?;
    let updated = get(conn, id)?;
    log_update(conn, &current, &updated)?;
    Ok(updated)
}

/// One `code.updated` entry per real change, with every field that moved
/// recorded as `{"from": …, "to": …}`. An update that changes nothing (the
/// dialog saved without an edit) writes nothing, so the log stays readable.
fn log_update(conn: &Connection, before: &Code, after: &Code) -> Result<()> {
    let mut detail = serde_json::Map::new();
    let mut fields: Vec<&str> = vec![];
    if before.name != after.name {
        fields.push("name");
        detail.insert(
            "name".into(),
            activity::change(before.name.clone(), after.name.clone()),
        );
    }
    if before.description != after.description {
        fields.push("description");
        detail.insert(
            "description".into(),
            activity::change(before.description.clone(), after.description.clone()),
        );
    }
    if before.color != after.color {
        fields.push("color");
        detail.insert(
            "color".into(),
            activity::change(before.color.clone(), after.color.clone()),
        );
    }
    if before.inclusion != after.inclusion {
        fields.push("inclusion");
        detail.insert(
            "inclusion".into(),
            activity::change(before.inclusion.clone(), after.inclusion.clone()),
        );
    }
    if before.exclusion != after.exclusion {
        fields.push("exclusion");
        detail.insert(
            "exclusion".into(),
            activity::change(before.exclusion.clone(), after.exclusion.clone()),
        );
    }
    if before.shortcut != after.shortcut {
        fields.push("shortcut");
        detail.insert(
            "shortcut".into(),
            activity::change(before.shortcut.clone(), after.shortcut.clone()),
        );
    }
    if before.example_excerpt_id != after.example_excerpt_id {
        fields.push("example");
        detail.insert(
            "example".into(),
            activity::change(
                before.example_excerpt_id.clone(),
                after.example_excerpt_id.clone(),
            ),
        );
    }
    if fields.is_empty() {
        return Ok(());
    }
    let summary = if before.name != after.name {
        format!("Renamed code \"{}\" to \"{}\"", before.name, after.name)
    } else {
        format!("Changed {} of code \"{}\"", fields.join(", "), after.name)
    };
    detail.insert("changed".into(), json!(fields));
    activity::record(
        conn,
        "code.updated",
        "code",
        Some(&after.id),
        summary,
        Value::Object(detail),
        Some(history::payload(&update_op(after))),
        Some(history::payload(&update_op(before))),
    )
}

/// Every editable field of a code as a patch, so replaying in either
/// direction sets the whole row rather than layering one change on another.
fn update_op(code: &Code) -> CodeOp {
    CodeOp::Update {
        code_id: code.id.clone(),
        patch: Box::new(CodePatch {
            name: Some(code.name.clone()),
            color: Some(code.color.clone()),
            description: Some(code.description.clone()),
            inclusion: Some(code.inclusion.clone()),
            exclusion: Some(code.exclusion.clone()),
            shortcut: Some(code.shortcut.clone()),
            example_excerpt_id: Some(code.example_excerpt_id.clone()),
        }),
        updated_at: code.updated_at.clone(),
    }
}

/// All ids in the subtrees rooted at `roots` (roots included), via a recursive CTE.
pub fn descendant_ids(conn: &Connection, roots: &[String]) -> Result<Vec<String>> {
    if roots.is_empty() {
        return Ok(vec![]);
    }
    let placeholders = roots.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "WITH RECURSIVE sub(id) AS (
            SELECT id FROM codes WHERE id IN ({placeholders})
            UNION
            SELECT c.id FROM codes c JOIN sub ON c.parent_id = sub.id
         ) SELECT id FROM sub"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(roots.iter()), |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn renumber(conn: &Connection, parent_id: Option<&str>) -> Result<()> {
    let mut stmt =
        conn.prepare("SELECT id FROM codes WHERE parent_id IS ?1 ORDER BY sort_order, created_at")?;
    let ids: Vec<String> = stmt
        .query_map([parent_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE codes SET sort_order = ?2 WHERE id = ?1",
            params![id, i as i64],
        )?;
    }
    Ok(())
}

/// Move a code under `new_parent_id` (None = root) at sibling position `index`.
pub fn move_code(
    conn: &Connection,
    id: &str,
    new_parent_id: Option<&str>,
    index: i64,
) -> Result<Code> {
    let current = get(conn, id)?;
    if let Some(p) = new_parent_id {
        ensure_exists(conn, p)?;
        let subtree = descendant_ids(conn, &[id.to_string()])?;
        if subtree.iter().any(|s| s == p) {
            return Err(AppError::Validation(
                "cannot move a code inside its own subtree".into(),
            ));
        }
    }
    let now = util::now();
    let tx = util::tx(conn)?;
    // Take it out of the old sibling group, then compact that group.
    tx.execute(
        "UPDATE codes SET parent_id = ?2, sort_order = -1, updated_at = ?3 WHERE id = ?1",
        params![id, new_parent_id, now],
    )
    .map_err(|e| map_unique(e, &current.name, None))?;
    if current.parent_id.as_deref() != new_parent_id {
        renumber(&tx, current.parent_id.as_deref())?;
    }
    // Build the new sibling order with `id` at `index`.
    let mut stmt = tx.prepare(
        "SELECT id FROM codes WHERE parent_id IS ?1 AND id <> ?2 ORDER BY sort_order, created_at",
    )?;
    let mut siblings: Vec<String> = stmt
        .query_map(params![new_parent_id, id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    let index = index.clamp(0, siblings.len() as i64) as usize;
    siblings.insert(index, id.to_string());
    for (i, sid) in siblings.iter().enumerate() {
        tx.execute(
            "UPDATE codes SET sort_order = ?2 WHERE id = ?1",
            params![sid, i as i64],
        )?;
    }
    let destination = match new_parent_id {
        Some(p) => format!("under \"{}\"", activity::code_name(&tx, p)),
        None => "to the top level".to_string(),
    };
    activity::record(
        &tx,
        "code.moved",
        "code",
        Some(id),
        format!("Moved code \"{}\" {destination}", current.name),
        json!({
            "name": current.name,
            "parentId": activity::change(current.parent_id.clone(), new_parent_id.map(String::from)),
            "parentName": activity::change(
                current.parent_id.as_deref().map(|p| activity::code_name(&tx, p)),
                new_parent_id.map(|p| activity::code_name(&tx, p)),
            ),
            "index": activity::change(current.sort_order, index as i64),
        }),
        Some(history::payload(&CodeOp::Move {
            code_id: id.to_string(),
            parent_id: new_parent_id.map(String::from),
            index: index as i64,
            updated_at: now.clone(),
        })),
        Some(history::payload(&CodeOp::Move {
            code_id: id.to_string(),
            parent_id: current.parent_id.clone(),
            index: current.sort_order,
            updated_at: current.updated_at.clone(),
        })),
    )?;
    tx.commit()?;
    get(conn, id)
}

/// Read one group of siblings in order. Restoring a code has to put it back
/// between the same two neighbours; a renumber alone would only guess.
fn sibling_group(conn: &Connection, parent_id: Option<&str>) -> Result<SiblingGroup> {
    let mut stmt =
        conn.prepare("SELECT id FROM codes WHERE parent_id IS ?1 ORDER BY sort_order, created_at")?;
    let ids: Vec<String> = stmt
        .query_map([parent_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(SiblingGroup {
        parent_id: parent_id.map(String::from),
        ids,
    })
}

/// Put the given sibling groups back in the recorded order. Ids that are gone
/// are skipped, and anything that appeared since is appended after them.
pub fn apply_sibling_order(conn: &Connection, groups: &[SiblingGroup]) -> Result<()> {
    for group in groups {
        let current = sibling_group(conn, group.parent_id.as_deref())?;
        let mut order: Vec<&String> = group
            .ids
            .iter()
            .filter(|id| current.ids.contains(id))
            .collect();
        order.extend(current.ids.iter().filter(|id| !group.ids.contains(id)));
        for (i, id) in order.iter().enumerate() {
            conn.execute(
                "UPDATE codes SET sort_order = ?2 WHERE id = ?1",
                params![id, i as i64],
            )?;
        }
    }
    Ok(())
}

/// Order `ids` parents-before-children, so reinserting them never trips the
/// `parent_id` foreign key. Codes whose parent is outside the set come first.
fn parents_first(rows: Vec<CodeRow>) -> Vec<CodeRow> {
    let inside: std::collections::HashSet<&str> = rows.iter().map(|r| r.id.as_str()).collect();
    let mut placed: std::collections::HashSet<String> = rows
        .iter()
        .filter(|r| !r.parent_id.as_deref().is_some_and(|p| inside.contains(p)))
        .map(|r| r.id.clone())
        .collect();
    let mut out: Vec<CodeRow> = rows
        .iter()
        .filter(|r| placed.contains(&r.id))
        .cloned()
        .collect();
    let mut rest: Vec<CodeRow> = rows
        .into_iter()
        .filter(|r| !placed.contains(&r.id))
        .collect();
    while !rest.is_empty() {
        let (ready, waiting): (Vec<CodeRow>, Vec<CodeRow>) = rest
            .into_iter()
            .partition(|r| r.parent_id.as_deref().is_some_and(|p| placed.contains(p)));
        if ready.is_empty() {
            // A cycle cannot happen (the table forbids it), but never loop.
            out.extend(waiting);
            return out;
        }
        for r in &ready {
            placed.insert(r.id.clone());
        }
        out.extend(ready);
        rest = waiting;
    }
    out
}

fn in_list(n: usize) -> String {
    std::iter::repeat_n("?", n).collect::<Vec<_>>().join(",")
}

/// Everything that would be lost if exactly these codes were deleted.
pub fn snapshot_codes(conn: &Connection, ids: &[String]) -> Result<CodeTreeSnapshot> {
    let mut snap = CodeTreeSnapshot::default();
    if ids.is_empty() {
        return Ok(snap);
    }
    let list = in_list(ids.len());
    let args = || rusqlite::params_from_iter(ids.iter());

    let mut stmt = conn.prepare(&format!(
        "SELECT id, parent_id, name, color, description, inclusion, exclusion,
                shortcut, sort_order, created_at, updated_at
         FROM codes WHERE id IN ({list}) ORDER BY sort_order, created_at"
    ))?;
    let rows: Vec<CodeRow> = stmt
        .query_map(args(), |r| {
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
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    snap.codes = parents_first(rows);

    // The group each snapshotted code sits in, plus the group underneath it,
    // so both its own place and its children's order survive.
    let mut groups: Vec<Option<String>> = vec![];
    for row in &snap.codes {
        for parent in [row.parent_id.clone(), Some(row.id.clone())] {
            if !groups.contains(&parent) {
                groups.push(parent);
            }
        }
    }
    for parent in groups {
        snap.sibling_order
            .push(sibling_group(conn, parent.as_deref())?);
    }

    let mut stmt = conn.prepare(&format!(
        "SELECT excerpt_id, code_id, coder_id, created_at FROM excerpt_codes
          WHERE code_id IN ({list}) ORDER BY excerpt_id, code_id, coder_id"
    ))?;
    snap.excerpt_codes = stmt
        .query_map(args(), |r| {
            Ok(TagRow {
                excerpt_id: r.get(0)?,
                code_id: r.get(1)?,
                coder_id: r.get(2)?,
                created_at: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(&format!(
        "SELECT id, document_id, code_id, excerpt_id, title, body, coder_id,
                created_at, updated_at
         FROM memos WHERE code_id IN ({list}) ORDER BY id"
    ))?;
    snap.memos = stmt
        .query_map(args(), super::memos::from_row)?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(&format!(
        "SELECT sm.set_id, sm.member_id FROM set_members sm
           JOIN sets s ON s.id = sm.set_id
          WHERE s.kind = 'code' AND sm.member_id IN ({list})
          ORDER BY sm.set_id, sm.member_id"
    ))?;
    snap.set_members = stmt
        .query_map(args(), |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(&format!(
        "SELECT matrix_id, row_key, code_id, summary, updated_at FROM framework_cells
          WHERE code_id IN ({list}) ORDER BY matrix_id, row_key, code_id"
    ))?;
    snap.framework_cells = stmt
        .query_map(args(), |r| {
            Ok(FrameworkCellRow {
                matrix_id: r.get(0)?,
                row_key: r.get(1)?,
                code_id: r.get(2)?,
                summary: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(&format!(
        "SELECT id, example_excerpt_id FROM codes
          WHERE id IN ({list}) AND example_excerpt_id IS NOT NULL ORDER BY id"
    ))?;
    snap.example_refs = stmt
        .query_map(args(), |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(snap)
}

/// [`snapshot_codes`] for a whole branch: `id` and everything under it.
pub fn snapshot_subtree(conn: &Connection, id: &str) -> Result<CodeTreeSnapshot> {
    let ids = descendant_ids(conn, &[id.to_string()])?;
    snapshot_codes(conn, &ids)
}

/// Put a snapshot back, ids and all.
///
/// Rows that point at something deleted in the meantime are skipped rather
/// than failing the restore: a code can come back even if the excerpt someone
/// held up as its example, or the set it belonged to, has gone since.
pub fn restore_subtree(conn: &Connection, snap: &CodeTreeSnapshot) -> Result<()> {
    let tx = util::tx(conn)?;
    for c in &snap.codes {
        tx.execute(
            "INSERT INTO codes (id, parent_id, name, color, description, inclusion, exclusion,
                                shortcut, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                c.id,
                c.parent_id,
                c.name,
                c.color,
                c.description,
                c.inclusion,
                c.exclusion,
                c.shortcut,
                c.sort_order,
                c.created_at,
                c.updated_at
            ],
        )
        .map_err(|e| map_unique(e, &c.name, c.shortcut.as_deref()))?;
    }
    for (code_id, excerpt_id) in &snap.example_refs {
        tx.execute(
            "UPDATE codes SET example_excerpt_id = ?2 WHERE id = ?1
               AND EXISTS (SELECT 1 FROM excerpts WHERE id = ?2)",
            params![code_id, excerpt_id],
        )?;
    }
    for t in &snap.excerpt_codes {
        tx.execute(
            "INSERT OR IGNORE INTO excerpt_codes (excerpt_id, code_id, coder_id, created_at)
             SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM excerpts WHERE id = ?1)",
            params![
                t.excerpt_id,
                t.code_id,
                history::tag_coder(&tx, t),
                t.created_at
            ],
        )?;
    }
    for m in &snap.memos {
        tx.execute(
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
    for (set_id, member_id) in &snap.set_members {
        tx.execute(
            "INSERT OR IGNORE INTO set_members (set_id, member_id)
             SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM sets WHERE id = ?1)",
            params![set_id, member_id],
        )?;
    }
    for cell in &snap.framework_cells {
        tx.execute(
            "INSERT OR REPLACE INTO framework_cells (matrix_id, row_key, code_id, summary, updated_at)
             SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM framework_matrices WHERE id = ?1)",
            params![cell.matrix_id, cell.row_key, cell.code_id, cell.summary, cell.updated_at],
        )?;
    }
    apply_sibling_order(&tx, &snap.sibling_order)?;
    tx.commit()
}

/// Delete codes outright, with no strategy and no log entry: the inverse of
/// having created them. Their subtrees, tags and memos cascade.
pub fn delete_codes(conn: &Connection, ids: &[String]) -> Result<()> {
    let tx = util::tx(conn)?;
    let mut parents: Vec<Option<String>> = vec![];
    for id in ids {
        let parent: Option<Option<String>> = tx
            .query_row("SELECT parent_id FROM codes WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .optional()?;
        if let Some(parent) = parent {
            if !parents.contains(&parent) {
                parents.push(parent);
            }
        }
        tx.execute("DELETE FROM codes WHERE id = ?1", [id])?;
    }
    for parent in parents {
        renumber(&tx, parent.as_deref())?;
    }
    tx.commit()
}

/// Where each of `id`'s children sits right now, so an undo can put them back
/// under it after a `promote` delete or a merge moved them elsewhere.
fn child_places(conn: &Connection, id: &str) -> Result<Vec<Reparent>> {
    let mut stmt = conn.prepare(
        "SELECT id, sort_order, updated_at FROM codes WHERE parent_id = ?1 ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([id], |r| {
        Ok(Reparent {
            code_id: r.get(0)?,
            parent_id: Some(id.to_string()),
            sort_order: r.get(1)?,
            updated_at: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Where these codes sit right now, for a redo to put them back after the
/// operation's own renumbering has run.
fn places_of(conn: &Connection, ids: &[String]) -> Result<Vec<Reparent>> {
    let mut out = vec![];
    for id in ids {
        if let Some(r) = conn
            .query_row(
                "SELECT parent_id, sort_order, updated_at FROM codes WHERE id = ?1",
                [id],
                |r| {
                    Ok(Reparent {
                        code_id: id.clone(),
                        parent_id: r.get(0)?,
                        sort_order: r.get(1)?,
                        updated_at: r.get(2)?,
                    })
                },
            )
            .optional()?
        {
            out.push(r);
        }
    }
    Ok(out)
}

/// The tags `target` is about to gain from `source`: the excerpts carrying
/// the one and not the other. Undoing a merge takes exactly these back and
/// leaves alone the excerpts that already had the target.
fn tags_gained(conn: &Connection, source_id: &str, target_id: &str) -> Result<Vec<TagRow>> {
    let mut stmt = conn.prepare(
        "SELECT s.excerpt_id, s.coder_id FROM excerpt_codes s
          WHERE s.code_id = ?1
            AND NOT EXISTS (SELECT 1 FROM excerpt_codes t
                             WHERE t.code_id = ?2 AND t.excerpt_id = s.excerpt_id
                               AND t.coder_id = s.coder_id)
          ORDER BY s.excerpt_id, s.coder_id",
    )?;
    let rows = stmt.query_map(params![source_id, target_id], |r| {
        Ok(TagRow {
            excerpt_id: r.get(0)?,
            code_id: target_id.to_string(),
            coder_id: r.get(1)?,
            created_at: String::new(),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn impact(conn: &Connection, id: &str) -> Result<CodeImpact> {
    ensure_exists(conn, id)?;
    let subtree = descendant_ids(conn, &[id.to_string()])?;
    let placeholders = subtree.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let excerpt_count: i64 = conn.query_row(
        &format!(
            "SELECT count(DISTINCT excerpt_id) FROM excerpt_codes WHERE code_id IN ({placeholders})"
        ),
        rusqlite::params_from_iter(subtree.iter()),
        |r| r.get(0),
    )?;
    Ok(CodeImpact {
        descendant_count: subtree.len() as i64 - 1,
        excerpt_count,
    })
}

/// Delete a code. Children are either deleted with it or promoted to its parent.
pub fn delete(conn: &Connection, id: &str, children: ChildrenStrategy) -> Result<DeleteCodeReport> {
    let code = get(conn, id)?;
    let tx = util::tx(conn)?;
    // Captured before anything moves: with `delete` the whole branch has to
    // come back, with `promote` only this code, because its children survive
    // one level up and are put back underneath it by `reparent`.
    let snapshot = match children {
        ChildrenStrategy::Delete => snapshot_subtree(&tx, id)?,
        ChildrenStrategy::Promote => snapshot_codes(&tx, &[id.to_string()])?,
    };
    let reparent = match children {
        ChildrenStrategy::Delete => vec![],
        ChildrenStrategy::Promote => child_places(&tx, id)?,
    };
    // Which children a `promote` moves up, so redoing lands them in the same
    // place with the same timestamps rather than today's.
    let now = util::now();
    let mut promoted: Vec<String> = vec![];
    let (deleted_ids, affected) = match children {
        ChildrenStrategy::Delete => {
            let subtree = descendant_ids(&tx, &[id.to_string()])?;
            let affected = impact(&tx, id)?.excerpt_count;
            (subtree, affected)
        }
        ChildrenStrategy::Promote => {
            let affected: i64 = tx.query_row(
                "SELECT count(DISTINCT excerpt_id) FROM excerpt_codes WHERE code_id = ?1",
                [id],
                |r| r.get(0),
            )?;
            let base = next_sort_order(&tx, code.parent_id.as_deref())?;
            let mut stmt =
                tx.prepare("SELECT id FROM codes WHERE parent_id = ?1 ORDER BY sort_order")?;
            let kids: Vec<String> = stmt
                .query_map([id], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?;
            drop(stmt);
            for (i, kid) in kids.iter().enumerate() {
                tx.execute(
                    "UPDATE codes SET parent_id = ?2, sort_order = ?3, updated_at = ?4 WHERE id = ?1",
                    params![kid, code.parent_id, base + i as i64, now],
                )
                .map_err(|e| map_unique(e, "child", None))?;
                promoted.push(kid.clone());
            }
            (vec![id.to_string()], affected)
        }
    };
    tx.execute("DELETE FROM codes WHERE id = ?1", [id])?;
    renumber(&tx, code.parent_id.as_deref())?;
    // Read after the renumber: that is where the children actually ended up.
    let promoted = places_of(&tx, &promoted)?;
    activity::record(
        &tx,
        "code.deleted",
        "code",
        Some(id),
        format!("Deleted code \"{}\"", code.name),
        json!({
            "name": code.name,
            "parentId": code.parent_id,
            "description": code.description,
            "shortcut": code.shortcut,
            "children": match children {
                ChildrenStrategy::Delete => "delete",
                ChildrenStrategy::Promote => "promote",
            },
            "deletedCodeIds": deleted_ids,
            "affectedExcerptCount": affected,
        }),
        Some(history::payload(&CodeOp::Delete {
            code_id: id.to_string(),
            strategy: children,
            reparent: promoted,
        })),
        Some(history::payload(&CodeOp::Restore {
            snapshot,
            reparent,
            remove_tags: vec![],
        })),
    )?;
    tx.commit()?;
    Ok(DeleteCodeReport {
        deleted_code_ids: deleted_ids,
        affected_excerpt_count: affected,
    })
}

/// Merge `source` into `target`: excerpts, children and memos move to the target.
pub fn merge(conn: &Connection, source_id: &str, target_id: &str) -> Result<Code> {
    if source_id == target_id {
        return Err(AppError::Validation(
            "cannot merge a code into itself".into(),
        ));
    }
    let source = get(conn, source_id)?;
    ensure_exists(conn, target_id)?;
    let subtree = descendant_ids(conn, &[source_id.to_string()])?;
    if subtree.iter().any(|s| s == target_id) {
        return Err(AppError::Validation(
            "cannot merge a code into one of its own descendants".into(),
        ));
    }
    let now = util::now();
    let tx = util::tx(conn)?;
    // Everything the merge is about to take from the source, read while it is
    // still there. Its children are not in the snapshot: they survive under
    // the target and `reparent` walks them back.
    let snapshot = snapshot_codes(&tx, &[source_id.to_string()])?;
    let reparent = child_places(&tx, source_id)?;
    let gained = tags_gained(&tx, source_id, target_id)?;
    // Each coding moves as its own coder's, so merging two codes never
    // reassigns somebody else's work to whoever ran the merge.
    let moved_excerpts = tx.execute(
        "INSERT OR IGNORE INTO excerpt_codes (excerpt_id, code_id, coder_id, created_at)
         SELECT excerpt_id, ?2, coder_id, created_at FROM excerpt_codes WHERE code_id = ?1",
        params![source_id, target_id],
    )? as i64;
    let base = next_sort_order(&tx, Some(target_id))?;
    let mut stmt = tx.prepare("SELECT id FROM codes WHERE parent_id = ?1 ORDER BY sort_order")?;
    let kids: Vec<String> = stmt
        .query_map([source_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    let mut moved_children: Vec<String> = vec![];
    for (i, kid) in kids.iter().enumerate() {
        tx.execute(
            "UPDATE codes SET parent_id = ?2, sort_order = ?3, updated_at = ?4 WHERE id = ?1",
            params![kid, target_id, base + i as i64, now],
        )
        .map_err(|e| map_unique(e, "child", None))?;
        moved_children.push(kid.clone());
    }
    tx.execute(
        "UPDATE memos SET code_id = ?2, updated_at = ?3 WHERE code_id = ?1",
        params![source_id, target_id, now],
    )?;
    let target_name = activity::code_name(&tx, target_id);
    tx.execute("DELETE FROM codes WHERE id = ?1", [source_id])?;
    renumber(&tx, source.parent_id.as_deref())?;
    let moved_children = places_of(&tx, &moved_children)?;
    let moved_memos = super::memos::list(
        &tx,
        &crate::models::MemoTarget {
            code_id: Some(target_id.to_string()),
            ..Default::default()
        },
    )?;
    // Two entries, one per side: a merge is the one operation both codes'
    // histories have to show, and the source's row is about to disappear.
    // One group, so undo takes the whole merge back in one step.
    let summary = format!("Merged code \"{}\" into \"{target_name}\"", source.name);
    history::begin_group(&tx, &summary)?;
    activity::record(
        &tx,
        "code.merged_into",
        "code",
        Some(source_id),
        &summary,
        json!({
            "name": source.name,
            "targetId": target_id,
            "targetName": target_name,
            "movedExcerptCount": moved_excerpts,
        }),
        // The second entry carries the payloads for both.
        Some(history::noop()),
        Some(history::noop()),
    )?;
    activity::record(
        &tx,
        "code.merged_from",
        "code",
        Some(target_id),
        &summary,
        json!({
            "name": target_name,
            "sourceId": source_id,
            "sourceName": source.name,
            "movedExcerptCount": moved_excerpts,
        }),
        Some(history::payload(&CodeOp::Merge {
            source_id: source_id.to_string(),
            target_id: target_id.to_string(),
            reparent: moved_children,
            memos: moved_memos,
        })),
        Some(history::payload(&CodeOp::Restore {
            snapshot,
            reparent,
            remove_tags: gained,
        })),
    )?;
    history::end_group(&tx)?;
    tx.commit()?;
    get(conn, target_id)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::OpenProject;

    pub(crate) fn mk(conn: &Connection, name: &str, parent: Option<&str>) -> Code {
        create(
            conn,
            NewCode {
                name: name.into(),
                parent_id: parent.map(String::from),
                ..Default::default()
            },
        )
        .unwrap()
    }

    #[test]
    fn create_assigns_palette_color_and_sort_order() {
        let p = OpenProject::in_memory("t").unwrap();
        let a = mk(&p.conn, "Alpha", None);
        let b = mk(&p.conn, "Beta", None);
        assert_eq!(a.color, PALETTE[0]);
        assert_eq!(b.color, PALETTE[1]);
        assert_eq!((a.sort_order, b.sort_order), (0, 1));
        let c = mk(&p.conn, "Child", Some(&a.id));
        assert_eq!(c.sort_order, 0);
        assert_eq!(c.parent_id.as_deref(), Some(a.id.as_str()));
    }

    #[test]
    fn validation_and_uniqueness() {
        let p = OpenProject::in_memory("t").unwrap();
        let a = mk(&p.conn, "Alpha", None);
        assert!(matches!(
            create(
                &p.conn,
                NewCode {
                    name: " alpha ".into(),
                    ..Default::default()
                }
            ),
            Err(AppError::Conflict(_))
        ));
        // Same name is fine under a different parent.
        mk(&p.conn, "Alpha", Some(&a.id));
        assert!(matches!(
            create(
                &p.conn,
                NewCode {
                    name: " ".into(),
                    ..Default::default()
                }
            ),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            create(
                &p.conn,
                NewCode {
                    name: "x".into(),
                    color: Some("red".into()),
                    ..Default::default()
                }
            ),
            Err(AppError::Validation(_))
        ));
        let s1 = create(
            &p.conn,
            NewCode {
                name: "S1".into(),
                shortcut: Some("Q".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(s1.shortcut.as_deref(), Some("q"));
        assert!(matches!(
            create(
                &p.conn,
                NewCode {
                    name: "S2".into(),
                    shortcut: Some("q".into()),
                    ..Default::default()
                }
            ),
            Err(AppError::Conflict(_))
        ));
        assert!(matches!(
            create(
                &p.conn,
                NewCode {
                    name: "S3".into(),
                    shortcut: Some("ab".into()),
                    ..Default::default()
                }
            ),
            Err(AppError::Validation(_))
        ));
        // Patch: clear shortcut, keep name.
        let s1 = update(
            &p.conn,
            &s1.id,
            CodePatch {
                shortcut: Some(None),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(s1.shortcut, None);
        assert_eq!(s1.name, "S1");
        let s1 = update(
            &p.conn,
            &s1.id,
            CodePatch {
                name: Some("Renamed".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(s1.name, "Renamed");
        assert!(matches!(get(&p.conn, "nope"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn descendants_and_cycle_guard() {
        let p = OpenProject::in_memory("t").unwrap();
        let a = mk(&p.conn, "A", None);
        let b = mk(&p.conn, "B", Some(&a.id));
        let c = mk(&p.conn, "C", Some(&b.id));
        let _d = mk(&p.conn, "D", None);
        let mut subtree = descendant_ids(&p.conn, std::slice::from_ref(&a.id)).unwrap();
        subtree.sort();
        let mut expected = vec![a.id.clone(), b.id.clone(), c.id.clone()];
        expected.sort();
        assert_eq!(subtree, expected);
        assert!(matches!(
            move_code(&p.conn, &a.id, Some(&c.id), 0),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            move_code(&p.conn, &a.id, Some(&a.id), 0),
            Err(AppError::Validation(_))
        ));
        assert_eq!(impact(&p.conn, &a.id).unwrap().descendant_count, 2);
    }

    #[test]
    fn move_renumbers_both_sibling_groups() {
        let p = OpenProject::in_memory("t").unwrap();
        let a = mk(&p.conn, "A", None);
        let b = mk(&p.conn, "B", None);
        let c = mk(&p.conn, "C", None);
        let x = mk(&p.conn, "X", Some(&a.id));
        // Move B under A at index 0: root becomes [A, C], A's children [B, X].
        move_code(&p.conn, &b.id, Some(&a.id), 0).unwrap();
        let all = list(&p.conn).unwrap();
        let order = |id: &str| all.iter().find(|k| k.id == id).unwrap().sort_order;
        let parent = |id: &str| all.iter().find(|k| k.id == id).unwrap().parent_id.clone();
        assert_eq!((order(&a.id), order(&c.id)), (0, 1));
        assert_eq!(parent(&b.id).as_deref(), Some(a.id.as_str()));
        assert_eq!((order(&b.id), order(&x.id)), (0, 1));
        // Reorder within the same group: X before B.
        move_code(&p.conn, &x.id, Some(&a.id), 0).unwrap();
        let all = list(&p.conn).unwrap();
        let order = |id: &str| all.iter().find(|k| k.id == id).unwrap().sort_order;
        assert_eq!((order(&x.id), order(&b.id)), (0, 1));
        // Move to root at the end (index beyond length clamps).
        move_code(&p.conn, &x.id, None, 99).unwrap();
        let all = list(&p.conn).unwrap();
        let order = |id: &str| all.iter().find(|k| k.id == id).unwrap().sort_order;
        assert_eq!((order(&a.id), order(&c.id), order(&x.id)), (0, 1, 2));
    }

    #[test]
    fn delete_with_delete_or_promote_children() {
        let p = OpenProject::in_memory("t").unwrap();
        let a = mk(&p.conn, "A", None);
        let b = mk(&p.conn, "B", Some(&a.id));
        let c = mk(&p.conn, "C", Some(&b.id));
        let z = mk(&p.conn, "Z", None);
        let report = delete(&p.conn, &b.id, ChildrenStrategy::Promote).unwrap();
        assert_eq!(report.deleted_code_ids, vec![b.id.clone()]);
        let c = get(&p.conn, &c.id).unwrap();
        assert_eq!(c.parent_id.as_deref(), Some(a.id.as_str()));
        let report = delete(&p.conn, &a.id, ChildrenStrategy::Delete).unwrap();
        assert_eq!(report.deleted_code_ids.len(), 2);
        assert!(matches!(get(&p.conn, &c.id), Err(AppError::NotFound(_))));
        assert_eq!(get(&p.conn, &z.id).unwrap().sort_order, 0);
        assert_eq!(list(&p.conn).unwrap().len(), 1);
    }

    #[test]
    fn definition_fields_default_empty_and_round_trip() {
        let p = OpenProject::in_memory("t").unwrap();
        let a = create(
            &p.conn,
            NewCode {
                name: "Trust".into(),
                description: Some("Talk about trusting the service".into()),
                inclusion: Some("Named trust, reliance or confidence".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(a.description, "Talk about trusting the service");
        assert_eq!(a.inclusion, "Named trust, reliance or confidence");
        assert_eq!(a.exclusion, "");
        assert_eq!(a.example_excerpt_id, None);

        // A bare code starts with both rules empty.
        let b = mk(&p.conn, "Other", None);
        assert_eq!((b.inclusion.as_str(), b.exclusion.as_str()), ("", ""));

        let a = update(
            &p.conn,
            &a.id,
            CodePatch {
                exclusion: Some("Mere satisfaction; use Satisfaction".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(a.exclusion, "Mere satisfaction; use Satisfaction");
        // A patch that touches nothing else leaves inclusion alone.
        assert_eq!(a.inclusion, "Named trust, reliance or confidence");
    }

    #[test]
    fn example_excerpt_must_exist_and_clears_with_null() {
        let p = OpenProject::in_memory("t").unwrap();
        let doc = crate::db::documents::create(
            &p.conn,
            crate::db::documents::tests::new_doc("hello there friend"),
        )
        .unwrap()
        .summary
        .id;
        let code = mk(&p.conn, "Greeting", None);
        let excerpt = crate::db::excerpts::apply_codes(
            &p.conn,
            crate::models::ApplyCodesInput {
                document_id: doc,
                start_pos: Some(0),
                end_pos: Some(5),
                code_ids: vec![code.id.clone()],
                ..Default::default()
            },
        )
        .unwrap()
        .excerpt
        .id;

        assert!(matches!(
            update(
                &p.conn,
                &code.id,
                CodePatch {
                    example_excerpt_id: Some(Some("nope".into())),
                    ..Default::default()
                }
            ),
            Err(AppError::NotFound(_))
        ));
        let code = update(
            &p.conn,
            &code.id,
            CodePatch {
                example_excerpt_id: Some(Some(excerpt.clone())),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(code.example_excerpt_id.as_deref(), Some(excerpt.as_str()));
        // An unrelated patch leaves the example in place.
        let code = update(
            &p.conn,
            &code.id,
            CodePatch {
                description: Some("Saying hello".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(code.example_excerpt_id.as_deref(), Some(excerpt.as_str()));
        // Explicit null clears it.
        let code = update(
            &p.conn,
            &code.id,
            CodePatch {
                example_excerpt_id: Some(None),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(code.example_excerpt_id, None);
    }

    #[test]
    fn merge_moves_children_and_memos() {
        let p = OpenProject::in_memory("t").unwrap();
        let a = mk(&p.conn, "A", None);
        let b = mk(&p.conn, "B", None);
        let kid = mk(&p.conn, "Kid", Some(&b.id));
        p.conn
            .execute(
                "INSERT INTO memos (id, code_id, title, body, created_at, updated_at) VALUES ('m', ?1, '', 'note', 'now', 'now')",
                [&b.id],
            )
            .unwrap();
        assert!(matches!(
            merge(&p.conn, &b.id, &kid.id),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            merge(&p.conn, &b.id, &b.id),
            Err(AppError::Validation(_))
        ));
        merge(&p.conn, &b.id, &a.id).unwrap();
        assert_eq!(
            get(&p.conn, &kid.id).unwrap().parent_id.as_deref(),
            Some(a.id.as_str())
        );
        let memo_code: String = p
            .conn
            .query_row("SELECT code_id FROM memos WHERE id = 'm'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(memo_code, a.id);
        assert!(matches!(get(&p.conn, &b.id), Err(AppError::NotFound(_))));
    }
}
