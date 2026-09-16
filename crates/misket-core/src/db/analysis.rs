//! Analysis views: code frequencies, code co-occurrence, the
//! code-by-document matrix, word frequencies and per-code coding-over-time.
//! Everything here is read-only and returns plain DTOs; the frontend does
//! the layout, shading and CSV.

use std::collections::{BTreeSet, HashMap, HashSet};

use rusqlite::{types::Value, Connection};

use super::meta;
use super::{codes, documents, sets};
use crate::error::{AppError, Result};
use crate::models::{
    CoOccurrence, CodeByDocument, CodeFrequency, WordFrequency, WordFrequencyOptions,
    WordFrequencyScope,
};
use crate::text::{self, stem};

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

/// Resolve a document/set filter to `None` ("no filter — every document")
/// or `Some(ids)`, where an empty `Some(vec![])` means a set was picked but
/// expands to nothing (matches no document, same convention as
/// `document_clause`). Unlike `document_clause` this doesn't hard-code a
/// table alias, so callers can use it against either `excerpts` or
/// `documents` directly.
fn resolve_document_ids(
    conn: &Connection,
    document_ids: Option<&[String]>,
    document_set_ids: Option<&[String]>,
) -> Result<Option<Vec<String>>> {
    let doc_sets = document_set_ids.unwrap_or_default();
    let ids = sets::union_with_sets(conn, document_ids, doc_sets)?;
    if ids.is_empty() {
        return Ok(if doc_sets.is_empty() {
            None
        } else {
            Some(vec![])
        });
    }
    Ok(Some(ids))
}

/// The project's custom word-frequency stop words (`project_meta.stop_words`,
/// a JSON array), on top of the built-in English list. Lowercased and
/// deduplicated by `set_stop_words`; empty if never set.
pub fn stop_words(conn: &Connection) -> Result<Vec<String>> {
    match meta(conn, "stop_words")? {
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        None => Ok(vec![]),
    }
}

/// Replace the project's custom stop-word list. Entries are trimmed,
/// lowercased and deduplicated (order doesn't matter, so the stored list is
/// sorted for a stable diff).
pub fn set_stop_words(conn: &Connection, words: &[String]) -> Result<()> {
    let cleaned: BTreeSet<String> = words
        .iter()
        .map(|w| w.trim().to_lowercase())
        .filter(|w| !w.is_empty())
        .collect();
    let json = serde_json::to_string(&cleaned.into_iter().collect::<Vec<_>>())?;
    conn.execute(
        "INSERT INTO project_meta(key, value) VALUES ('stop_words', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [json],
    )?;
    Ok(())
}

/// Word frequencies over `scope`, most frequent first (ties broken
/// alphabetically), capped at `options.limit`.
///
/// With `scope.code_ids` set, only text inside excerpts carrying one of
/// those codes or a descendant is counted (using the excerpt's stored
/// `snapshot`, so it's exactly the coded text); otherwise every scoped
/// document's full text is counted. See `WordFrequencyOptions` for the
/// length/stop-word/stemming knobs.
pub fn word_frequencies(
    conn: &Connection,
    scope: &WordFrequencyScope,
    options: &WordFrequencyOptions,
) -> Result<Vec<WordFrequency>> {
    let code_ids = scope.code_ids.as_deref().unwrap_or(&[]);
    let doc_filter = resolve_document_ids(
        conn,
        scope.document_ids.as_deref(),
        scope.document_set_ids.as_deref(),
    )?;
    if matches!(&doc_filter, Some(ids) if ids.is_empty()) {
        return Ok(vec![]);
    }

    // (document_id, text) pairs to tokenize: either the coded snapshots of
    // excerpts under the picked codes, or whole documents.
    let texts: Vec<(String, String)> = if !code_ids.is_empty() {
        let subtree = codes::descendant_ids(conn, code_ids)?;
        if subtree.is_empty() {
            return Ok(vec![]);
        }
        let ph = subtree.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let mut sql = format!(
            "SELECT DISTINCT e.id, e.document_id, e.snapshot
             FROM excerpts e JOIN excerpt_codes ec ON ec.excerpt_id = e.id
             WHERE e.kind = 'text' AND ec.code_id IN ({ph})"
        );
        let mut params: Vec<Value> = subtree.into_iter().map(Value::from).collect();
        if let Some(ids) = &doc_filter {
            let dph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            sql.push_str(&format!(" AND e.document_id IN ({dph})"));
            params.extend(ids.iter().cloned().map(Value::from));
        }
        let mut stmt = conn.prepare(&sql)?;
        let rows: Vec<(String, Option<String>)> = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |r| {
                Ok((r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        rows.into_iter()
            .filter_map(|(document_id, snapshot)| snapshot.map(|s| (document_id, s)))
            .collect()
    } else {
        let mut sql =
            "SELECT id, text FROM documents WHERE kind = 'text' AND text IS NOT NULL".to_string();
        let mut params: Vec<Value> = vec![];
        if let Some(ids) = &doc_filter {
            let dph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            sql.push_str(&format!(" AND id IN ({dph})"));
            params.extend(ids.iter().cloned().map(Value::from));
        }
        let mut stmt = conn.prepare(&sql)?;
        let rows: Vec<(String, String)> = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<_>>()?;
        rows
    };

    let stop: HashSet<String> = if options.stop_words {
        let mut s: HashSet<String> = text::stopwords::ENGLISH_STOP_WORDS
            .iter()
            .map(|w| w.to_string())
            .collect();
        s.extend(stop_words(conn)?);
        s
    } else {
        HashSet::new()
    };

    struct Group {
        count: i64,
        docs: HashSet<String>,
        /// Surface form -> how many times it occurred, so a stemmed group
        /// can report its most frequent spelling as `term`.
        surface: HashMap<String, i64>,
    }
    let mut groups: HashMap<String, Group> = HashMap::new();

    for (document_id, text) in &texts {
        for token in text::tokenize(text) {
            if (token.chars().count() as i64) < options.min_length {
                continue;
            }
            if stop.contains(&token) {
                continue;
            }
            let key = if options.stem {
                stem::stem(&token)
            } else {
                token.clone()
            };
            let group = groups.entry(key).or_insert_with(|| Group {
                count: 0,
                docs: HashSet::new(),
                surface: HashMap::new(),
            });
            group.count += 1;
            group.docs.insert(document_id.clone());
            *group.surface.entry(token).or_default() += 1;
        }
    }

    let mut out: Vec<WordFrequency> = groups
        .into_iter()
        .map(|(key, group)| {
            let mut surface_forms: Vec<(String, i64)> = group.surface.into_iter().collect();
            // Most frequent surface form wins; ties break alphabetically so
            // the choice is deterministic regardless of hashing order.
            surface_forms.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            let term = surface_forms.into_iter().next().map_or(key, |(s, _)| s);
            WordFrequency {
                term,
                count: group.count,
                documents: group.docs.len() as i64,
            }
        })
        .collect();
    out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.term.cmp(&b.term)));
    out.truncate(options.limit);
    Ok(out)
}

/// How coding activity for a code (its own excerpts, plus descendants when
/// `include_descendants`) is spread over time, by `excerpts.created_at`,
/// bucketed by day/week/month. Sparse: only buckets with at least one
/// excerpt are returned, oldest first. Counts distinct excerpts, so an
/// excerpt tagged with both the code and a descendant isn't counted twice.
pub fn code_timeline(
    conn: &Connection,
    code_id: &str,
    include_descendants: bool,
    bucket: &str,
) -> Result<Vec<(String, i64)>> {
    let bucket_expr = match bucket {
        "day" => "substr(e.created_at, 1, 10)",
        "week" => "strftime('%Y-W%W', e.created_at)",
        "month" => "substr(e.created_at, 1, 7)",
        other => return Err(AppError::Validation(format!("unknown bucket '{other}'"))),
    };
    let ids = if include_descendants {
        codes::descendant_ids(conn, std::slice::from_ref(&code_id.to_string()))?
    } else {
        vec![code_id.to_string()]
    };
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT {bucket_expr} AS bucket, count(DISTINCT e.id) AS c
         FROM excerpts e JOIN excerpt_codes ec ON ec.excerpt_id = e.id
         WHERE ec.code_id IN ({ph})
         GROUP BY bucket
         ORDER BY bucket"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
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
        assert!(word_frequencies(
            &p.conn,
            &WordFrequencyScope::default(),
            &WordFrequencyOptions::default()
        )
        .unwrap()
        .is_empty());
        assert!(code_timeline(&p.conn, "nope", true, "day")
            .unwrap()
            .is_empty());
    }

    fn wf<'a>(rows: &'a [WordFrequency], term: &str) -> Option<&'a WordFrequency> {
        rows.iter().find(|r| r.term == term)
    }

    mod word_frequencies_tests {
        use super::*;

        #[test]
        fn tokenizes_lowercases_and_applies_min_length_and_stop_words() {
            let p = OpenProject::in_memory("t").unwrap();
            documents::create(
                &p.conn,
                new_doc("Coding is coding. The CODING never stops! 😀 漢字学 a an ok it's"),
            )
            .unwrap();
            let rows = word_frequencies(
                &p.conn,
                &WordFrequencyScope::default(),
                &WordFrequencyOptions::default(),
            )
            .unwrap();
            // "coding" appears 3 times regardless of case.
            assert_eq!(wf(&rows, "coding").unwrap().count, 3);
            // Built-in stop words ("is", "the", "a", "an", "it's") are dropped…
            for stop in ["is", "the", "a", "an", "it's"] {
                assert!(wf(&rows, stop).is_none(), "{stop} should be filtered out");
            }
            // …and so is "ok", which is too short (2 code points) even
            // though it isn't a stop word.
            assert!(wf(&rows, "ok").is_none());
            // "never", "stops" and the (3 code point) CJK run all clear both
            // bars and are kept, lowercased.
            assert!(wf(&rows, "never").is_some());
            assert!(wf(&rows, "stops").is_some());
            assert!(wf(&rows, "漢字学").is_some());
        }

        #[test]
        fn min_length_option_is_honoured() {
            let p = OpenProject::in_memory("t").unwrap();
            documents::create(&p.conn, new_doc("ox ax coding")).unwrap();
            let options = WordFrequencyOptions {
                min_length: 1,
                stop_words: false,
                ..WordFrequencyOptions::default()
            };
            let rows = word_frequencies(&p.conn, &WordFrequencyScope::default(), &options).unwrap();
            assert!(wf(&rows, "ox").is_some());
            assert!(wf(&rows, "ax").is_some());
        }

        #[test]
        fn stop_words_option_off_keeps_everything() {
            let p = OpenProject::in_memory("t").unwrap();
            documents::create(&p.conn, new_doc("the cat and the hat")).unwrap();
            let options = WordFrequencyOptions {
                stop_words: false,
                ..WordFrequencyOptions::default()
            };
            let rows = word_frequencies(&p.conn, &WordFrequencyScope::default(), &options).unwrap();
            assert_eq!(wf(&rows, "the").unwrap().count, 2);
            assert!(wf(&rows, "and").is_some());
        }

        #[test]
        fn a_custom_stop_word_is_dropped_alongside_the_built_in_list() {
            let p = OpenProject::in_memory("t").unwrap();
            documents::create(&p.conn, new_doc("misket misket transcript")).unwrap();
            assert!(word_frequencies(
                &p.conn,
                &WordFrequencyScope::default(),
                &WordFrequencyOptions::default()
            )
            .unwrap()
            .iter()
            .any(|r| r.term == "misket"));
            set_stop_words(&p.conn, &["Misket".into(), " transcript ".into()]).unwrap();
            assert_eq!(stop_words(&p.conn).unwrap(), vec!["misket", "transcript"]);
            let rows = word_frequencies(
                &p.conn,
                &WordFrequencyScope::default(),
                &WordFrequencyOptions::default(),
            )
            .unwrap();
            assert!(wf(&rows, "misket").is_none());
            assert!(wf(&rows, "transcript").is_none());
        }

        #[test]
        fn documents_field_counts_distinct_documents() {
            let p = OpenProject::in_memory("t").unwrap();
            documents::create(&p.conn, new_doc("shared word only")).unwrap();
            documents::create(
                &p.conn,
                NewDocument {
                    name: "Doc 2".into(),
                    ..new_doc("shared word repeats repeats here")
                },
            )
            .unwrap();
            let rows = word_frequencies(
                &p.conn,
                &WordFrequencyScope::default(),
                &WordFrequencyOptions::default(),
            )
            .unwrap();
            assert_eq!(wf(&rows, "shared").unwrap().documents, 2);
            assert_eq!(wf(&rows, "shared").unwrap().count, 2);
            assert_eq!(wf(&rows, "repeats").unwrap().documents, 1);
            assert_eq!(wf(&rows, "repeats").unwrap().count, 2);
        }

        #[test]
        fn scopes_by_document_id_and_document_set() {
            let p = OpenProject::in_memory("t").unwrap();
            let doc1 = documents::create(&p.conn, new_doc("apple apple")).unwrap();
            let doc2 = documents::create(
                &p.conn,
                NewDocument {
                    name: "Doc 2".into(),
                    ..new_doc("banana banana")
                },
            )
            .unwrap();
            let scope = WordFrequencyScope {
                document_ids: Some(vec![doc1.summary.id.clone()]),
                ..Default::default()
            };
            let rows = word_frequencies(&p.conn, &scope, &WordFrequencyOptions::default()).unwrap();
            assert!(wf(&rows, "apple").is_some());
            assert!(wf(&rows, "banana").is_none());

            let set = sets::create_set(
                &p.conn,
                "document",
                "Wave 2",
                std::slice::from_ref(&doc2.summary.id),
                None,
            )
            .unwrap();
            let scope = WordFrequencyScope {
                document_set_ids: Some(vec![set.id]),
                ..Default::default()
            };
            let rows = word_frequencies(&p.conn, &scope, &WordFrequencyOptions::default()).unwrap();
            assert!(wf(&rows, "banana").is_some());
            assert!(wf(&rows, "apple").is_none());
        }

        #[test]
        fn scopes_by_code_including_descendants_and_counts_only_coded_text() {
            let p = OpenProject::in_memory("t").unwrap();
            let conn = &p.conn;
            let doc = documents::create(conn, new_doc("apple banana cherry date")).unwrap();
            let doc_id = doc.summary.id.clone();
            let parent = mk_code(conn, "Fruit", None).id;
            let child = mk_code(conn, "Citrus", Some(&parent)).id;
            // "apple" is tagged with the parent code…
            apply(conn, &doc_id, 0, 5, &[&parent]);
            // …"banana" with the child, so a parent-scoped, descendant-
            // inclusive query should still pick it up…
            apply(conn, &doc_id, 6, 12, &[&child]);
            // …and "cherry"/"date" carry no code at all.
            let scope = WordFrequencyScope {
                code_ids: Some(vec![parent.clone()]),
                ..Default::default()
            };
            let options = WordFrequencyOptions {
                min_length: 1,
                stop_words: false,
                ..WordFrequencyOptions::default()
            };
            let rows = word_frequencies(conn, &scope, &options).unwrap();
            assert!(wf(&rows, "apple").is_some());
            assert!(wf(&rows, "banana").is_some());
            assert!(wf(&rows, "cherry").is_none());
            assert!(wf(&rows, "date").is_none());
        }

        #[test]
        fn stemming_groups_word_forms_under_their_most_frequent_surface_form() {
            let p = OpenProject::in_memory("t").unwrap();
            documents::create(&p.conn, new_doc("coding coded coded coding coded")).unwrap();
            let options = WordFrequencyOptions {
                stem: true,
                ..WordFrequencyOptions::default()
            };
            let rows = word_frequencies(&p.conn, &WordFrequencyScope::default(), &options).unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].count, 5);
            assert_eq!(rows[0].term, "coded"); // 3 occurrences beats "coding"'s 2
        }

        #[test]
        fn limit_caps_the_result() {
            let p = OpenProject::in_memory("t").unwrap();
            documents::create(&p.conn, new_doc("alpha beta gamma delta epsilon")).unwrap();
            let options = WordFrequencyOptions {
                limit: 2,
                ..WordFrequencyOptions::default()
            };
            let rows = word_frequencies(&p.conn, &WordFrequencyScope::default(), &options).unwrap();
            assert_eq!(rows.len(), 2);
        }
    }

    mod code_timeline_tests {
        use super::*;

        fn at(conn: &Connection, doc: &str, start: i64, end: i64, code_id: &str, created_at: &str) {
            let excerpt_id = apply(conn, doc, start, end, &[code_id]);
            conn.execute(
                "UPDATE excerpts SET created_at = ?1 WHERE id = ?2",
                rusqlite::params![created_at, excerpt_id],
            )
            .unwrap();
        }

        #[test]
        fn buckets_by_day_week_and_month() {
            let p = OpenProject::in_memory("t").unwrap();
            let conn = &p.conn;
            let doc = documents::create(conn, new_doc(&"x".repeat(40)))
                .unwrap()
                .summary
                .id;
            let code = mk_code(conn, "A", None).id;
            at(conn, &doc, 0, 1, &code, "2024-01-10T00:00:00Z");
            at(conn, &doc, 1, 2, &code, "2024-01-10T12:00:00Z");
            at(conn, &doc, 2, 3, &code, "2024-01-17T00:00:00Z");
            at(conn, &doc, 3, 4, &code, "2024-02-01T00:00:00Z");

            let by_day = code_timeline(conn, &code, false, "day").unwrap();
            assert_eq!(
                by_day,
                vec![
                    ("2024-01-10".to_string(), 2),
                    ("2024-01-17".to_string(), 1),
                    ("2024-02-01".to_string(), 1),
                ]
            );

            let by_month = code_timeline(conn, &code, false, "month").unwrap();
            assert_eq!(
                by_month,
                vec![("2024-01".to_string(), 3), ("2024-02".to_string(), 1)]
            );

            // Weeks group differently than days/months, but should still
            // account for every excerpt, with same-day events landing in
            // the same bucket.
            let by_week = code_timeline(conn, &code, false, "week").unwrap();
            let total: i64 = by_week.iter().map(|(_, c)| *c).sum();
            assert_eq!(total, 4);
            assert!(by_week.iter().any(|(_, c)| *c == 2));
        }

        #[test]
        fn includes_descendants_only_when_asked_and_rejects_unknown_bucket() {
            let p = OpenProject::in_memory("t").unwrap();
            let conn = &p.conn;
            let doc = documents::create(conn, new_doc(&"x".repeat(40)))
                .unwrap()
                .summary
                .id;
            let parent = mk_code(conn, "A", None).id;
            let child = mk_code(conn, "A1", Some(&parent)).id;
            at(conn, &doc, 0, 1, &parent, "2024-01-01T00:00:00Z");
            at(conn, &doc, 1, 2, &child, "2024-01-01T00:00:00Z");

            let own_only = code_timeline(conn, &parent, false, "day").unwrap();
            assert_eq!(own_only, vec![("2024-01-01".to_string(), 1)]);
            let with_descendants = code_timeline(conn, &parent, true, "day").unwrap();
            assert_eq!(with_descendants, vec![("2024-01-01".to_string(), 2)]);

            assert!(code_timeline(conn, &parent, false, "year").is_err());
        }
    }
}
