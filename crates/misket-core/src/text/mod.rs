//! Small text-processing helpers shared by search and analysis: tokenizing
//! project text into words for frequency counting and stemmed matching.
//!
//! This is a different, lower-level module than `db::text` (normalization
//! and code-point slicing of document text); this one is about turning text
//! into words, not about offsets.

pub mod stem;

/// Tokenize `text` into lowercase words: maximal runs of Unicode
/// letters/marks/digits and apostrophes, with leading/trailing apostrophes
/// trimmed. Anything else (whitespace, punctuation, emoji, other symbols) is
/// a separator.
///
/// Document text is NFC-normalized at import (`db::text::normalize`), which
/// already folds combining marks into their base letter for the common
/// cases, so a per-`char` `is_alphanumeric` scan is enough here without
/// pulling in a grapheme-cluster dependency.
pub fn tokenize(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for c in text.chars() {
        if c.is_alphanumeric() || c == '\'' {
            current.push(c);
        } else if !current.is_empty() {
            push_token(&mut out, &current);
            current.clear();
        }
    }
    if !current.is_empty() {
        push_token(&mut out, &current);
    }
    out
}

fn push_token(out: &mut Vec<String>, raw: &str) {
    let trimmed = raw.trim_matches('\'');
    if !trimmed.is_empty() {
        out.push(trimmed.to_lowercase());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_whitespace_and_punctuation() {
        assert_eq!(tokenize("Hello, world!"), vec!["hello", "world"]);
    }

    #[test]
    fn keeps_internal_apostrophes_but_trims_edges() {
        assert_eq!(
            tokenize("Don't 'tis 'quoted' rock'n'roll"),
            vec!["don't", "tis", "quoted", "rock'n'roll"]
        );
    }

    #[test]
    fn emoji_and_symbols_are_separators_not_tokens() {
        assert_eq!(tokenize("great 😀 job #1 !!"), vec!["great", "job", "1"]);
    }

    #[test]
    fn digits_are_tokens_and_mixed_alnum_stays_one_token() {
        assert_eq!(
            tokenize("room 101, code b2"),
            vec!["room", "101", "code", "b2"]
        );
    }

    #[test]
    fn cjk_ideographs_tokenize_as_a_run_and_lowercase_is_a_no_op() {
        // No spaces between CJK ideographs; they still count as
        // alphanumeric and form one run, a reasonable approximation without
        // a full CJK word segmenter.
        assert_eq!(tokenize("漢字 テスト"), vec!["漢字", "テスト"]);
    }

    #[test]
    fn empty_and_punctuation_only_text_tokenizes_to_nothing() {
        assert_eq!(tokenize(""), Vec::<String>::new());
        assert_eq!(tokenize("... --- !!!"), Vec::<String>::new());
    }
}
