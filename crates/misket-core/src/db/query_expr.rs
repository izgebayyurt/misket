//! The excerpt browser's Boolean/proximity query: "A and B", "A not B",
//! "A near B within the same paragraph".
//!
//! # Semantics
//!
//! A query is evaluated **per document**, over that document's text excerpts.
//! Image regions never match: like `co_occurrence` and
//! `ExcerptFilter::overlaps_code_id`, everything here is defined on ranges.
//!
//! A [`CodeRef`] matches the excerpts carrying that code (its whole subtree
//! when `includeDescendants` is set). The operators are **co-located** rather
//! than per-excerpt, which is the only reading that makes "A and B" useful on
//! real coding — two coders rarely put both codes on byte-identical ranges:
//!
//! | `op`   | An excerpt matches when it…                                                                      |
//! | ------ | ------------------------------------------------------------------------------------------------ |
//! | `and`  | satisfies *every* term, where satisfying a term means carrying it or overlapping an excerpt that does |
//! | `or`   | satisfies *any* term                                                                              |
//! | `not`  | satisfies the first term and does not overlap any excerpt satisfying a later one                   |
//! | `near` | satisfies the first term and lies near an excerpt satisfying a later one                           |
//!
//! Overlap is the same half-open test the rest of the project uses,
//! `a.start < b.end AND b.start < a.end`, so an excerpt always overlaps
//! itself. That is deliberate: an excerpt carrying both A and B matches
//! "A and B" and "A near B", and is excluded from "A not B".
//!
//! `near` takes a scope: [`Within::Paragraph`] (the default) means the two
//! excerpts touch a common paragraph, paragraphs being the document text split
//! on `\n`; [`Within::Chars`] means at most `n` code points lie between them
//! (overlapping counts as zero). Code points, not bytes, so emoji and CJK text
//! measure the same way the offsets do.
//!
//! Nesting is by `Group`: `{op: "and", terms: [A, {op: "or", terms: [B, C]}]}`
//! reads "A and (B or C)". A group is satisfied by the excerpts that match it,
//! and then the outer operator applies its own co-location on top.

use std::collections::{HashMap, HashSet};

use rusqlite::Connection;

use super::codes;
use crate::error::{AppError, Result};
use crate::models::{CodeRef, Query, QueryTerm, Within};

/// How deep a query may nest. The UI offers one level of grouping; this is
/// only here so a hand-written filter cannot blow the stack.
const MAX_DEPTH: usize = 8;

/// The largest `near … within N characters` worth accepting.
const MAX_CHARS: i64 = 10_000_000;

/// Reject a query the evaluator could not make sense of, with a message the
/// UI can show as-is.
pub fn validate(q: &Query) -> Result<()> {
    validate_at(q, 0)
}

fn validate_at(q: &Query, depth: usize) -> Result<()> {
    if depth > MAX_DEPTH {
        return Err(AppError::Validation(
            "this query nests too deeply".to_string(),
        ));
    }
    let min_terms = match q.op.as_str() {
        "and" | "or" => 1,
        "not" | "near" => 2,
        other => {
            return Err(AppError::Validation(format!(
                "unknown query operator {other:?}; expected \"and\", \"or\", \"not\" or \"near\""
            )))
        }
    };
    if q.terms.len() < min_terms {
        return Err(AppError::Validation(format!(
            "{:?} needs at least {min_terms} code{}",
            q.op,
            if min_terms == 1 { "" } else { "s" }
        )));
    }
    if let Some(Within::Chars { n }) = q.within {
        if !(0..=MAX_CHARS).contains(&n) {
            return Err(AppError::Validation(format!(
                "a distance of {n} characters is out of range (0 to {MAX_CHARS})"
            )));
        }
    }
    for term in &q.terms {
        match term {
            QueryTerm::Code(c) => {
                if c.code_id.trim().is_empty() {
                    return Err(AppError::Validation("a query term has no code".to_string()));
                }
            }
            QueryTerm::Group(inner) => validate_at(inner, depth + 1)?,
        }
    }
    Ok(())
}

/// One document's text excerpts, in `start` order, with everything the
/// operators need.
struct DocExcerpts {
    ids: Vec<String>,
    ranges: Vec<(i64, i64)>,
    codes_of: Vec<HashSet<String>>,
    /// `[first, last]` paragraph index per excerpt; filled on first use,
    /// because only `near` in paragraph scope needs the document text.
    paragraphs: Option<Vec<(usize, usize)>>,
}

impl DocExcerpts {
    fn len(&self) -> usize {
        self.ids.len()
    }

    fn overlaps(&self, i: usize, j: usize) -> bool {
        let (a, b) = (self.ranges[i], self.ranges[j]);
        a.0 < b.1 && b.0 < a.1
    }

    /// Code point gap between two excerpts; zero when they overlap or touch.
    fn gap(&self, i: usize, j: usize) -> i64 {
        let (a, b) = (self.ranges[i], self.ranges[j]);
        (b.0 - a.1).max(a.0 - b.1).max(0)
    }

    fn same_paragraph(&self, i: usize, j: usize) -> bool {
        match &self.paragraphs {
            // Without the document text every excerpt is treated as its own
            // paragraph, so only overlapping ones count as "same".
            None => self.overlaps(i, j),
            Some(p) => p[i].0 <= p[j].1 && p[j].0 <= p[i].1,
        }
    }
}

/// Code point offset of the start of each paragraph, splitting on `\n`.
fn paragraph_starts(text: &str) -> Vec<i64> {
    let mut starts = vec![0i64];
    for (i, c) in text.chars().enumerate() {
        if c == '\n' {
            starts.push(i as i64 + 1);
        }
    }
    starts
}

/// Which paragraph a code point offset falls in.
fn paragraph_at(starts: &[i64], pos: i64) -> usize {
    starts.partition_point(|s| *s <= pos).saturating_sub(1)
}

/// Does the query ask for paragraphs anywhere inside it?
fn needs_paragraphs(q: &Query) -> bool {
    if q.op == "near" && !matches!(q.within, Some(Within::Chars { .. })) {
        return true;
    }
    q.terms.iter().any(|t| match t {
        QueryTerm::Code(_) => false,
        QueryTerm::Group(inner) => needs_paragraphs(inner),
    })
}

/// Expands a code into the ids that count for it, memoized across documents.
struct CodeExpander<'a> {
    conn: &'a Connection,
    cache: HashMap<(String, bool), Vec<String>>,
}

impl CodeExpander<'_> {
    fn ids(&mut self, code: &CodeRef) -> Result<&[String]> {
        let key = (code.code_id.clone(), code.include_descendants);
        if !self.cache.contains_key(&key) {
            let ids = if code.include_descendants {
                codes::descendant_ids(self.conn, std::slice::from_ref(&code.code_id))?
            } else {
                vec![code.code_id.clone()]
            };
            self.cache.insert(key.clone(), ids);
        }
        Ok(&self.cache[&key])
    }
}

/// Which of the document's excerpts a term picks out, as a bitmask.
fn eval_term(term: &QueryTerm, doc: &DocExcerpts, ex: &mut CodeExpander) -> Result<Vec<bool>> {
    match term {
        QueryTerm::Code(code) => {
            let ids = ex.ids(code)?.to_vec();
            Ok((0..doc.len())
                .map(|i| ids.iter().any(|id| doc.codes_of[i].contains(id)))
                .collect())
        }
        QueryTerm::Group(inner) => eval(inner, doc, ex),
    }
}

/// `hits[i]`, or "overlaps some excerpt where `hits` holds" — the co-location
/// that makes `and` and `not` useful across differently-drawn excerpts.
fn co_located(doc: &DocExcerpts, hits: &[bool]) -> Vec<bool> {
    (0..doc.len())
        .map(|i| (0..doc.len()).any(|j| hits[j] && doc.overlaps(i, j)))
        .collect()
}

fn eval(q: &Query, doc: &DocExcerpts, ex: &mut CodeExpander) -> Result<Vec<bool>> {
    let mut sets = Vec::with_capacity(q.terms.len());
    for term in &q.terms {
        sets.push(eval_term(term, doc, ex)?);
    }
    let n = doc.len();
    Ok(match q.op.as_str() {
        "or" => (0..n).map(|i| sets.iter().any(|s| s[i])).collect(),
        "and" => {
            let reach: Vec<Vec<bool>> = sets.iter().map(|s| co_located(doc, s)).collect();
            (0..n).map(|i| reach.iter().all(|r| r[i])).collect()
        }
        "not" => {
            let excluded: Vec<Vec<bool>> = sets[1..].iter().map(|s| co_located(doc, s)).collect();
            (0..n)
                .map(|i| sets[0][i] && !excluded.iter().any(|r| r[i]))
                .collect()
        }
        "near" => {
            let near = |i: usize, j: usize| match q.within {
                Some(Within::Chars { n }) => doc.gap(i, j) <= n,
                _ => doc.same_paragraph(i, j),
            };
            (0..n)
                .map(|i| sets[0][i] && sets[1..].iter().all(|s| (0..n).any(|j| s[j] && near(i, j))))
                .collect()
        }
        // `validate` runs first, so this is unreachable from the commands.
        _ => vec![false; n],
    })
}

/// Load one document's text excerpts and their codes.
fn load_document(conn: &Connection, document_id: &str, paragraphs: bool) -> Result<DocExcerpts> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.start_pos, e.end_pos FROM excerpts e
         WHERE e.document_id = ?1 AND e.kind = 'text'
           AND e.start_pos IS NOT NULL AND e.end_pos IS NOT NULL
         ORDER BY e.start_pos, e.end_pos, e.id",
    )?;
    let rows: Vec<(String, i64, i64)> = stmt
        .query_map([document_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let ids: Vec<String> = rows.iter().map(|(id, ..)| id.clone()).collect();
    let ranges: Vec<(i64, i64)> = rows.iter().map(|(_, s, e)| (*s, *e)).collect();

    let index: HashMap<&str, usize> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();
    let mut codes_of = vec![HashSet::new(); ids.len()];
    let mut stmt = conn.prepare(
        "SELECT ec.excerpt_id, ec.code_id FROM excerpt_codes ec
         JOIN excerpts e ON e.id = ec.excerpt_id WHERE e.document_id = ?1",
    )?;
    for row in stmt.query_map([document_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })? {
        let (excerpt_id, code_id) = row?;
        if let Some(i) = index.get(excerpt_id.as_str()) {
            codes_of[*i].insert(code_id);
        }
    }

    let paragraphs = if paragraphs {
        let (text, _) = super::documents::get_text(conn, document_id)?;
        let starts = paragraph_starts(&text);
        Some(
            ranges
                .iter()
                .map(|(s, e)| {
                    let first = paragraph_at(&starts, *s);
                    (first, paragraph_at(&starts, (*e - 1).max(*s)).max(first))
                })
                .collect(),
        )
    } else {
        None
    };

    Ok(DocExcerpts {
        ids,
        ranges,
        codes_of,
        paragraphs,
    })
}

/// Keep the candidates the query matches, in the order they came in.
///
/// `candidates` is `(excerpt id, document id)` — whatever the rest of the
/// filter left. The query itself is evaluated against *every* text excerpt of
/// the documents involved, not only the candidates: "A and B" asks whether an
/// excerpt overlaps an excerpt coded B, and that neighbour need not be
/// something the browser would have shown on its own.
pub fn retain_matches(
    conn: &Connection,
    q: &Query,
    candidates: &[(String, String)],
) -> Result<Vec<String>> {
    validate(q)?;
    let paragraphs = needs_paragraphs(q);
    let mut expander = CodeExpander {
        conn,
        cache: HashMap::new(),
    };
    let mut matched: HashMap<&str, HashSet<String>> = HashMap::new();
    let mut out = Vec::new();
    for (excerpt_id, document_id) in candidates {
        if !matched.contains_key(document_id.as_str()) {
            let doc = load_document(conn, document_id, paragraphs)?;
            let hits = eval(q, &doc, &mut expander)?;
            let ids = doc
                .ids
                .iter()
                .zip(hits)
                .filter(|(_, hit)| *hit)
                .map(|(id, _)| id.clone())
                .collect();
            matched.insert(document_id.as_str(), ids);
        }
        if matched[document_id.as_str()].contains(excerpt_id) {
            out.push(excerpt_id.clone());
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::codes::tests::mk as mk_code;
    use crate::db::documents::tests::new_doc;
    use crate::db::{documents, excerpts, OpenProject};
    use crate::models::{ApplyCodesInput, ExcerptFilter, NewDocument};

    /// Emoji and CJK throughout, so every offset in this module is exercised
    /// in code points rather than bytes.
    ///
    /// ```text
    /// paragraph 0: 猫が好き 😀 alpha beta
    /// paragraph 1: gamma 🐈 delta 漢字
    /// paragraph 2: epsilon zeta
    /// ```
    const TEXT: &str = "猫が好き 😀 alpha beta\ngamma 🐈 delta 漢字\nepsilon zeta";

    struct F {
        project: OpenProject,
        doc: String,
        a: String,
        b: String,
        c: String,
        d: String,
    }

    /// `[start, end)` of a substring, in code points.
    fn span(needle: &str) -> (i64, i64) {
        let byte = TEXT.find(needle).expect("substring is in the fixture");
        let start = TEXT[..byte].chars().count() as i64;
        (start, start + needle.chars().count() as i64)
    }

    fn apply(conn: &Connection, doc: &str, needle: &str, code_ids: &[&str]) -> String {
        let (start, end) = span(needle);
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

    /// Four codes on four ranges: A and B overlap in paragraph 0, C sits
    /// apart in the same paragraph, D is in paragraph 1. `child` is a
    /// sub-code of A used nowhere except on D's range.
    fn fixture() -> (F, String, String, String, String) {
        let project = OpenProject::in_memory("t").unwrap();
        let conn = &project.conn;
        let doc = documents::create(conn, new_doc(TEXT)).unwrap().summary.id;
        let a = mk_code(conn, "A", None).id;
        let child = mk_code(conn, "A child", Some(&a)).id;
        let b = mk_code(conn, "B", None).id;
        let c = mk_code(conn, "C", None).id;
        let d = mk_code(conn, "D", None).id;

        let ex_a = apply(conn, &doc, "猫が好き", &[&a]);
        let ex_b = apply(conn, &doc, "好き 😀", &[&b]);
        let ex_c = apply(conn, &doc, "alpha", &[&c]);
        let ex_d = apply(conn, &doc, "delta 漢字", &[&d, &child]);

        (
            F {
                project,
                doc,
                a,
                b,
                c,
                d,
            },
            ex_a,
            ex_b,
            ex_c,
            ex_d,
        )
    }

    fn code(id: &str) -> QueryTerm {
        QueryTerm::Code(CodeRef {
            code_id: id.into(),
            include_descendants: false,
        })
    }

    /// The ids `q` matches, through the real `excerpts::query` path so that
    /// paging and `total` are exercised too.
    fn run(f: &F, q: Query) -> Vec<String> {
        let page = excerpts::query(
            &f.project.conn,
            &ExcerptFilter {
                query: Some(q),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, page.rows.len() as i64, "total matches the rows");
        page.rows.into_iter().map(|r| r.excerpt.id).collect()
    }

    fn q(op: &str, terms: Vec<QueryTerm>) -> Query {
        Query {
            op: op.into(),
            terms,
            within: None,
        }
    }

    #[test]
    fn and_is_co_located_not_per_excerpt() {
        let (f, ex_a, ex_b, _, _) = fixture();
        // A and B are on overlapping ranges, so both excerpts satisfy both
        // terms: "A and B" retrieves the pair, not the empty set a strict
        // per-excerpt reading would give.
        let mut hits = run(&f, q("and", vec![code(&f.a), code(&f.b)]));
        hits.sort();
        let mut want = vec![ex_a.clone(), ex_b.clone()];
        want.sort();
        assert_eq!(hits, want);

        // A and C are in the same paragraph but do not overlap: nothing.
        assert!(run(&f, q("and", vec![code(&f.a), code(&f.c)])).is_empty());

        // One excerpt carrying both codes satisfies "and" on its own.
        let both = apply(&f.project.conn, &f.doc, "epsilon", &[&f.c, &f.d]);
        assert_eq!(run(&f, q("and", vec![code(&f.c), code(&f.d)])), vec![both]);

        // Sub-codes count for their parent when the term says so.
        let with_children = Query {
            op: "and".into(),
            terms: vec![
                QueryTerm::Code(CodeRef {
                    code_id: f.a.clone(),
                    include_descendants: true,
                }),
                code(&f.d),
            ],
            within: None,
        };
        // "A child" sits on D's own range, so the pair is co-located there.
        assert_eq!(run(&f, with_children).len(), 1);
        assert!(run(&f, q("and", vec![code(&f.a), code(&f.d)])).is_empty());
    }

    #[test]
    fn or_is_the_union_and_not_subtracts_overlaps() {
        let (f, ex_a, _, ex_c, ex_d) = fixture();
        let mut hits = run(&f, q("or", vec![code(&f.a), code(&f.d)]));
        hits.sort();
        let mut want = vec![ex_a.clone(), ex_d.clone()];
        want.sort();
        assert_eq!(hits, want);

        // A overlaps B, so "A not B" drops it.
        assert!(run(&f, q("not", vec![code(&f.a), code(&f.b)])).is_empty());
        // A does not overlap C, so "A not C" keeps it — and only it.
        assert_eq!(run(&f, q("not", vec![code(&f.a), code(&f.c)])), vec![ex_a]);
        // "C not A" keeps C, which is what "the first term" means.
        assert_eq!(run(&f, q("not", vec![code(&f.c), code(&f.a)])), vec![ex_c]);
        // Later terms are all excluded, not just the second.
        assert!(run(&f, q("not", vec![code(&f.a), code(&f.c), code(&f.b)])).is_empty());
    }

    #[test]
    fn near_measures_paragraphs_and_code_points() {
        let (f, ex_a, ..) = fixture();
        let paragraph = |terms| Query {
            op: "near".into(),
            terms,
            within: Some(Within::Paragraph),
        };
        // A and C share paragraph 0 without overlapping.
        assert_eq!(
            run(&f, paragraph(vec![code(&f.a), code(&f.c)])),
            vec![ex_a.clone()]
        );
        // D is in paragraph 1, so it is not near A in paragraph scope.
        assert!(run(&f, paragraph(vec![code(&f.a), code(&f.d)])).is_empty());
        // The default scope is the paragraph.
        assert_eq!(
            run(&f, q("near", vec![code(&f.a), code(&f.c)])),
            vec![ex_a.clone()]
        );

        // In code points: 猫が好き ends at 4 and alpha starts at 7, three
        // code points apart — the emoji counts as one, not four bytes.
        let chars = |n, terms| Query {
            op: "near".into(),
            terms,
            within: Some(Within::Chars { n }),
        };
        assert_eq!(
            run(&f, chars(3, vec![code(&f.a), code(&f.c)])),
            vec![ex_a.clone()]
        );
        assert!(run(&f, chars(2, vec![code(&f.a), code(&f.c)])).is_empty());

        // Across the newline: delta 漢字 starts 22 code points after A ends.
        assert_eq!(
            run(&f, chars(22, vec![code(&f.a), code(&f.d)])),
            vec![ex_a.clone()]
        );
        assert!(run(&f, chars(21, vec![code(&f.a), code(&f.d)])).is_empty());
    }

    #[test]
    fn groups_nest_and_bad_queries_are_rejected() {
        let (f, ex_a, ex_b, _, _) = fixture();
        // "B and (A or D)": B overlaps A, so B and A both come back.
        let nested = Query {
            op: "and".into(),
            terms: vec![
                code(&f.b),
                QueryTerm::Group(Box::new(q("or", vec![code(&f.a), code(&f.d)]))),
            ],
            within: None,
        };
        let mut hits = run(&f, nested);
        hits.sort();
        let mut want = vec![ex_a, ex_b];
        want.sort();
        assert_eq!(hits, want);

        for bad in [
            q("maybe", vec![code(&f.a)]),
            q("not", vec![code(&f.a)]),
            q("near", vec![code(&f.a)]),
            q("and", vec![]),
            q("and", vec![code("  ")]),
            Query {
                op: "near".into(),
                terms: vec![code(&f.a), code(&f.b)],
                within: Some(Within::Chars { n: -1 }),
            },
        ] {
            assert!(
                matches!(validate(&bad), Err(AppError::Validation(_))),
                "{bad:?} should be rejected"
            );
        }
    }

    #[test]
    fn the_query_composes_with_the_other_filters_and_with_paging() {
        let (f, ex_a, ex_b, _, _) = fixture();
        // A second document with the same coding, so paging has something to
        // page over and the document filter something to cut.
        let other = documents::create(
            &f.project.conn,
            NewDocument {
                name: "Interview 2".into(),
                ..new_doc(&format!("{TEXT} tail"))
            },
        )
        .unwrap()
        .summary
        .id;
        apply(&f.project.conn, &other, "猫が好き", &[&f.a]);
        apply(&f.project.conn, &other, "好き 😀", &[&f.b]);

        let expr = q("and", vec![code(&f.a), code(&f.b)]);
        let page = |limit, offset| {
            excerpts::query(
                &f.project.conn,
                &ExcerptFilter {
                    query: Some(expr.clone()),
                    limit,
                    offset,
                    ..Default::default()
                },
            )
            .unwrap()
        };
        // Four matches across two documents; `total` counts them all however
        // small the page is.
        assert_eq!(page(200, 0).total, 4);
        assert_eq!(page(2, 0).rows.len(), 2);
        assert_eq!(page(2, 0).total, 4);
        assert_eq!(page(2, 2).rows.len(), 2);
        assert_eq!(page(2, 4).rows.len(), 0);
        // The pages partition the result.
        let first: Vec<String> = page(2, 0).rows.into_iter().map(|r| r.excerpt.id).collect();
        let second: Vec<String> = page(2, 2).rows.into_iter().map(|r| r.excerpt.id).collect();
        assert!(first.iter().all(|id| !second.contains(id)));

        // Other filters still apply, and narrow the query rather than the
        // other way round.
        let narrowed = excerpts::query(
            &f.project.conn,
            &ExcerptFilter {
                query: Some(expr.clone()),
                document_ids: Some(vec![f.doc.clone()]),
                ..Default::default()
            },
        )
        .unwrap();
        let mut ids: Vec<String> = narrowed.rows.into_iter().map(|r| r.excerpt.id).collect();
        ids.sort();
        let mut want = vec![ex_a, ex_b];
        want.sort();
        assert_eq!((narrowed.total, ids), (2, want));

        // A code filter intersects with the query.
        let coded = excerpts::query(
            &f.project.conn,
            &ExcerptFilter {
                query: Some(expr),
                code_ids: Some(vec![f.a.clone()]),
                include_descendants: false,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(coded.total, 2);

        // An invalid query is an error, not a silently empty page.
        assert!(matches!(
            excerpts::query(
                &f.project.conn,
                &ExcerptFilter {
                    query: Some(q("near", vec![code(&f.a)])),
                    ..Default::default()
                }
            ),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn image_excerpts_never_match_a_query() {
        let (f, ..) = fixture();
        let img = documents::create_image(
            &f.project.conn,
            crate::db::documents::tests::new_image(b"shot.png"),
        )
        .unwrap()
        .summary
        .id;
        excerpts::apply_codes(
            &f.project.conn,
            ApplyCodesInput {
                document_id: img,
                kind: Some("image_region".into()),
                geometry: Some(crate::models::Rect {
                    x: 0.1,
                    y: 0.1,
                    w: 0.2,
                    h: 0.2,
                }),
                code_ids: vec![f.a.clone(), f.b.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        // The region carries both codes, but a query is defined on ranges.
        assert_eq!(run(&f, q("and", vec![code(&f.a), code(&f.b)])).len(), 2);
    }
}
