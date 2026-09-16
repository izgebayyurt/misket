//! Project-wide substring, regex and stemmed search over document text.

use regex::Regex;
use rusqlite::Connection;

use super::text;
use crate::error::{AppError, Result};
use crate::models::SearchHit;
use crate::text::{stem::stem, tokenize_with_offsets};

/// Code points of context kept on each side of a match.
const CONTEXT_CHARS: i64 = 60;

/// A single search can never return more than this many hits, regex or not,
/// so a pathological pattern (or a very common literal) cannot make "find in
/// project" scan and hold an unbounded result set.
const MAX_HITS: usize = 10_000;

/// Fold ASCII letters to lowercase; everything else (including non-ASCII
/// letters) is left untouched. Because every ASCII character is exactly one
/// UTF-8 byte and folding never changes which character occupies a byte
/// position, a folded string has byte-for-byte the same layout as its
/// source, so byte offsets found in the folded haystack are valid offsets
/// into the original text.
fn fold_ascii(s: &str) -> String {
    s.chars().map(|c| c.to_ascii_lowercase()).collect()
}

/// Byte offset of every code point boundary in `text`, plus one past the end.
/// `text[..v[i]]` always has exactly `i` code points, so a byte offset that
/// falls on a char boundary can be mapped to a code point index by binary
/// search.
fn char_boundaries(text: &str) -> Vec<usize> {
    let mut v: Vec<usize> = text.char_indices().map(|(i, _)| i).collect();
    v.push(text.len());
    v
}

fn context(doc_text: &str, total_len: i64, start: i64, end: i64) -> (String, String) {
    let before_start = (start - CONTEXT_CHARS).max(0);
    let before = text::cp_slice(doc_text, before_start, start).unwrap_or("");
    let after = text::cp_slice(doc_text, end, (end + CONTEXT_CHARS).min(total_len)).unwrap_or("");
    (before.replace('\n', " "), after.replace('\n', " "))
}

fn text_documents(conn: &Connection) -> Result<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, text FROM documents
         WHERE kind = 'text' AND text IS NOT NULL
         ORDER BY sort_order, created_at",
    )?;
    let docs: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(docs)
}

/// Substring, regular-expression or stemmed search across every text
/// document's content.
///
/// - Plain (`regex` false, `stem` false): matching folds ASCII case only
///   (non-ASCII characters must match exactly); see `fold_ascii`.
/// - Regex (`regex` true): `query` is compiled as a standard (case-sensitive;
///   use an inline `(?i)` for case-insensitive) regular expression via the
///   `regex` crate, and an invalid pattern is a `Validation` error. `stem` is
///   ignored in this mode — a regex is matched against the raw text
///   verbatim, so there is no meaningful way to also stem it.
/// - Stemmed (`stem` true, `regex` false): `query` is tokenized into words,
///   each reduced to a stem, and a hit is a contiguous run of document words
///   whose stems match, in order (so "coded interviews" also matches "coding
///   an interview").
///
/// Every mode anchors matches on Unicode code point boundaries and reports
/// the actual matched text in `SearchHit::matched_text` (not the query/
/// pattern itself). An empty or whitespace-only query returns no hits, and
/// the total is capped at `limit` (itself capped at [`MAX_HITS`]) across the
/// whole project. Results are ordered by document (`sort_order`,
/// `created_at`) then by position within the document.
pub fn search_project(
    conn: &Connection,
    query: &str,
    limit: usize,
    regex: bool,
    stem_match: bool,
) -> Result<Vec<SearchHit>> {
    let limit = limit.min(MAX_HITS);
    let needle = query.trim();
    if needle.is_empty() || limit == 0 {
        return Ok(vec![]);
    }

    if regex {
        return search_project_regex(conn, needle, limit);
    }
    if stem_match {
        return search_project_stemmed(conn, needle, limit);
    }
    search_project_literal(conn, needle, limit)
}

fn search_project_literal(conn: &Connection, needle: &str, limit: usize) -> Result<Vec<SearchHit>> {
    let needle_folded = fold_ascii(needle);
    let docs = text_documents(conn)?;

    let mut hits = Vec::new();
    for (document_id, document_name, doc_text) in docs {
        if doc_text.is_empty() {
            continue;
        }
        let folded = fold_ascii(&doc_text);
        let boundaries = char_boundaries(&doc_text);
        let total_len = (boundaries.len() - 1) as i64;
        let mut search_from = 0usize;
        while let Some(rel) = folded[search_from..].find(&needle_folded) {
            let byte_start = search_from + rel;
            let byte_end = byte_start + needle_folded.len();
            // Both offsets fall on char boundaries: `byte_start` because
            // `find` only returns match starts on real char boundaries in
            // valid UTF-8, and `byte_end` because folding is byte-length
            // preserving so it lands wherever the needle's own char
            // boundaries do.
            let start_pos = boundaries.binary_search(&byte_start).unwrap() as i64;
            let end_pos = boundaries.binary_search(&byte_end).unwrap() as i64;
            let (context_before, context_after) = context(&doc_text, total_len, start_pos, end_pos);
            hits.push(SearchHit {
                document_id: document_id.clone(),
                document_name: document_name.clone(),
                start_pos,
                end_pos,
                matched_text: doc_text[byte_start..byte_end].to_string(),
                context_before,
                context_after,
            });
            if hits.len() >= limit {
                return Ok(hits);
            }
            search_from = byte_end;
        }
    }
    Ok(hits)
}

fn search_project_regex(conn: &Connection, pattern: &str, limit: usize) -> Result<Vec<SearchHit>> {
    let re = Regex::new(pattern)
        .map_err(|e| AppError::Validation(format!("invalid regular expression: {e}")))?;
    let docs = text_documents(conn)?;

    let mut hits = Vec::new();
    for (document_id, document_name, doc_text) in docs {
        if doc_text.is_empty() {
            continue;
        }
        let boundaries = char_boundaries(&doc_text);
        let total_len = (boundaries.len() - 1) as i64;
        for m in re.find_iter(&doc_text) {
            // `Match` offsets from a `&str` haystack always fall on char
            // boundaries, so both lookups below succeed.
            let start_pos = boundaries.binary_search(&m.start()).unwrap() as i64;
            let end_pos = boundaries.binary_search(&m.end()).unwrap() as i64;
            let (context_before, context_after) = context(&doc_text, total_len, start_pos, end_pos);
            hits.push(SearchHit {
                document_id: document_id.clone(),
                document_name: document_name.clone(),
                start_pos,
                end_pos,
                matched_text: m.as_str().to_string(),
                context_before,
                context_after,
            });
            if hits.len() >= limit {
                return Ok(hits);
            }
        }
    }
    Ok(hits)
}

/// The `stem: true` path of `search_project`: whole-word, stem-based
/// matching of a (possibly multi-word) query against every document's text.
fn search_project_stemmed(conn: &Connection, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
    let query_stems: Vec<String> = tokenize_with_offsets(query)
        .into_iter()
        .map(|(token, _, _)| stem(&token))
        .collect();
    if query_stems.is_empty() {
        return Ok(vec![]);
    }
    let n = query_stems.len();
    let docs = text_documents(conn)?;

    let mut hits = Vec::new();
    for (document_id, document_name, doc_text) in docs {
        if doc_text.is_empty() {
            continue;
        }
        let total_len = text::cp_len(&doc_text);
        let tokens = tokenize_with_offsets(&doc_text);
        if tokens.len() < n {
            continue;
        }
        let doc_stems: Vec<String> = tokens.iter().map(|(t, _, _)| stem(t)).collect();
        for w in 0..=doc_stems.len() - n {
            if doc_stems[w..w + n] != query_stems[..] {
                continue;
            }
            let start_pos = tokens[w].1;
            let end_pos = tokens[w + n - 1].2;
            let (context_before, context_after) = context(&doc_text, total_len, start_pos, end_pos);
            let matched_text = text::cp_slice(&doc_text, start_pos, end_pos)
                .unwrap_or("")
                .to_string();
            hits.push(SearchHit {
                document_id: document_id.clone(),
                document_name: document_name.clone(),
                start_pos,
                end_pos,
                matched_text,
                context_before,
                context_after,
            });
            if hits.len() >= limit {
                return Ok(hits);
            }
        }
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::documents;
    use crate::db::documents::tests::new_doc;
    use crate::db::OpenProject;

    /// `search_project` with `regex` and `stem` both false — the common case
    /// in most of these tests.
    fn search(conn: &Connection, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        search_project(conn, query, limit, false, false)
    }

    #[test]
    fn empty_or_whitespace_query_returns_nothing() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("hello world")).unwrap();
        assert_eq!(search(&p.conn, "", 50).unwrap(), vec![]);
        assert_eq!(search(&p.conn, "   ", 50).unwrap(), vec![]);
    }

    #[test]
    fn case_insensitive_ascii_match() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("Hello WORLD hello")).unwrap();
        let hits = search(&p.conn, "hello", 50).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!((hits[0].start_pos, hits[0].end_pos), (0, 5));
        // The matched text keeps its own case, not the query's.
        assert_eq!(hits[0].matched_text, "Hello");
        assert_eq!(hits[1].matched_text, "hello");
        assert_eq!((hits[1].start_pos, hits[1].end_pos), (12, 17));
        let hits = search(&p.conn, "WoRlD", 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].start_pos, hits[0].end_pos), (6, 11));
    }

    #[test]
    fn offsets_are_code_points_after_multibyte_text() {
        let p = OpenProject::in_memory("t").unwrap();
        // "héllo 😀 漢字 world" — an emoji and two CJK ideographs before match.
        documents::create(&p.conn, new_doc("héllo 😀 漢字 world end")).unwrap();
        let hits = search(&p.conn, "world", 50).unwrap();
        assert_eq!(hits.len(), 1);
        // h é l l o _ 😀 _ 漢 字 _ = 11 code points before "world".
        assert_eq!(hits[0].start_pos, 11);
        assert_eq!(hits[0].end_pos, 16);
        assert_eq!(hits[0].context_before, "héllo 😀 漢字 ");
        assert_eq!(hits[0].context_after, " end");
    }

    #[test]
    fn context_replaces_newlines_and_is_capped() {
        let p = OpenProject::in_memory("t").unwrap();
        let long_before = "a".repeat(80);
        let long_after = "b".repeat(80);
        let text = format!("{long_before}\nmatch here\n{long_after}");
        documents::create(&p.conn, new_doc(&text)).unwrap();
        let hits = search(&p.conn, "match", 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].context_before.len(), 60);
        assert!(!hits[0].context_before.contains('\n'));
        assert_eq!(hits[0].context_after.len(), 60);
        assert!(!hits[0].context_after.contains('\n'));
    }

    #[test]
    fn ordering_across_documents_and_within_a_document() {
        let p = OpenProject::in_memory("t").unwrap();
        let a = documents::create(&p.conn, new_doc("cat sat, cat ran")).unwrap();
        let b = documents::create(&p.conn, new_doc("the cat")).unwrap();
        let hits = search(&p.conn, "cat", 50).unwrap();
        assert_eq!(hits.len(), 3);
        assert_eq!(hits[0].document_id, a.summary.id);
        assert_eq!(hits[0].start_pos, 0);
        assert_eq!(hits[1].document_id, a.summary.id);
        assert_eq!(hits[1].start_pos, 9);
        assert_eq!(hits[2].document_id, b.summary.id);
        assert_eq!(hits[2].start_pos, 4);
    }

    #[test]
    fn limit_caps_total_hits_across_documents() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("aa aa aa aa")).unwrap();
        documents::create(&p.conn, new_doc("aa aa")).unwrap();
        let hits = search(&p.conn, "aa", 3).unwrap();
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn non_ascii_needle_requires_exact_match() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("café CAFÉ")).unwrap();
        let hits = search(&p.conn, "café", 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].start_pos, 0);
    }

    #[test]
    fn regex_mode_matches_a_pattern_case_sensitively_by_default() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("cat123 Cat456 dog789")).unwrap();
        let hits = search_project(&p.conn, r"[Cc]at\d+", 50, true, false).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!((hits[0].start_pos, hits[0].end_pos), (0, 6));
        assert_eq!((hits[1].start_pos, hits[1].end_pos), (7, 13));
        assert_eq!(hits[0].matched_text, "cat123");
        assert_eq!(hits[1].matched_text, "Cat456");
        // Case-sensitive unless the pattern says otherwise.
        let hits = search_project(&p.conn, r"cat\d+", 50, true, false).unwrap();
        assert_eq!(hits.len(), 1);
        let hits = search_project(&p.conn, r"(?i)cat\d+", 50, true, false).unwrap();
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn regex_mode_anchors_matches_on_code_points_with_multibyte_text() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("漢字 world 😀 end")).unwrap();
        let hits = search_project(&p.conn, r"w\w+d", 50, true, false).unwrap();
        assert_eq!(hits.len(), 1);
        // "漢字 " is 3 code points before "world".
        assert_eq!((hits[0].start_pos, hits[0].end_pos), (3, 8));
    }

    #[test]
    fn regex_mode_rejects_an_invalid_pattern() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("hello")).unwrap();
        assert!(matches!(
            search_project(&p.conn, "(unclosed", 50, true, false),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn regex_mode_handles_empty_matches_without_looping() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("abc")).unwrap();
        let hits = search_project(&p.conn, "x*", 50, true, false).unwrap();
        // One (empty) match at every code point boundary: 0..3 plus the end.
        assert_eq!(hits.len(), 4);
        assert!(hits.iter().all(|h| h.start_pos == h.end_pos));
    }

    #[test]
    fn regex_mode_ignores_the_stem_flag() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("coding coded")).unwrap();
        // A literal regex still matches literally even with `stem: true` —
        // regex takes priority and stem is documented as ignored then.
        let hits = search_project(&p.conn, "coding", 50, true, true).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].matched_text, "coding");
    }

    #[test]
    fn limit_is_capped_at_max_hits() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc(&"a".repeat(20_000))).unwrap();
        let hits = search_project(&p.conn, "a", 50_000, false, false).unwrap();
        assert_eq!(hits.len(), MAX_HITS);
    }

    #[test]
    fn stemmed_search_matches_other_word_forms() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("She coded the interview yesterday.")).unwrap();
        // A literal search for "coding" finds nothing…
        assert_eq!(search(&p.conn, "coding", 50).unwrap(), vec![]);
        // …but a stemmed search matches "coded" (both stem to "code").
        let hits = search_project(&p.conn, "coding", 50, false, true).unwrap();
        assert_eq!(hits.len(), 1);
        // "She |coded| the interview yesterday." — "coded" is code points 4..9.
        assert_eq!((hits[0].start_pos, hits[0].end_pos), (4, 9));
        assert_eq!(hits[0].matched_text, "coded");
    }

    #[test]
    fn stemmed_search_matches_a_multi_word_query_in_order() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(
            &p.conn,
            new_doc("The participants were coding interviews all week."),
        )
        .unwrap();
        // Query words are stemmed too: "code" + "interview" matches "coding interviews".
        let hits = search_project(&p.conn, "code interview", 50, false, true).unwrap();
        assert_eq!(hits.len(), 1);
        // "…were |coding interviews| all week." — code points 22..39.
        assert_eq!(hits[0].start_pos, 22);
        assert_eq!(hits[0].end_pos, 39);
    }

    #[test]
    fn stemmed_search_does_not_match_out_of_order_or_partial_words() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("interview coding session")).unwrap();
        assert_eq!(
            search_project(&p.conn, "code interview", 50, false, true).unwrap(),
            vec![]
        );
        // A stemmed search for "code" does match "coding" (both stem to
        // "code")… but "codicil" is a whole other word that merely starts
        // with the same letters, and must not match just by sharing a
        // prefix — whole-word stemming, not a substring search.
        documents::create(&p.conn, new_doc("a codicil to the will")).unwrap();
        let hits = search_project(&p.conn, "code", 50, false, true).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].document_name, "Interview 1");
        assert_eq!((hits[0].start_pos, hits[0].end_pos), (10, 16));
    }
}
