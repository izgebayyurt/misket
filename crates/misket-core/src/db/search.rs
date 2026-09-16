//! Project-wide substring search over document text.

use rusqlite::Connection;

use super::text;
use crate::error::Result;
use crate::models::SearchHit;
use crate::text::{stem::stem, tokenize_with_offsets};

/// Code points of context kept on each side of a match.
const CONTEXT_CHARS: i64 = 60;

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

/// Case-insensitive substring search across every text document's content.
///
/// Matching folds ASCII case only (non-ASCII characters must match exactly);
/// see `fold_ascii`. An empty or whitespace-only query returns no hits.
/// Results are ordered by document (`sort_order`, `created_at`) then by
/// position within the document, and capped at `limit` hits overall.
///
/// When `stem` is true, the query and the document are compared as whole
/// words by stem instead: `query` is tokenized into words, each is reduced
/// to a stem, and a hit is a contiguous run of document words whose stems
/// match, in order (so "coded interviews" also matches "coding an
/// interview"). The returned range is the actual matched text, not the
/// query text.
pub fn search_project(
    conn: &Connection,
    query: &str,
    limit: usize,
    stem_match: bool,
) -> Result<Vec<SearchHit>> {
    let needle = query.trim();
    if needle.is_empty() || limit == 0 {
        return Ok(vec![]);
    }
    if stem_match {
        return search_project_stemmed(conn, needle, limit);
    }
    let needle_folded = fold_ascii(needle);

    let mut stmt = conn.prepare(
        "SELECT id, name, text FROM documents
         WHERE kind = 'text' AND text IS NOT NULL
         ORDER BY sort_order, created_at",
    )?;
    let docs: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;

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
                match_text: doc_text[byte_start..byte_end].to_string(),
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

    let mut stmt = conn.prepare(
        "SELECT id, name, text FROM documents
         WHERE kind = 'text' AND text IS NOT NULL
         ORDER BY sort_order, created_at",
    )?;
    let docs: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;

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
            let match_text = text::cp_slice(&doc_text, start_pos, end_pos)
                .unwrap_or("")
                .to_string();
            hits.push(SearchHit {
                document_id: document_id.clone(),
                document_name: document_name.clone(),
                start_pos,
                end_pos,
                match_text,
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

    #[test]
    fn empty_or_whitespace_query_returns_nothing() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("hello world")).unwrap();
        assert_eq!(search_project(&p.conn, "", 50, false).unwrap(), vec![]);
        assert_eq!(search_project(&p.conn, "   ", 50, false).unwrap(), vec![]);
    }

    #[test]
    fn case_insensitive_ascii_match() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("Hello WORLD hello")).unwrap();
        let hits = search_project(&p.conn, "hello", 50, false).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!((hits[0].start_pos, hits[0].end_pos), (0, 5));
        // The matched text keeps its original case, even though the query didn't.
        assert_eq!(hits[0].match_text, "Hello");
        assert_eq!(hits[1].match_text, "hello");
        assert_eq!((hits[1].start_pos, hits[1].end_pos), (12, 17));
        let hits = search_project(&p.conn, "WoRlD", 50, false).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].start_pos, hits[0].end_pos), (6, 11));
    }

    #[test]
    fn offsets_are_code_points_after_multibyte_text() {
        let p = OpenProject::in_memory("t").unwrap();
        // "héllo 😀 漢字 world" — an emoji and two CJK ideographs before match.
        documents::create(&p.conn, new_doc("héllo 😀 漢字 world end")).unwrap();
        let hits = search_project(&p.conn, "world", 50, false).unwrap();
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
        let hits = search_project(&p.conn, "match", 50, false).unwrap();
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
        let hits = search_project(&p.conn, "cat", 50, false).unwrap();
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
        let hits = search_project(&p.conn, "aa", 3, false).unwrap();
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn non_ascii_needle_requires_exact_match() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("café CAFÉ")).unwrap();
        let hits = search_project(&p.conn, "café", 50, false).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].start_pos, 0);
    }

    #[test]
    fn stemmed_search_matches_other_word_forms() {
        let p = OpenProject::in_memory("t").unwrap();
        documents::create(&p.conn, new_doc("She coded the interview yesterday.")).unwrap();
        // A literal search for "coding" finds nothing…
        assert_eq!(
            search_project(&p.conn, "coding", 50, false).unwrap(),
            vec![]
        );
        // …but a stemmed search matches "coded" (both stem to "code").
        let hits = search_project(&p.conn, "coding", 50, true).unwrap();
        assert_eq!(hits.len(), 1);
        // "She |coded| the interview yesterday." — "coded" is code points 4..9.
        assert_eq!((hits[0].start_pos, hits[0].end_pos), (4, 9));
        assert_eq!(hits[0].match_text, "coded");
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
        let hits = search_project(&p.conn, "code interview", 50, true).unwrap();
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
            search_project(&p.conn, "code interview", 50, true).unwrap(),
            vec![]
        );
        // A stemmed search for "code" does match "coding" (both stem to
        // "code")… but "codicil" is a whole other word that merely starts
        // with the same letters, and must not match just by sharing a
        // prefix — whole-word stemming, not a substring search.
        documents::create(&p.conn, new_doc("a codicil to the will")).unwrap();
        let hits = search_project(&p.conn, "code", 50, true).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].document_name, "Interview 1");
        assert_eq!((hits[0].start_pos, hits[0].end_pos), (10, 16));
    }
}
