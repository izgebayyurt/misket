//! Framework matrices: cases down the side, themes across the top, a written
//! summary in every cell (Ritchie & Spencer; NVivo calls them "framework
//! matrices").
//!
//! Only the configuration lives in `framework_matrices`; the rows are
//! recomputed on every read, so importing a document or filling in a
//! descriptor changes the grid without rewriting anything. Summaries are
//! keyed by `row_key` — a document id, or the descriptor value the row groups
//! — so a row keeps its text when the grid is regrouped or reordered.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::{codes, descriptors, documents, export, sets, util};
use crate::error::{AppError, Result};
use crate::models::{
    FrameworkCell, FrameworkMatrix, FrameworkMatrixInput, FrameworkMatrixView,
    FrameworkMatrixWithCells, FrameworkRow,
};

pub const ROW_KINDS: [&str; 2] = ["document", "descriptor_value"];

/// The label of the row holding documents with no value for the grouping
/// field. Its `row_key` is the empty string, which no canonical descriptor
/// value can be.
pub const NO_VALUE_LABEL: &str = "(no value)";

const COLUMNS: &str = "id, name, row_kind, row_field_id, row_set_id, code_set_id,
     code_ids_json, created_at, updated_at";

fn from_row(r: &Row) -> rusqlite::Result<FrameworkMatrix> {
    let code_ids_json: String = r.get(6)?;
    Ok(FrameworkMatrix {
        id: r.get(0)?,
        name: r.get(1)?,
        row_kind: r.get(2)?,
        row_field_id: r.get(3)?,
        row_set_id: r.get(4)?,
        code_set_id: r.get(5)?,
        // Unreadable JSON (hand-edited, or written by a newer build) reads
        // back as "no columns" rather than making the matrix unopenable.
        code_ids: serde_json::from_str(&code_ids_json).unwrap_or_default(),
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

fn validate(input: &FrameworkMatrixInput) -> Result<(String, String)> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("matrix name is required".into()));
    }
    if !ROW_KINDS.contains(&input.row_kind.as_str()) {
        return Err(AppError::Validation(format!(
            "unknown row kind {:?}; use one of {}",
            input.row_kind,
            ROW_KINDS.join(", ")
        )));
    }
    if input.row_kind == "descriptor_value" && input.row_field_id.is_none() {
        return Err(AppError::Validation(
            "grouping rows by a descriptor needs a field".into(),
        ));
    }
    Ok((name.to_string(), input.row_kind.clone()))
}

fn map_unique(e: rusqlite::Error, name: &str) -> AppError {
    if e.to_string().contains("UNIQUE") {
        AppError::Conflict(format!("a matrix named {name:?} already exists"))
    } else {
        AppError::from(e)
    }
}

// ------------------------------------------------------------------ matrices

pub fn list_matrices(conn: &Connection) -> Result<Vec<FrameworkMatrix>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM framework_matrices ORDER BY name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<FrameworkMatrix> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM framework_matrices WHERE id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("framework matrix {id} not found")))
}

/// Create a matrix. `id` lets undo recreate a deleted one with its original
/// identity, so its cells can come back with it.
pub fn create_matrix(
    conn: &Connection,
    input: &FrameworkMatrixInput,
    id: Option<&str>,
) -> Result<FrameworkMatrix> {
    let (name, row_kind) = validate(input)?;
    let id = id.map(str::to_string).unwrap_or_else(util::new_id);
    let now = util::now();
    let code_ids_json = serde_json::to_string(&input.code_ids)?;
    conn.execute(
        "INSERT INTO framework_matrices
           (id, name, row_kind, row_field_id, row_set_id, code_set_id, code_ids_json,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            name,
            row_kind,
            input.row_field_id,
            input.row_set_id,
            input.code_set_id,
            code_ids_json,
            now
        ],
    )
    .map_err(|e| map_unique(e, &name))?;
    get(conn, &id)
}

/// Replace a matrix's whole configuration: its name, its row grouping and its
/// columns. Undo is the same call with the previous configuration.
pub fn update_matrix(
    conn: &Connection,
    id: &str,
    input: &FrameworkMatrixInput,
) -> Result<FrameworkMatrix> {
    let (name, row_kind) = validate(input)?;
    get(conn, id)?;
    let code_ids_json = serde_json::to_string(&input.code_ids)?;
    conn.execute(
        "UPDATE framework_matrices
            SET name = ?2, row_kind = ?3, row_field_id = ?4, row_set_id = ?5,
                code_set_id = ?6, code_ids_json = ?7, updated_at = ?8
          WHERE id = ?1",
        params![
            id,
            name,
            row_kind,
            input.row_field_id,
            input.row_set_id,
            input.code_set_id,
            code_ids_json,
            util::now()
        ],
    )
    .map_err(|e| map_unique(e, &name))?;
    get(conn, id)
}

/// Delete a matrix and hand back everything it held, so undo can restore it
/// with [`restore_matrix`]. The cells go with it through `ON DELETE CASCADE`.
pub fn delete_matrix(conn: &Connection, id: &str) -> Result<FrameworkMatrixWithCells> {
    let matrix = get(conn, id)?;
    let cells = stored_cells(conn, id)?;
    conn.execute("DELETE FROM framework_matrices WHERE id = ?1", [id])?;
    Ok(FrameworkMatrixWithCells { matrix, cells })
}

/// Put a deleted matrix back exactly as it was, summaries included.
pub fn restore_matrix(
    conn: &Connection,
    saved: &FrameworkMatrixWithCells,
) -> Result<FrameworkMatrix> {
    let m = &saved.matrix;
    let code_ids_json = serde_json::to_string(&m.code_ids)?;
    let tx = util::tx(conn)?;
    tx.execute(
        "INSERT INTO framework_matrices
           (id, name, row_kind, row_field_id, row_set_id, code_set_id, code_ids_json,
            created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            m.id,
            m.name,
            m.row_kind,
            m.row_field_id,
            m.row_set_id,
            m.code_set_id,
            code_ids_json,
            m.created_at,
            m.updated_at
        ],
    )
    .map_err(|e| map_unique(e, &m.name))?;
    let now = util::now();
    for (row_key, code_id, summary) in &saved.cells {
        tx.execute(
            "INSERT INTO framework_cells (matrix_id, row_key, code_id, summary, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![m.id, row_key, code_id, summary, now],
        )?;
    }
    tx.commit()?;
    get(conn, &m.id)
}

fn stored_cells(conn: &Connection, matrix_id: &str) -> Result<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT row_key, code_id, summary FROM framework_cells
         WHERE matrix_id = ?1 ORDER BY row_key, code_id",
    )?;
    let rows = stmt.query_map([matrix_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Write one cell's summary, returning what was there before so the caller's
/// undo stack can put it back. An empty (or all-whitespace) summary deletes
/// the row rather than storing a blank one.
pub fn set_cell_summary(
    conn: &Connection,
    matrix_id: &str,
    row_key: &str,
    code_id: &str,
    summary: &str,
) -> Result<String> {
    get(conn, matrix_id)?;
    let previous: Option<String> = conn
        .query_row(
            "SELECT summary FROM framework_cells
             WHERE matrix_id = ?1 AND row_key = ?2 AND code_id = ?3",
            params![matrix_id, row_key, code_id],
            |r| r.get(0),
        )
        .optional()?;
    if summary.trim().is_empty() {
        conn.execute(
            "DELETE FROM framework_cells WHERE matrix_id = ?1 AND row_key = ?2 AND code_id = ?3",
            params![matrix_id, row_key, code_id],
        )?;
    } else {
        conn.execute(
            "INSERT INTO framework_cells (matrix_id, row_key, code_id, summary, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(matrix_id, row_key, code_id)
               DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at",
            params![matrix_id, row_key, code_id, summary, util::now()],
        )?;
    }
    Ok(previous.unwrap_or_default())
}

// --------------------------------------------------------------------- view

/// The documents a matrix covers, in project order: every document, or the
/// members of `row_set_id`. A set that is gone (or empty) covers none.
fn matrix_documents(
    conn: &Connection,
    matrix: &FrameworkMatrix,
) -> Result<Vec<crate::models::DocumentSummary>> {
    let all = documents::list(conn)?;
    let Some(set_id) = matrix.row_set_id.as_deref() else {
        return Ok(all);
    };
    let members: HashSet<String> = sets::union_members(conn, &[set_id.to_string()])?
        .into_iter()
        .collect();
    Ok(all
        .into_iter()
        .filter(|d| members.contains(&d.id))
        .collect())
}

/// Sort key for a descriptor value, so number fields order numerically,
/// choice fields follow the field's own option order, and everything else
/// (text, ISO dates) sorts as text.
fn value_order(kind: &str, options: &[String], value: &str) -> (usize, Option<i64>, String) {
    match kind {
        "choice" => (
            options
                .iter()
                .position(|o| o.eq_ignore_ascii_case(value))
                .unwrap_or(options.len()),
            None,
            value.to_lowercase(),
        ),
        "number" => (
            0,
            // Millis keep one decimal place's worth of precision in an
            // integer key; ties fall back to the string.
            value.parse::<f64>().ok().map(|n| (n * 1000.0) as i64),
            value.to_string(),
        ),
        _ => (0, None, value.to_lowercase()),
    }
}

fn compute_rows(conn: &Connection, matrix: &FrameworkMatrix) -> Result<Vec<FrameworkRow>> {
    let docs = matrix_documents(conn, matrix)?;
    if matrix.row_kind == "document" {
        return Ok(docs
            .into_iter()
            .map(|d| FrameworkRow {
                row_key: d.id.clone(),
                label: d.name,
                document_ids: vec![d.id],
            })
            .collect());
    }
    // One row per distinct value of the grouping field. A field that has been
    // deleted yields no rows at all rather than one meaningless row.
    let Some(field_id) = matrix.row_field_id.as_deref() else {
        return Ok(vec![]);
    };
    let Ok(field) = descriptors::get_field(conn, field_id) else {
        return Ok(vec![]);
    };
    let mut value_of: HashMap<String, String> = HashMap::new();
    let mut stmt =
        conn.prepare("SELECT document_id, value FROM descriptor_values WHERE field_id = ?1")?;
    for row in stmt.query_map([field_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })? {
        let (document_id, value) = row?;
        value_of.insert(document_id, value);
    }

    let mut groups: Vec<FrameworkRow> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for d in &docs {
        let value = value_of.get(&d.id).cloned().unwrap_or_default();
        match index.get(&value) {
            Some(i) => groups[*i].document_ids.push(d.id.clone()),
            None => {
                index.insert(value.clone(), groups.len());
                groups.push(FrameworkRow {
                    label: if value.is_empty() {
                        NO_VALUE_LABEL.to_string()
                    } else {
                        value.clone()
                    },
                    row_key: value,
                    document_ids: vec![d.id.clone()],
                });
            }
        }
    }
    // "(no value)" last; everything else by the field's own order.
    groups.sort_by(|a, b| {
        (
            a.row_key.is_empty(),
            value_order(&field.kind, &field.options, &a.row_key),
        )
            .cmp(&(
                b.row_key.is_empty(),
                value_order(&field.kind, &field.options, &b.row_key),
            ))
    });
    Ok(groups)
}

/// The matrix's columns: the members of `code_set_id`, or `code_ids`. Either
/// way codes that no longer exist are dropped, and a code set is listed in
/// codebook order so the columns are stable.
fn compute_columns(conn: &Connection, matrix: &FrameworkMatrix) -> Result<Vec<String>> {
    let all = codes::list(conn)?;
    let order: HashMap<&str, usize> = all
        .iter()
        .enumerate()
        .map(|(i, c)| (c.id.as_str(), i))
        .collect();
    let mut ids: Vec<String> = match matrix.code_set_id.as_deref() {
        Some(set_id) => {
            let mut members = sets::union_members(conn, &[set_id.to_string()])?;
            members.sort_by_key(|id| order.get(id.as_str()).copied().unwrap_or(usize::MAX));
            members
        }
        // The picked order is the column order.
        None => matrix.code_ids.clone(),
    };
    ids.retain(|id| order.contains_key(id.as_str()));
    ids.dedup();
    Ok(ids)
}

/// Distinct excerpts per document carrying `code_id` or any of its
/// descendants, for every column at once.
fn counts_by_column(
    conn: &Connection,
    columns: &[String],
) -> Result<HashMap<String, HashMap<String, i64>>> {
    let mut out = HashMap::new();
    if columns.is_empty() {
        return Ok(out);
    }
    let mut stmt = conn.prepare(
        "SELECT ec.code_id, ec.excerpt_id, e.document_id
         FROM excerpt_codes ec JOIN excerpts e ON e.id = ec.excerpt_id",
    )?;
    let tags: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut by_code: HashMap<&str, Vec<(&str, &str)>> = HashMap::new();
    for (code_id, excerpt_id, document_id) in &tags {
        by_code
            .entry(code_id.as_str())
            .or_default()
            .push((excerpt_id.as_str(), document_id.as_str()));
    }
    for code_id in columns {
        let subtree = codes::descendant_ids(conn, std::slice::from_ref(code_id))?;
        let mut seen: HashSet<&str> = HashSet::new();
        let mut per_doc: HashMap<String, i64> = HashMap::new();
        for id in &subtree {
            for (excerpt_id, document_id) in by_code.get(id.as_str()).into_iter().flatten() {
                if seen.insert(excerpt_id) {
                    *per_doc.entry(document_id.to_string()).or_default() += 1;
                }
            }
        }
        out.insert(code_id.clone(), per_doc);
    }
    Ok(out)
}

/// A matrix ready to render: rows computed from the current documents and
/// descriptors, columns resolved to codes that still exist, and one cell per
/// (row, column) pair — summary plus the number of excerpts behind it.
pub fn get_matrix(conn: &Connection, id: &str) -> Result<FrameworkMatrixView> {
    let matrix = get(conn, id)?;
    let rows = compute_rows(conn, &matrix)?;
    let columns = compute_columns(conn, &matrix)?;
    let counts = counts_by_column(conn, &columns)?;
    let summaries: HashMap<(String, String), String> = stored_cells(conn, id)?
        .into_iter()
        .map(|(row_key, code_id, summary)| ((row_key, code_id), summary))
        .collect();

    let mut cells = Vec::with_capacity(rows.len() * columns.len());
    for row in &rows {
        for code_id in &columns {
            let per_doc = counts.get(code_id);
            let excerpt_count = row
                .document_ids
                .iter()
                .filter_map(|d| per_doc.and_then(|m| m.get(d)))
                .sum();
            cells.push(FrameworkCell {
                summary: summaries
                    .get(&(row.row_key.clone(), code_id.clone()))
                    .cloned()
                    .unwrap_or_default(),
                row_key: row.row_key.clone(),
                code_id: code_id.clone(),
                excerpt_count,
            });
        }
    }
    Ok(FrameworkMatrixView {
        matrix,
        rows,
        columns,
        cells,
    })
}

/// The grid as CSV: the row label, then one column per code holding that
/// cell's summary. The header row is the code paths.
pub fn export_csv(conn: &Connection, id: &str) -> Result<String> {
    let view = get_matrix(conn, id)?;
    let paths = export::code_paths(&codes::list(conn)?);
    let summaries: HashMap<(&str, &str), &str> = view
        .cells
        .iter()
        .map(|c| ((c.row_key.as_str(), c.code_id.as_str()), c.summary.as_str()))
        .collect();
    let mut wtr = csv::Writer::from_writer(Vec::new());
    let mut header = vec![view.matrix.name.clone()];
    for code_id in &view.columns {
        header.push(paths.get(code_id).cloned().unwrap_or_default());
    }
    wtr.write_record(&header)?;
    for row in &view.rows {
        let mut record = vec![row.label.clone()];
        for code_id in &view.columns {
            record.push(
                summaries
                    .get(&(row.row_key.as_str(), code_id.as_str()))
                    .copied()
                    .unwrap_or_default()
                    .to_string(),
            );
        }
        wtr.write_record(&record)?;
    }
    let bytes = wtr.into_inner().map_err(|e| AppError::Io(e.to_string()))?;
    String::from_utf8(bytes).map_err(|e| AppError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::codes::tests::mk as mk_code;
    use crate::db::descriptors::tests::mk_field;
    use crate::db::documents::tests::new_doc;
    use crate::db::{descriptors, excerpts, sets, OpenProject};
    use crate::models::{ApplyCodesInput, NewDocument};

    struct Fixture {
        project: OpenProject,
        doc1: String,
        doc2: String,
        doc3: String,
        access: String,
        waiting: String,
        cost: String,
        site: String,
    }

    /// Three documents with a "Site" choice descriptor (doc1 and doc3 are
    /// "North", doc2 has no value), a two-level codebook (Access > Waiting,
    /// Cost) and a handful of coded passages.
    fn fixture() -> Fixture {
        let project = OpenProject::in_memory("t").unwrap();
        let conn = &project.conn;
        let mk_doc = |name: &str, text: &str| {
            documents::create(
                conn,
                NewDocument {
                    name: name.into(),
                    ..new_doc(text)
                },
            )
            .unwrap()
            .summary
            .id
        };
        let doc1 = mk_doc("Interview 1", &"a".repeat(40));
        let doc2 = mk_doc("Interview 2", &"b".repeat(40));
        let doc3 = mk_doc("Interview 3", &"c".repeat(40));

        let access = mk_code(conn, "Access", None).id;
        let waiting = mk_code(conn, "Waiting", Some(&access)).id;
        let cost = mk_code(conn, "Cost", None).id;

        let site = mk_field(conn, "Site", "choice", &["South", "North"]).id;
        descriptors::set_value(conn, &doc1, &site, Some("North")).unwrap();
        descriptors::set_value(conn, &doc3, &site, Some("North")).unwrap();

        // doc1: one Access, one Waiting (a sub-code of Access)
        apply(conn, &doc1, 0, 5, &[&access]);
        apply(conn, &doc1, 10, 15, &[&waiting]);
        // doc2: one Cost
        apply(conn, &doc2, 0, 5, &[&cost]);
        // doc3: one excerpt carrying both Waiting and Cost
        apply(conn, &doc3, 0, 5, &[&waiting, &cost]);

        Fixture {
            project,
            doc1,
            doc2,
            doc3,
            access,
            waiting,
            cost,
            site,
        }
    }

    fn apply(conn: &Connection, doc: &str, start: i64, end: i64, code_ids: &[&str]) {
        excerpts::apply_codes(
            conn,
            ApplyCodesInput {
                document_id: doc.into(),
                start_pos: Some(start),
                end_pos: Some(end),
                code_ids: code_ids.iter().map(|c| c.to_string()).collect(),
                ..Default::default()
            },
        )
        .unwrap();
    }

    fn by_document(name: &str, code_ids: &[&str]) -> FrameworkMatrixInput {
        FrameworkMatrixInput {
            name: name.into(),
            row_kind: "document".into(),
            code_ids: code_ids.iter().map(|c| c.to_string()).collect(),
            ..Default::default()
        }
    }

    fn cell<'a>(view: &'a FrameworkMatrixView, row_key: &str, code_id: &str) -> &'a FrameworkCell {
        view.cells
            .iter()
            .find(|c| c.row_key == row_key && c.code_id == code_id)
            .expect("cell")
    }

    #[test]
    fn create_lists_updates_and_deletes() {
        let f = fixture();
        let conn = &f.project.conn;
        assert!(list_matrices(conn).unwrap().is_empty());

        let m = create_matrix(conn, &by_document("Wave 1", &[&f.access, &f.cost]), None).unwrap();
        assert_eq!(m.name, "Wave 1");
        assert_eq!(m.code_ids, vec![f.access.clone(), f.cost.clone()]);
        assert_eq!(list_matrices(conn).unwrap().len(), 1);

        // Names are unique case-insensitively, and trimmed.
        assert!(matches!(
            create_matrix(conn, &by_document("  wave 1  ", &[]), None),
            Err(AppError::Conflict(_))
        ));
        assert!(matches!(
            create_matrix(conn, &by_document("   ", &[]), None),
            Err(AppError::Validation(_))
        ));
        let bad = FrameworkMatrixInput {
            name: "Bad".into(),
            row_kind: "nonsense".into(),
            ..Default::default()
        };
        assert!(matches!(
            create_matrix(conn, &bad, None),
            Err(AppError::Validation(_))
        ));
        // Grouping by a descriptor needs a field to group by.
        let no_field = FrameworkMatrixInput {
            name: "By site".into(),
            row_kind: "descriptor_value".into(),
            ..Default::default()
        };
        assert!(matches!(
            create_matrix(conn, &no_field, None),
            Err(AppError::Validation(_))
        ));

        // Update replaces the whole configuration.
        let updated = update_matrix(
            conn,
            &m.id,
            &FrameworkMatrixInput {
                name: "By site".into(),
                row_kind: "descriptor_value".into(),
                row_field_id: Some(f.site.clone()),
                code_ids: vec![f.waiting.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(updated.name, "By site");
        assert_eq!(updated.row_kind, "descriptor_value");
        assert_eq!(updated.code_ids, vec![f.waiting.clone()]);
        assert_eq!(updated.created_at, m.created_at);

        assert!(matches!(
            update_matrix(conn, "nope", &by_document("x", &[])),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            get_matrix(conn, "nope"),
            Err(AppError::NotFound(_))
        ));

        delete_matrix(conn, &m.id).unwrap();
        assert!(list_matrices(conn).unwrap().is_empty());
    }

    #[test]
    fn document_rows_count_descendant_inclusive_excerpts() {
        let f = fixture();
        let conn = &f.project.conn;
        let m = create_matrix(conn, &by_document("Wave 1", &[&f.access, &f.cost]), None).unwrap();
        let view = get_matrix(conn, &m.id).unwrap();

        assert_eq!(
            view.rows
                .iter()
                .map(|r| r.label.as_str())
                .collect::<Vec<_>>(),
            vec!["Interview 1", "Interview 2", "Interview 3"]
        );
        assert_eq!(view.rows[0].document_ids, vec![f.doc1.clone()]);
        assert_eq!(view.columns, vec![f.access.clone(), f.cost.clone()]);
        // One cell per (row, column) pair, so the frontend renders a grid.
        assert_eq!(view.cells.len(), 6);

        // Access covers its sub-code Waiting.
        assert_eq!(cell(&view, &f.doc1, &f.access).excerpt_count, 2);
        assert_eq!(cell(&view, &f.doc1, &f.cost).excerpt_count, 0);
        assert_eq!(cell(&view, &f.doc2, &f.cost).excerpt_count, 1);
        assert_eq!(cell(&view, &f.doc3, &f.access).excerpt_count, 1);
        assert_eq!(cell(&view, &f.doc3, &f.cost).excerpt_count, 1);
        assert!(view.cells.iter().all(|c| c.summary.is_empty()));
    }

    #[test]
    fn descriptor_rows_group_documents_and_pool_their_excerpts() {
        let f = fixture();
        let conn = &f.project.conn;
        let m = create_matrix(
            conn,
            &FrameworkMatrixInput {
                name: "By site".into(),
                row_kind: "descriptor_value".into(),
                row_field_id: Some(f.site.clone()),
                code_ids: vec![f.access.clone(), f.cost.clone()],
                ..Default::default()
            },
            None,
        )
        .unwrap();
        let view = get_matrix(conn, &m.id).unwrap();

        // "North" (the field's second option) before the documents with no
        // value, which always come last.
        assert_eq!(
            view.rows
                .iter()
                .map(|r| (r.row_key.as_str(), r.label.as_str()))
                .collect::<Vec<_>>(),
            vec![("North", "North"), ("", NO_VALUE_LABEL)]
        );
        assert_eq!(
            view.rows[0].document_ids,
            vec![f.doc1.clone(), f.doc3.clone()]
        );
        assert_eq!(view.rows[1].document_ids, vec![f.doc2.clone()]);
        // doc1's two Access excerpts plus doc3's one.
        assert_eq!(cell(&view, "North", &f.access).excerpt_count, 3);
        assert_eq!(cell(&view, "North", &f.cost).excerpt_count, 1);
        assert_eq!(cell(&view, "", &f.cost).excerpt_count, 1);

        // A deleted field leaves the matrix openable, with no rows.
        descriptors::delete_field(conn, &f.site).unwrap();
        assert!(get_matrix(conn, &m.id).unwrap().rows.is_empty());
    }

    #[test]
    fn a_document_set_restricts_the_rows_and_a_code_set_supplies_the_columns() {
        let f = fixture();
        let conn = &f.project.conn;
        let docs = sets::create_set(
            conn,
            "document",
            "Round 2",
            &[f.doc3.clone(), f.doc2.clone()],
            None,
        )
        .unwrap();
        let themes = sets::create_set(
            conn,
            "code",
            "Themes",
            &[f.cost.clone(), f.access.clone()],
            None,
        )
        .unwrap();
        let m = create_matrix(
            conn,
            &FrameworkMatrixInput {
                name: "Round 2".into(),
                row_kind: "document".into(),
                row_set_id: Some(docs.id.clone()),
                code_set_id: Some(themes.id.clone()),
                // Ignored while a code set is chosen.
                code_ids: vec![f.waiting.clone()],
                ..Default::default()
            },
            None,
        )
        .unwrap();
        let view = get_matrix(conn, &m.id).unwrap();
        // Rows follow project order, not the order members were added.
        assert_eq!(
            view.rows
                .iter()
                .map(|r| r.row_key.as_str())
                .collect::<Vec<_>>(),
            vec![f.doc2.as_str(), f.doc3.as_str()]
        );
        // A code set is listed in codebook order.
        assert_eq!(view.columns, vec![f.access.clone(), f.cost.clone()]);

        // An empty or unknown set covers nothing, rather than everything.
        let empty = sets::create_set(conn, "document", "Empty", &[], None).unwrap();
        update_matrix(
            conn,
            &m.id,
            &FrameworkMatrixInput {
                name: "Round 2".into(),
                row_kind: "document".into(),
                row_set_id: Some(empty.id),
                code_set_id: Some(themes.id),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(get_matrix(conn, &m.id).unwrap().rows.is_empty());
    }

    #[test]
    fn summaries_round_trip_and_hand_back_the_previous_text() {
        let f = fixture();
        let conn = &f.project.conn;
        let m = create_matrix(conn, &by_document("Wave 1", &[&f.access]), None).unwrap();

        let before = set_cell_summary(conn, &m.id, &f.doc1, &f.access, "Waits months.").unwrap();
        assert_eq!(before, "");
        let before = set_cell_summary(conn, &m.id, &f.doc1, &f.access, "Waits years.").unwrap();
        assert_eq!(before, "Waits months.");
        assert_eq!(
            cell(&get_matrix(conn, &m.id).unwrap(), &f.doc1, &f.access).summary,
            "Waits years."
        );

        // Blanking a cell removes the row rather than storing an empty one.
        let before = set_cell_summary(conn, &m.id, &f.doc1, &f.access, "  ").unwrap();
        assert_eq!(before, "Waits years.");
        let stored: i64 = conn
            .query_row("SELECT count(*) FROM framework_cells", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, 0);
        assert!(matches!(
            set_cell_summary(conn, "nope", &f.doc1, &f.access, "x"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn deleting_a_code_drops_its_column_and_its_summaries() {
        let f = fixture();
        let conn = &f.project.conn;
        let m = create_matrix(conn, &by_document("Wave 1", &[&f.access, &f.cost]), None).unwrap();
        set_cell_summary(conn, &m.id, &f.doc2, &f.cost, "Mentions the fee twice.").unwrap();

        codes::delete(conn, &f.cost, crate::models::ChildrenStrategy::Delete).unwrap();
        let view = get_matrix(conn, &m.id).unwrap();
        assert_eq!(view.columns, vec![f.access.clone()]);
        let stored: i64 = conn
            .query_row("SELECT count(*) FROM framework_cells", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, 0);
    }

    #[test]
    fn delete_hands_back_the_summaries_and_restore_puts_them_all_back() {
        let f = fixture();
        let conn = &f.project.conn;
        let m = create_matrix(conn, &by_document("Wave 1", &[&f.access]), None).unwrap();
        set_cell_summary(conn, &m.id, &f.doc1, &f.access, "Waits months.").unwrap();

        let saved = delete_matrix(conn, &m.id).unwrap();
        assert_eq!(saved.matrix.id, m.id);
        assert_eq!(
            saved.cells,
            vec![(
                f.doc1.clone(),
                f.access.clone(),
                "Waits months.".to_string()
            )]
        );
        assert!(list_matrices(conn).unwrap().is_empty());

        let back = restore_matrix(conn, &saved).unwrap();
        assert_eq!(back, m);
        assert_eq!(
            cell(&get_matrix(conn, &m.id).unwrap(), &f.doc1, &f.access).summary,
            "Waits months."
        );
    }

    #[test]
    fn csv_is_the_row_label_then_one_summary_per_code() {
        let f = fixture();
        let conn = &f.project.conn;
        let m = create_matrix(conn, &by_document("Wave 1", &[&f.waiting, &f.cost]), None).unwrap();
        set_cell_summary(
            conn,
            &m.id,
            &f.doc1,
            &f.waiting,
            "Waited, then \"gave up\".",
        )
        .unwrap();
        set_cell_summary(conn, &m.id, &f.doc2, &f.cost, "Fees, twice.").unwrap();

        let csv = export_csv(conn, &m.id).unwrap();
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines[0], "Wave 1,Access / Waiting,Cost");
        assert_eq!(lines[1], "Interview 1,\"Waited, then \"\"gave up\"\".\",");
        assert_eq!(lines[2], "Interview 2,,\"Fees, twice.\"");
        assert_eq!(lines[3], "Interview 3,,");
    }

    #[test]
    fn an_empty_project_yields_an_empty_grid() {
        let p = OpenProject::in_memory("t").unwrap();
        let m = create_matrix(&p.conn, &by_document("Empty", &[]), None).unwrap();
        let view = get_matrix(&p.conn, &m.id).unwrap();
        assert!(view.rows.is_empty() && view.columns.is_empty() && view.cells.is_empty());
        assert_eq!(export_csv(&p.conn, &m.id).unwrap(), "Empty\n");
    }
}
