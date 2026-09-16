//! Analysis views: code frequencies, code co-occurrence and the
//! code-by-document matrix. Everything here is read-only and returns plain
//! DTOs; the frontend does the layout, shading and CSV.

use std::collections::{HashMap, HashSet};

use rusqlite::{types::Value, Connection};

use super::{codes, documents, sets};
use crate::error::Result;
use crate::models::{CoOccurrence, CodeByDocument, CodeFrequency};

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::codes::tests::mk as mk_code;
    use crate::db::documents::tests::new_doc;
    use crate::db::{documents, excerpts, OpenProject};
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
