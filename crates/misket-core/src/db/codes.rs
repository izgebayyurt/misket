//! The codebook: a tree of codes (adjacency list with explicit sibling order).

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util;
use crate::error::{AppError, Result};
use crate::models::{ChildrenStrategy, Code, CodeImpact, CodePatch, DeleteCodeReport, NewCode};

/// Twelve distinguishable highlight colors; new codes cycle through them.
pub const PALETTE: [&str; 12] = [
    "#D9534F", "#F0AD4E", "#5CB85C", "#5BC0DE", "#8E6BBF", "#E96FA6", "#2E8B8B", "#C77D3C",
    "#4A6FA5", "#8AA63B", "#B05C8A", "#6C757D",
];

const COLUMNS: &str = "c.id, c.parent_id, c.name, c.color, c.description, c.shortcut, c.sort_order,
     (SELECT count(*) FROM excerpt_codes ec WHERE ec.code_id = c.id) AS excerpt_count,
     c.created_at, c.updated_at";

fn from_row(r: &Row) -> rusqlite::Result<Code> {
    Ok(Code {
        id: r.get(0)?,
        parent_id: r.get(1)?,
        name: r.get(2)?,
        color: r.get(3)?,
        description: r.get(4)?,
        shortcut: r.get(5)?,
        sort_order: r.get(6)?,
        excerpt_count: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
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
        "INSERT INTO codes (id, parent_id, name, color, description, shortcut, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            input.parent_id,
            name,
            color,
            input.description.unwrap_or_default(),
            shortcut,
            sort_order,
            now
        ],
    )
    .map_err(|e| map_unique(e, name, shortcut.as_deref()))?;
    get(conn, &id)
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
    let shortcut = match patch.shortcut {
        Some(s) => validate_shortcut(s.as_deref())?,
        None => current.shortcut.clone(),
    };
    conn.execute(
        "UPDATE codes SET name = ?2, color = ?3, description = ?4, shortcut = ?5, updated_at = ?6 WHERE id = ?1",
        params![id, name, color, description, shortcut, util::now()],
    )
    .map_err(|e| map_unique(e, &name, shortcut.as_deref()))?;
    get(conn, id)
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
    let tx = conn.unchecked_transaction()?;
    // Take it out of the old sibling group, then compact that group.
    tx.execute(
        "UPDATE codes SET parent_id = ?2, sort_order = -1, updated_at = ?3 WHERE id = ?1",
        params![id, new_parent_id, util::now()],
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
    tx.commit()?;
    get(conn, id)
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
    let tx = conn.unchecked_transaction()?;
    let (deleted_ids, affected) = match children {
        ChildrenStrategy::Delete => {
            let subtree = descendant_ids(&tx, &[id.to_string()])?;
            let affected = impact(&tx, id)?.excerpt_count;
            (subtree, affected)
        }
        ChildrenStrategy::Promote => {
            let affected: i64 = tx.query_row(
                "SELECT count(*) FROM excerpt_codes WHERE code_id = ?1",
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
                    params![kid, code.parent_id, base + i as i64, util::now()],
                )
                .map_err(|e| map_unique(e, "child", None))?;
            }
            (vec![id.to_string()], affected)
        }
    };
    tx.execute("DELETE FROM codes WHERE id = ?1", [id])?;
    renumber(&tx, code.parent_id.as_deref())?;
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
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO excerpt_codes (excerpt_id, code_id, created_at)
         SELECT excerpt_id, ?2, created_at FROM excerpt_codes WHERE code_id = ?1",
        params![source_id, target_id],
    )?;
    let base = next_sort_order(&tx, Some(target_id))?;
    let mut stmt = tx.prepare("SELECT id FROM codes WHERE parent_id = ?1 ORDER BY sort_order")?;
    let kids: Vec<String> = stmt
        .query_map([source_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    for (i, kid) in kids.iter().enumerate() {
        tx.execute(
            "UPDATE codes SET parent_id = ?2, sort_order = ?3, updated_at = ?4 WHERE id = ?1",
            params![kid, target_id, base + i as i64, util::now()],
        )
        .map_err(|e| map_unique(e, "child", None))?;
    }
    tx.execute(
        "UPDATE memos SET code_id = ?2, updated_at = ?3 WHERE code_id = ?1",
        params![source_id, target_id, util::now()],
    )?;
    tx.execute("DELETE FROM codes WHERE id = ?1", [source_id])?;
    renumber(&tx, source.parent_id.as_deref())?;
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
