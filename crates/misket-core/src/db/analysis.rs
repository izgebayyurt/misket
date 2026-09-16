//! Analysis views: code frequencies, code co-occurrence, the code-by-document
//! matrix and the code-by-descriptor cross-tab. Everything here is read-only
//! and returns plain DTOs; the frontend does the layout, shading and CSV.

use std::collections::{HashMap, HashSet};

use rusqlite::{types::Value, Connection};

use super::{codes, descriptors, documents, sets};
use crate::error::{AppError, Result};
use crate::models::{
    CoOccurrence, CodeByDescriptor, CodeByDocument, CodeFrequency, CrosstabColumn, CrosstabRequest,
    CrosstabRow,
};

/// `AND e.document_id IN (…)` for an optional document filter, expanding
/// `document_set_ids` into `document_ids` exactly like `excerpts::query`
/// does: explicit ids plus every id the picked sets expand to, unioned and
/// de-duplicated. An empty `document_ids` with no sets picked means "no
/// filter"; a set that is picked but expands to nothing (deleted, or every
/// member already gone) matches no document rather than every document.
fn document_clause(
    conn: &Connection,
    document_ids: Option<&[String]>,
    document_set_ids: Option<&[String]>,
) -> Result<(String, Vec<Value>)> {
    let doc_sets = document_set_ids.unwrap_or_default();
    let doc_ids = sets::union_with_sets(conn, document_ids, doc_sets)?;
    if doc_ids.is_empty() {
        return Ok(if doc_sets.is_empty() {
            (String::new(), vec![])
        } else {
            (" AND 0 = 1".to_string(), vec![])
        });
    }
    let ph = doc_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    Ok((
        format!(" AND e.document_id IN ({ph})"),
        doc_ids.into_iter().map(Value::from).collect(),
    ))
}

/// Position of every document in project order, for stable output.
fn document_order(conn: &Connection) -> Result<(Vec<String>, HashMap<String, usize>)> {
    let ids: Vec<String> = documents::list(conn)?.into_iter().map(|d| d.id).collect();
    let index = ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.clone(), i))
        .collect();
    Ok((ids, index))
}

/// One row per code: how many excerpts carry it directly, how many carry it or
/// any of its descendants, and how those are spread over documents.
///
/// `document_count` and `per_document` describe the descendant-inclusive set,
/// so they line up with `with_descendants`. `per_document` is in project
/// document order and omits documents with no matching excerpt.
pub fn code_frequencies(
    conn: &Connection,
    document_ids: Option<&[String]>,
    document_set_ids: Option<&[String]>,
) -> Result<Vec<CodeFrequency>> {
    let all = codes::list(conn)?;
    let (_, doc_index) = document_order(conn)?;
    let (doc_sql, args) = document_clause(conn, document_ids, document_set_ids)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT ec.code_id, ec.excerpt_id, e.document_id
         FROM excerpt_codes ec JOIN excerpts e ON e.id = ec.excerpt_id
         WHERE 1 = 1{doc_sql}"
    ))?;
    let tags: Vec<(String, String, String)> = stmt
        .query_map(rusqlite::params_from_iter(args.iter()), |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?
        .collect::<rusqlite::Result<_>>()?;

    // code id -> (excerpt id, document id); one row per tag, so the row count
    // for a code is already its number of distinct excerpts.
    let mut by_code: HashMap<&str, Vec<(&str, &str)>> = HashMap::new();
    for (code_id, excerpt_id, document_id) in &tags {
        by_code
            .entry(code_id.as_str())
            .or_default()
            .push((excerpt_id.as_str(), document_id.as_str()));
    }

    let mut out = Vec::with_capacity(all.len());
    for code in &all {
        let subtree = codes::descendant_ids(conn, std::slice::from_ref(&code.id))?;
        let own = by_code
            .get(code.id.as_str())
            .map(|v| v.len() as i64)
            .unwrap_or(0);
        let mut seen: HashSet<&str> = HashSet::new();
        let mut per_doc: HashMap<&str, i64> = HashMap::new();
        for id in &subtree {
            for (excerpt_id, document_id) in by_code.get(id.as_str()).into_iter().flatten() {
                if seen.insert(excerpt_id) {
                    *per_doc.entry(document_id).or_default() += 1;
                }
            }
        }
        let with_descendants = seen.len() as i64;
        let mut per_document: Vec<(String, i64)> = per_doc
            .into_iter()
            .map(|(d, n)| (d.to_string(), n))
            .collect();
        per_document.sort_by_key(|(d, _)| doc_index.get(d).copied().unwrap_or(usize::MAX));
        out.push(CodeFrequency {
            code_id: code.id.clone(),
            own,
            with_descendants,
            document_count: per_document.len() as i64,
            per_document,
        });
    }
    Ok(out)
}

struct TextExcerpt {
    id: String,
    document_id: String,
    start: i64,
    end: i64,
}

/// How often two codes are applied to overlapping text in the same document.
///
/// A cell counts distinct *excerpt pairs*: two overlapping excerpts carrying
/// the two codes, or one excerpt carrying both. Overlap is the half-open
/// `a.start < b.end AND b.start < a.end`. The result is symmetric (each
/// non-zero pair appears in both orientations) and the diagonal is the code's
/// own frequency over text excerpts.
pub fn co_occurrence(
    conn: &Connection,
    document_ids: Option<&[String]>,
    document_set_ids: Option<&[String]>,
) -> Result<CoOccurrence> {
    let code_ids: Vec<String> = codes::list(conn)?.into_iter().map(|c| c.id).collect();
    let index: HashMap<&str, usize> = code_ids
        .iter()
        .enumerate()
        .map(|(i, c)| (c.as_str(), i))
        .collect();

    let (doc_sql, args) = document_clause(conn, document_ids, document_set_ids)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT e.id, e.document_id, e.start_pos, e.end_pos FROM excerpts e
         WHERE e.kind = 'text' AND e.start_pos IS NOT NULL AND e.end_pos IS NOT NULL{doc_sql}
         ORDER BY e.document_id, e.start_pos, e.end_pos, e.id"
    ))?;
    let excerpts: Vec<TextExcerpt> = stmt
        .query_map(rusqlite::params_from_iter(args.iter()), |r| {
            Ok(TextExcerpt {
                id: r.get(0)?,
                document_id: r.get(1)?,
                start: r.get(2)?,
                end: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;

    let mut stmt = conn.prepare("SELECT excerpt_id, code_id FROM excerpt_codes")?;
    let mut codes_of: HashMap<String, Vec<usize>> = HashMap::new();
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (excerpt_id, code_id) = row?;
        if let Some(i) = index.get(code_id.as_str()) {
            codes_of.entry(excerpt_id).or_default().push(*i);
        }
    }
    for v in codes_of.values_mut() {
        v.sort_unstable();
        v.dedup();
    }

    let empty: Vec<usize> = vec![];
    // Upper triangle only (row <= col); mirrored on the way out.
    let mut counts: HashMap<(usize, usize), i64> = HashMap::new();
    for (i, a) in excerpts.iter().enumerate() {
        let a_codes = codes_of.get(&a.id).unwrap_or(&empty);
        if a_codes.is_empty() {
            continue;
        }
        // The excerpt with itself: every pair of its codes, diagonal included.
        for (x, p) in a_codes.iter().enumerate() {
            for q in &a_codes[x..] {
                *counts.entry((*p, *q)).or_default() += 1;
            }
        }
        // Later excerpts are sorted by start, so once one starts at or after
        // this excerpt's end, nothing further can overlap it.
        for b in excerpts[i + 1..]
            .iter()
            .take_while(|b| b.document_id == a.document_id && b.start < a.end)
        {
            let b_codes = codes_of.get(&b.id).unwrap_or(&empty);
            let mut pairs: HashSet<(usize, usize)> = HashSet::new();
            for p in a_codes {
                for q in b_codes {
                    if p != q {
                        pairs.insert((*p.min(q), *p.max(q)));
                    }
                }
            }
            for key in pairs {
                *counts.entry(key).or_default() += 1;
            }
        }
    }

    let mut keys: Vec<(usize, usize)> = counts.keys().copied().collect();
    keys.sort_unstable();
    let mut cells = Vec::with_capacity(keys.len() * 2);
    for (row, col) in keys {
        let n = counts[&(row, col)];
        cells.push((code_ids[row].clone(), code_ids[col].clone(), n));
        if row != col {
            cells.push((code_ids[col].clone(), code_ids[row].clone(), n));
        }
    }
    Ok(CoOccurrence { code_ids, cells })
}

/// Excerpts per (document, code), counting direct tags only. Aggregating
/// sub-codes is left to the caller, which already has the code tree.
pub fn code_by_document(conn: &Connection) -> Result<CodeByDocument> {
    let (document_ids, doc_index) = document_order(conn)?;
    let code_ids: Vec<String> = codes::list(conn)?.into_iter().map(|c| c.id).collect();
    let code_index: HashMap<&str, usize> = code_ids
        .iter()
        .enumerate()
        .map(|(i, c)| (c.as_str(), i))
        .collect();

    let mut stmt = conn.prepare(
        "SELECT e.document_id, ec.code_id, count(*) FROM excerpt_codes ec
         JOIN excerpts e ON e.id = ec.excerpt_id
         GROUP BY e.document_id, ec.code_id",
    )?;
    let mut cells: Vec<(String, String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    cells.sort_by_key(|(d, c, _)| {
        (
            doc_index.get(d).copied().unwrap_or(usize::MAX),
            code_index.get(c.as_str()).copied().unwrap_or(usize::MAX),
        )
    });
    Ok(CodeByDocument {
        document_ids,
        code_ids,
        cells,
    })
}

// ------------------------------------------------- code × descriptor cross-tab

/// The default number of equal-width bins a number field is cut into.
pub const DEFAULT_NUMBER_BINS: i64 = 4;

/// Days in a month, so a date column can name its own last day.
fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        _ => 28,
    }
}

/// Trim a bin edge to something readable without losing the value: at most
/// three decimals, with trailing zeros dropped.
fn edge_label(v: f64) -> String {
    let rounded = (v * 1000.0).round() / 1000.0;
    let mut s = format!("{rounded}");
    if s.ends_with(".0") {
        s.truncate(s.len() - 2);
    }
    s
}

/// Where a stored descriptor value lands: a column index, or `None` when no
/// column claims it (an unparseable number, a value the field lost).
type ColumnOf = Box<dyn Fn(&str) -> Option<usize>>;

/// Which column a document's value falls in, and the columns themselves.
struct Columns {
    columns: Vec<CrosstabColumn>,
    /// `value -> column index`; numbers and dates are bucketed here once.
    index_of: ColumnOf,
}

/// Build the columns for a field from the values the in-scope documents
/// actually have.
///
/// * `choice` keeps the field's own option order, `text` sorts
///   case-insensitively, and both get one column per distinct value.
/// * `number` is cut into `bins` equal-width, half-open bins between the
///   smallest and the largest value, the last one closed so the maximum has a
///   home; a single distinct value becomes one bin.
/// * `date` gets one column per year-month that occurs.
///
/// A `(no value)` column is appended only when some in-scope document has no
/// value for the field.
fn build_columns(kind: &str, options: &[String], values: &[String], bins: i64) -> Columns {
    let mut columns: Vec<CrosstabColumn> = vec![];
    let index_of: ColumnOf = match kind {
        "number" => {
            let nums: Vec<f64> = values
                .iter()
                .filter_map(|v| v.parse::<f64>().ok())
                .collect();
            let min = nums.iter().copied().fold(f64::INFINITY, f64::min);
            let max = nums.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            if nums.is_empty() {
                Box::new(|_| None)
            } else {
                let n = if max > min { bins.clamp(1, 50) } else { 1 };
                let width = if max > min {
                    (max - min) / n as f64
                } else {
                    0.0
                };
                let mut edges: Vec<f64> = (0..=n).map(|i| min + width * i as f64).collect();
                // Floating point can land the last edge just short of the max.
                if let Some(last) = edges.last_mut() {
                    *last = max;
                }
                for i in 0..n as usize {
                    let (lo, hi) = (edges[i], edges[i + 1]);
                    columns.push(CrosstabColumn {
                        label: if lo == hi {
                            edge_label(lo)
                        } else {
                            format!("{} – {}", edge_label(lo), edge_label(hi))
                        },
                        op: "between".into(),
                        values: vec![edge_label(lo), edge_label(hi)],
                    });
                }
                Box::new(move |raw: &str| {
                    let v: f64 = raw.parse().ok()?;
                    if v < edges[0] || v > *edges.last()? {
                        return None;
                    }
                    // Half-open bins, except the last, which owns the maximum.
                    let last = edges.len() - 2;
                    Some(
                        (0..=last)
                            .find(|&i| v < edges[i + 1] || i == last)
                            .unwrap_or(last),
                    )
                })
            }
        }
        "date" => {
            let mut months: Vec<String> = values
                .iter()
                .filter(|v| v.len() >= 7)
                .map(|v| v[..7].to_string())
                .collect();
            months.sort();
            months.dedup();
            for m in &months {
                let year: i64 = m[..4].parse().unwrap_or(0);
                let month: i64 = m[5..7].parse().unwrap_or(1);
                columns.push(CrosstabColumn {
                    label: m.clone(),
                    op: "between".into(),
                    values: vec![
                        format!("{m}-01"),
                        format!("{m}-{:02}", days_in_month(year, month)),
                    ],
                });
            }
            let at: HashMap<String, usize> = months
                .into_iter()
                .enumerate()
                .map(|(i, m)| (m, i))
                .collect();
            Box::new(move |raw: &str| raw.get(..7).and_then(|m| at.get(m)).copied())
        }
        _ => {
            let present: HashSet<&str> = values.iter().map(String::as_str).collect();
            let mut distinct: Vec<String> = if kind == "choice" {
                options
                    .iter()
                    .filter(|o| present.contains(o.as_str()))
                    .cloned()
                    .collect()
            } else {
                let mut v: Vec<String> = present.iter().map(|s| s.to_string()).collect();
                v.sort_by_key(|s| (s.to_lowercase(), s.clone()));
                v
            };
            // A choice value stored before an option was renamed still needs
            // a column, so anything the option list misses is appended.
            for v in values {
                if !distinct.contains(v) {
                    distinct.push(v.clone());
                }
            }
            for v in &distinct {
                columns.push(CrosstabColumn {
                    label: v.clone(),
                    op: "eq".into(),
                    values: vec![v.clone()],
                });
            }
            let at: HashMap<String, usize> = distinct
                .into_iter()
                .enumerate()
                .map(|(i, v)| (v, i))
                .collect();
            Box::new(move |raw: &str| at.get(raw).copied())
        }
    };
    Columns { columns, index_of }
}

/// Codes against the values of one descriptor field: the mixed-methods
/// cross-tab ("how often does each code appear in interviews from each site").
///
/// Columns come from the values the documents in scope actually have (see
/// [`build_columns`]), with a trailing `(no value)` column when some document
/// has none. Rows are the picked codes (every code when none are picked), in
/// codebook order. A cell counts the excerpts — or, with `mode = "documents"`,
/// the distinct documents — tagged with the row's code, or with any of its
/// descendants when `include_descendants` is set, in the documents that fall
/// in that column. Because every document belongs to exactly one column, a
/// row's cells add up to its total either way.
pub fn code_by_descriptor(conn: &Connection, req: &CrosstabRequest) -> Result<CodeByDescriptor> {
    let CrosstabRequest {
        field_id,
        code_ids,
        include_descendants,
        document_ids,
        document_set_ids,
        bins,
        ..
    } = req;
    let (code_ids, document_ids, document_set_ids) = (
        code_ids.as_deref(),
        document_ids.as_deref(),
        document_set_ids.as_deref(),
    );
    let include_descendants = *include_descendants;
    let mode = req.mode.as_deref().unwrap_or("excerpts");
    if mode != "excerpts" && mode != "documents" {
        return Err(AppError::Validation(format!(
            "unknown cross-tab mode {mode:?}; expected \"excerpts\" or \"documents\""
        )));
    }
    let field = descriptors::get_field(conn, field_id)?;

    // Documents in scope, in project order, and their value for the field.
    // The same expansion `document_clause` does, but over `documents` rather
    // than over the excerpts joined to them.
    let doc_sets = document_set_ids.unwrap_or_default();
    let picked_docs = sets::union_with_sets(conn, document_ids, doc_sets)?;
    let wanted: Option<HashSet<&str>> = if picked_docs.is_empty() && doc_sets.is_empty() {
        None
    } else {
        Some(picked_docs.iter().map(String::as_str).collect())
    };
    let scope: Vec<String> = documents::list(conn)?
        .into_iter()
        .filter(|d| wanted.as_ref().is_none_or(|w| w.contains(d.id.as_str())))
        .map(|d| d.id)
        .collect();
    let in_scope: HashSet<&str> = scope.iter().map(String::as_str).collect();
    let (doc_sql, doc_args) = document_clause(conn, document_ids, document_set_ids)?;

    let mut stmt =
        conn.prepare("SELECT document_id, value FROM descriptor_values WHERE field_id = ?1")?;
    let value_of: HashMap<String, String> = stmt
        .query_map([field_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<HashMap<_, _>>>()?
        .into_iter()
        .filter(|(d, _): &(String, String)| in_scope.contains(d.as_str()))
        .collect();

    let values: Vec<String> = scope
        .iter()
        .filter_map(|d| value_of.get(d).cloned())
        .collect();
    let Columns {
        mut columns,
        index_of,
    } = build_columns(
        &field.kind,
        &field.options,
        &values,
        bins.unwrap_or(DEFAULT_NUMBER_BINS),
    );
    // Documents whose value the columns above could not place (a number
    // outside every bin cannot happen, but a malformed one can) join the
    // documents with no value at all.
    let column_of: HashMap<&str, usize> = scope
        .iter()
        .filter_map(|d| {
            let i = value_of.get(d).and_then(|v| index_of(v))?;
            Some((d.as_str(), i))
        })
        .collect();
    let unplaced = scope.len() - column_of.len();
    if unplaced > 0 {
        columns.push(CrosstabColumn {
            label: "(no value)".into(),
            op: "empty".into(),
            values: vec![],
        });
    }
    let no_value_column = columns.len().wrapping_sub(1);
    let column_for = |doc: &str| -> Option<usize> {
        match column_of.get(doc) {
            Some(i) => Some(*i),
            None if unplaced > 0 && in_scope.contains(doc) => Some(no_value_column),
            None => None,
        }
    };

    let mut documents_per_column = vec![0i64; columns.len()];
    for d in &scope {
        if let Some(i) = column_for(d) {
            documents_per_column[i] += 1;
        }
    }

    // Rows: the picked codes, or the whole codebook, in codebook order.
    let picked: Option<HashSet<&str>> = code_ids
        .filter(|ids| !ids.is_empty())
        .map(|ids| ids.iter().map(String::as_str).collect());
    let rows_codes: Vec<String> = codes::list(conn)?
        .into_iter()
        .filter(|c| picked.as_ref().is_none_or(|p| p.contains(c.id.as_str())))
        .map(|c| c.id)
        .collect();

    // Every tag once: code -> (excerpt, document).
    let mut stmt = conn.prepare(&format!(
        "SELECT ec.code_id, ec.excerpt_id, e.document_id
         FROM excerpt_codes ec JOIN excerpts e ON e.id = ec.excerpt_id
         WHERE 1 = 1{doc_sql}"
    ))?;
    let tags: Vec<(String, String, String)> = stmt
        .query_map(rusqlite::params_from_iter(doc_args.iter()), |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut by_code: HashMap<&str, Vec<(&str, &str)>> = HashMap::new();
    for (code_id, excerpt_id, document_id) in &tags {
        by_code
            .entry(code_id.as_str())
            .or_default()
            .push((excerpt_id.as_str(), document_id.as_str()));
    }

    let mut rows = Vec::with_capacity(rows_codes.len());
    for code_id in &rows_codes {
        let subtree = if include_descendants {
            codes::descendant_ids(conn, std::slice::from_ref(code_id))?
        } else {
            vec![code_id.clone()]
        };
        let mut cells = vec![0i64; columns.len()];
        // De-duplicate per excerpt (an excerpt tagged with both a code and its
        // child must count once) and, in document mode, per document.
        let mut seen: HashSet<&str> = HashSet::new();
        let mut seen_docs: HashSet<(usize, &str)> = HashSet::new();
        for id in &subtree {
            for (excerpt_id, document_id) in by_code.get(id.as_str()).into_iter().flatten() {
                let Some(i) = column_for(document_id) else {
                    continue;
                };
                if mode == "documents" {
                    if seen_docs.insert((i, document_id)) {
                        cells[i] += 1;
                    }
                } else if seen.insert(excerpt_id) {
                    cells[i] += 1;
                }
            }
        }
        rows.push(CrosstabRow {
            code_id: code_id.clone(),
            cells,
        });
    }

    Ok(CodeByDescriptor {
        field,
        columns,
        rows,
        documents_per_column,
        mode: mode.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::codes::tests::mk as mk_code;
    use crate::db::descriptors::tests::mk_field;
    use crate::db::documents::tests::new_doc;
    use crate::db::{descriptors, documents, excerpts, OpenProject};
    use crate::models::{ApplyCodesInput, NewDocument};

    struct Fixture {
        project: OpenProject,
        doc1: String,
        doc2: String,
        a: String,
        a1: String,
        b: String,
        c: String,
    }

    /// Two documents, a nested codebook (A > A1, B, C) and excerpts that
    /// overlap in doc 1 but not in doc 2.
    ///
    /// doc1 "abcdefghij…": [0,5) A,  [3,8) B,  [3,8) also A1 later, [20,25) C
    /// doc2: [0,4) A1, [10,14) B
    fn fixture() -> Fixture {
        let project = OpenProject::in_memory("t").unwrap();
        let conn = &project.conn;
        let doc1 = documents::create(conn, new_doc(&"x".repeat(40)))
            .unwrap()
            .summary
            .id;
        let doc2 = documents::create(
            conn,
            NewDocument {
                name: "Interview 2".into(),
                ..new_doc(&"y".repeat(40))
            },
        )
        .unwrap()
        .summary
        .id;
        let a = mk_code(conn, "A", None).id;
        let a1 = mk_code(conn, "A1", Some(&a)).id;
        let b = mk_code(conn, "B", None).id;
        let c = mk_code(conn, "C", None).id;

        apply(conn, &doc1, 0, 5, &[&a]);
        apply(conn, &doc1, 3, 8, &[&b, &a1]);
        apply(conn, &doc1, 20, 25, &[&c]);
        apply(conn, &doc2, 0, 4, &[&a1]);
        apply(conn, &doc2, 10, 14, &[&b]);

        Fixture {
            project,
            doc1,
            doc2,
            a,
            a1,
            b,
            c,
        }
    }

    fn apply(conn: &Connection, doc: &str, start: i64, end: i64, code_ids: &[&str]) -> String {
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
        .unwrap()
        .excerpt
        .id
    }

    fn freq<'a>(rows: &'a [CodeFrequency], code_id: &str) -> &'a CodeFrequency {
        rows.iter().find(|r| r.code_id == code_id).unwrap()
    }

    fn cell(m: &[(String, String, i64)], row: &str, col: &str) -> i64 {
        m.iter()
            .find(|(r, c, _)| r == row && c == col)
            .map(|(_, _, n)| *n)
            .unwrap_or(0)
    }

    #[test]
    fn frequencies_count_own_descendants_and_documents() {
        let f = fixture();
        let rows = code_frequencies(&f.project.conn, None, None).unwrap();
        assert_eq!(rows.len(), 4);

        let a = freq(&rows, &f.a);
        assert_eq!(a.own, 1); // only [0,5) in doc1
        assert_eq!(a.with_descendants, 3); // + A1 on [3,8) in doc1 and [0,4) in doc2
        assert_eq!(a.document_count, 2);
        assert_eq!(
            a.per_document,
            vec![(f.doc1.clone(), 2), (f.doc2.clone(), 1)]
        );

        let a1 = freq(&rows, &f.a1);
        assert_eq!((a1.own, a1.with_descendants, a1.document_count), (2, 2, 2));
        let b = freq(&rows, &f.b);
        assert_eq!((b.own, b.with_descendants, b.document_count), (2, 2, 2));
        let c = freq(&rows, &f.c);
        assert_eq!((c.own, c.with_descendants, c.document_count), (1, 1, 1));
        assert_eq!(c.per_document, vec![(f.doc1.clone(), 1)]);
    }

    #[test]
    fn frequencies_honour_the_document_filter() {
        let f = fixture();
        let rows =
            code_frequencies(&f.project.conn, Some(std::slice::from_ref(&f.doc2)), None).unwrap();
        let a = freq(&rows, &f.a);
        assert_eq!((a.own, a.with_descendants, a.document_count), (0, 1, 1));
        assert_eq!(a.per_document, vec![(f.doc2.clone(), 1)]);
        assert_eq!(freq(&rows, &f.c).own, 0);
        assert!(freq(&rows, &f.c).per_document.is_empty());
        // An empty list is not a filter.
        let all = code_frequencies(&f.project.conn, Some(&[]), None).unwrap();
        assert_eq!(freq(&all, &f.a).with_descendants, 3);
    }

    #[test]
    fn frequencies_expand_document_sets_like_the_excerpt_browser() {
        let f = fixture();
        let doc2_set = crate::db::sets::create_set(
            &f.project.conn,
            "document",
            "Wave 2",
            std::slice::from_ref(&f.doc2),
            None,
        )
        .unwrap();

        // The set alone stands for its member document.
        let rows = code_frequencies(
            &f.project.conn,
            None,
            Some(std::slice::from_ref(&doc2_set.id)),
        )
        .unwrap();
        let a = freq(&rows, &f.a);
        assert_eq!((a.own, a.with_descendants, a.document_count), (0, 1, 1));

        // An explicit id and a set are unioned, not intersected.
        let rows = code_frequencies(
            &f.project.conn,
            Some(std::slice::from_ref(&f.doc1)),
            Some(std::slice::from_ref(&doc2_set.id)),
        )
        .unwrap();
        let a = freq(&rows, &f.a);
        assert_eq!((a.own, a.with_descendants, a.document_count), (1, 3, 2));

        // A set that is picked but empty or unknown matches no document,
        // rather than falling back to "no filter".
        let empty_set =
            crate::db::sets::create_set(&f.project.conn, "document", "Empty", &[], None).unwrap();
        let rows = code_frequencies(
            &f.project.conn,
            None,
            Some(std::slice::from_ref(&empty_set.id)),
        )
        .unwrap();
        assert_eq!(freq(&rows, &f.a).with_descendants, 0);
        let rows = code_frequencies(&f.project.conn, None, Some(&["nope".into()])).unwrap();
        assert_eq!(freq(&rows, &f.a).with_descendants, 0);
    }

    #[test]
    fn co_occurrence_counts_overlapping_pairs_once() {
        let f = fixture();
        let m = co_occurrence(&f.project.conn, None, None).unwrap();
        assert_eq!(m.code_ids.len(), 4);
        let cells = &m.cells;

        // A [0,5) overlaps the [3,8) excerpt, which carries B and A1.
        assert_eq!(cell(cells, &f.a, &f.b), 1);
        assert_eq!(cell(cells, &f.b, &f.a), 1); // mirrored
        assert_eq!(cell(cells, &f.a, &f.a1), 1);
        // B and A1 share one excerpt: counted once, not twice.
        assert_eq!(cell(cells, &f.b, &f.a1), 1);
        // doc2's A1 [0,4) and B [10,14) do not overlap, and C is on its own.
        assert_eq!(cell(cells, &f.c, &f.a), 0);
        assert_eq!(cell(cells, &f.c, &f.b), 0);

        // The diagonal is the code's own frequency.
        for (code, own) in [(&f.a, 1), (&f.a1, 2), (&f.b, 2), (&f.c, 1)] {
            assert_eq!(cell(cells, code, code), own, "diagonal");
        }

        // Touching ranges do not overlap: [0,5) and [5,9) are disjoint.
        apply(&f.project.conn, &f.doc1, 5, 9, &[&f.c]);
        let m = co_occurrence(&f.project.conn, None, None).unwrap();
        assert_eq!(cell(&m.cells, &f.a, &f.c), 0);
        assert_eq!(cell(&m.cells, &f.b, &f.c), 1); // [3,8) and [5,9) do overlap

        // Document filter.
        let m = co_occurrence(&f.project.conn, Some(std::slice::from_ref(&f.doc2)), None).unwrap();
        assert_eq!(cell(&m.cells, &f.a, &f.b), 0);
        assert_eq!(cell(&m.cells, &f.a1, &f.a1), 1);

        // A document set does the same as the equivalent explicit id.
        let doc2_set = crate::db::sets::create_set(
            &f.project.conn,
            "document",
            "Wave 2",
            std::slice::from_ref(&f.doc2),
            None,
        )
        .unwrap();
        let m = co_occurrence(
            &f.project.conn,
            None,
            Some(std::slice::from_ref(&doc2_set.id)),
        )
        .unwrap();
        assert_eq!(cell(&m.cells, &f.a, &f.b), 0);
        assert_eq!(cell(&m.cells, &f.a1, &f.a1), 1);
    }

    #[test]
    fn co_occurrence_counts_a_pair_of_excerpts_once_per_code_pair() {
        let f = fixture();
        // Two overlapping excerpts that both carry A and B: one pair, one cell.
        let doc = documents::create(
            &f.project.conn,
            NewDocument {
                name: "Interview 3".into(),
                ..new_doc(&"z".repeat(40))
            },
        )
        .unwrap()
        .summary
        .id;
        apply(&f.project.conn, &doc, 0, 10, &[&f.a, &f.b]);
        apply(&f.project.conn, &doc, 5, 15, &[&f.a, &f.b]);
        let m = co_occurrence(&f.project.conn, Some(std::slice::from_ref(&doc)), None).unwrap();
        // Once per excerpt (both codes on one excerpt) + once for the pair.
        assert_eq!(cell(&m.cells, &f.a, &f.b), 3);
        assert_eq!(cell(&m.cells, &f.a, &f.a), 2);
    }

    #[test]
    fn code_by_document_counts_direct_tags() {
        let f = fixture();
        let m = code_by_document(&f.project.conn).unwrap();
        assert_eq!(m.document_ids, vec![f.doc1.clone(), f.doc2.clone()]);
        assert_eq!(m.code_ids.len(), 4);
        assert_eq!(cell(&m.cells, &f.doc1, &f.a), 1);
        assert_eq!(cell(&m.cells, &f.doc1, &f.a1), 1);
        assert_eq!(cell(&m.cells, &f.doc1, &f.b), 1);
        assert_eq!(cell(&m.cells, &f.doc1, &f.c), 1);
        assert_eq!(cell(&m.cells, &f.doc2, &f.a), 0); // A itself is never direct in doc2
        assert_eq!(cell(&m.cells, &f.doc2, &f.a1), 1);
        assert_eq!(cell(&m.cells, &f.doc2, &f.b), 1);
        // Cells are sparse: only non-zero combinations are returned.
        assert_eq!(m.cells.len(), 6);
    }

    // ------------------------------------------------- code × descriptor

    /// Four documents with one excerpt each, so a cross-tab cell is easy to
    /// read: doc n carries code A (and doc 4 also A1).
    fn crosstab_fixture() -> (OpenProject, Vec<String>, String, String) {
        let p = OpenProject::in_memory("t").unwrap();
        let conn = &p.conn;
        let mut docs = vec![];
        for i in 0..4 {
            docs.push(
                documents::create(
                    conn,
                    NewDocument {
                        name: format!("Interview {i}"),
                        ..new_doc(&format!("{i}{}", "x".repeat(40)))
                    },
                )
                .unwrap()
                .summary
                .id,
            );
        }
        let a = mk_code(conn, "A", None).id;
        let a1 = mk_code(conn, "A1", Some(&a)).id;
        for d in &docs {
            apply(conn, d, 0, 5, &[&a]);
        }
        apply(conn, &docs[3], 10, 15, &[&a1]);
        (p, docs, a, a1)
    }

    /// The plain request the cross-tab tests start from: this field, every
    /// code, direct tags only, every document, excerpt counts.
    fn req(field_id: &str) -> CrosstabRequest {
        CrosstabRequest {
            field_id: field_id.into(),
            include_descendants: false,
            ..Default::default()
        }
    }

    fn set_value(conn: &Connection, doc: &str, field: &str, value: &str) {
        descriptors::set_value(conn, doc, field, Some(value)).unwrap();
    }

    fn row<'a>(m: &'a CodeByDescriptor, code_id: &str) -> &'a CrosstabRow {
        m.rows.iter().find(|r| r.code_id == code_id).unwrap()
    }

    fn labels(m: &CodeByDescriptor) -> Vec<&str> {
        m.columns.iter().map(|c| c.label.as_str()).collect()
    }

    #[test]
    fn crosstab_over_a_choice_field_has_a_column_per_used_option() {
        let (p, docs, a, a1) = crosstab_fixture();
        let site = mk_field(&p.conn, "Site", "choice", &["North", "South", "East"]);
        set_value(&p.conn, &docs[0], &site.id, "North");
        set_value(&p.conn, &docs[1], &site.id, "South");
        set_value(&p.conn, &docs[2], &site.id, "North");
        // docs[3] deliberately has no value.

        let m = code_by_descriptor(&p.conn, &req(&site.id)).unwrap();
        // Option order, unused options dropped, "(no value)" last.
        assert_eq!(labels(&m), vec!["North", "South", "(no value)"]);
        assert_eq!(m.columns[0].op, "eq");
        assert_eq!(m.columns[0].values, vec!["North".to_string()]);
        assert_eq!(m.columns[2].op, "empty");
        assert!(m.columns[2].values.is_empty());
        assert_eq!(m.documents_per_column, vec![2, 1, 1]);
        assert_eq!(row(&m, &a).cells, vec![2, 1, 1]);
        assert_eq!(row(&m, &a1).cells, vec![0, 0, 1]);

        // Sub-codes roll up into the parent without double-counting.
        let m = code_by_descriptor(
            &p.conn,
            &CrosstabRequest {
                include_descendants: true,
                ..req(&site.id)
            },
        )
        .unwrap();
        assert_eq!(row(&m, &a).cells, vec![2, 1, 2]);

        // Document mode counts each document once, however many excerpts it has.
        let m = code_by_descriptor(
            &p.conn,
            &CrosstabRequest {
                include_descendants: true,
                mode: Some("documents".into()),
                ..req(&site.id)
            },
        )
        .unwrap();
        assert_eq!(m.mode, "documents");
        assert_eq!(row(&m, &a).cells, vec![2, 1, 1]);

        // Picking codes chooses the rows; the codebook order is kept.
        let m = code_by_descriptor(
            &p.conn,
            &CrosstabRequest {
                code_ids: Some(vec![a1.clone()]),
                ..req(&site.id)
            },
        )
        .unwrap();
        assert_eq!(m.rows.len(), 1);
        assert_eq!(m.rows[0].code_id, a1);

        // An unknown mode is a validation error, not a silent count.
        assert!(matches!(
            code_by_descriptor(
                &p.conn,
                &CrosstabRequest {
                    mode: Some("cases".into()),
                    ..req(&site.id)
                }
            ),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn crosstab_over_a_number_field_bins_between_min_and_max() {
        let (p, docs, a, _) = crosstab_fixture();
        let age = mk_field(&p.conn, "Age", "number", &[]);
        for (doc, v) in docs.iter().zip(["20", "30", "40", "60"]) {
            set_value(&p.conn, doc, &age.id, v);
        }

        // Four equal-width bins over 20..60: 20–30, 30–40, 40–50, 50–60. The
        // bins are half-open, so 30 belongs to the second and 40 to the third;
        // the last bin is closed so 60 has a home.
        let m = code_by_descriptor(&p.conn, &req(&age.id)).unwrap();
        assert_eq!(labels(&m), vec!["20 – 30", "30 – 40", "40 – 50", "50 – 60"]);
        assert_eq!(m.columns[1].op, "between");
        assert_eq!(
            m.columns[1].values,
            vec!["30".to_string(), "40".to_string()]
        );
        // No "(no value)" column when every document has one.
        assert_eq!(m.documents_per_column, vec![1, 1, 1, 1]);
        assert_eq!(row(&m, &a).cells, vec![1, 1, 1, 1]);

        // A user-chosen bin count.
        let m = code_by_descriptor(
            &p.conn,
            &CrosstabRequest {
                bins: Some(2),
                ..req(&age.id)
            },
        )
        .unwrap();
        assert_eq!(labels(&m), vec!["20 – 40", "40 – 60"]);
        assert_eq!(row(&m, &a).cells, vec![2, 2]);

        // One distinct value is one bin, not a zero-width division.
        let single = mk_field(&p.conn, "Score", "number", &[]);
        set_value(&p.conn, &docs[0], &single.id, "7.5");
        let m = code_by_descriptor(&p.conn, &req(&single.id)).unwrap();
        assert_eq!(labels(&m), vec!["7.5", "(no value)"]);
        assert_eq!(row(&m, &a).cells, vec![1, 3]);
    }

    #[test]
    fn crosstab_over_a_date_field_buckets_by_year_month() {
        let (p, docs, a, _) = crosstab_fixture();
        let wave = mk_field(&p.conn, "Interviewed", "date", &[]);
        set_value(&p.conn, &docs[0], &wave.id, "2026-02-28");
        set_value(&p.conn, &docs[1], &wave.id, "2026-02-01");
        set_value(&p.conn, &docs[2], &wave.id, "2025-12-31");

        let m = code_by_descriptor(&p.conn, &req(&wave.id)).unwrap();
        // Months sort ascending, whatever order the documents are in.
        assert_eq!(labels(&m), vec!["2025-12", "2026-02", "(no value)"]);
        assert_eq!(m.columns[0].op, "between");
        assert_eq!(
            m.columns[0].values,
            vec!["2025-12-01".to_string(), "2025-12-31".to_string()]
        );
        // February 2026 is not a leap year, so the column ends on the 28th.
        assert_eq!(
            m.columns[1].values,
            vec!["2026-02-01".to_string(), "2026-02-28".to_string()]
        );
        assert_eq!(m.documents_per_column, vec![1, 2, 1]);
        assert_eq!(row(&m, &a).cells, vec![1, 2, 1]);

        // A leap February keeps its 29th.
        let leap = mk_field(&p.conn, "Leap", "date", &[]);
        set_value(&p.conn, &docs[0], &leap.id, "2028-02-03");
        let m = code_by_descriptor(&p.conn, &req(&leap.id)).unwrap();
        assert_eq!(m.columns[0].values[1], "2028-02-29");
    }

    #[test]
    fn crosstab_honours_the_document_filter_and_an_empty_project() {
        let (p, docs, a, _) = crosstab_fixture();
        let site = mk_field(&p.conn, "Site", "choice", &["North", "South"]);
        set_value(&p.conn, &docs[0], &site.id, "North");
        set_value(&p.conn, &docs[1], &site.id, "South");

        // Only doc 0 is in scope: doc 1's "South" is not a column at all.
        let m = code_by_descriptor(
            &p.conn,
            &CrosstabRequest {
                document_ids: Some(vec![docs[0].clone()]),
                ..req(&site.id)
            },
        )
        .unwrap();
        assert_eq!(labels(&m), vec!["North"]);
        assert_eq!(row(&m, &a).cells, vec![1]);

        // A document set behaves like the equivalent explicit id.
        let set = crate::db::sets::create_set(
            &p.conn,
            "document",
            "Wave 1",
            std::slice::from_ref(&docs[1]),
            None,
        )
        .unwrap();
        let m = code_by_descriptor(
            &p.conn,
            &CrosstabRequest {
                document_set_ids: Some(vec![set.id.clone()]),
                ..req(&site.id)
            },
        )
        .unwrap();
        assert_eq!(labels(&m), vec!["South"]);
        assert_eq!(row(&m, &a).cells, vec![1]);

        // A picked but empty set matches no document, so there are no columns.
        let empty = crate::db::sets::create_set(&p.conn, "document", "Empty", &[], None).unwrap();
        let m = code_by_descriptor(
            &p.conn,
            &CrosstabRequest {
                document_set_ids: Some(vec![empty.id.clone()]),
                ..req(&site.id)
            },
        )
        .unwrap();
        assert!(m.columns.is_empty());
        assert!(row(&m, &a).cells.is_empty());

        assert!(matches!(
            code_by_descriptor(&p.conn, &req("nope")),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn empty_project_is_empty_everywhere() {
        let p = OpenProject::in_memory("t").unwrap();
        assert!(code_frequencies(&p.conn, None, None).unwrap().is_empty());
        let m = co_occurrence(&p.conn, None, None).unwrap();
        assert!(m.code_ids.is_empty() && m.cells.is_empty());
        let m = code_by_document(&p.conn).unwrap();
        assert!(m.document_ids.is_empty() && m.cells.is_empty());
    }
}
