//! Speaker-turn detection for interview transcripts.
//!
//! Recognizes lines that open with a speaker label — `Name:`, `NAME:`,
//! `[Name]`, or `Name (00:12):` — and groups the text that follows each one
//! (up to the next recognized label, or the end of the document) into a
//! [`Turn`]. Deliberately conservative: a candidate label must be short (at
//! most [`MAX_LABEL_WORDS`] words, at most [`MAX_LABEL_CHARS`] characters)
//! and must *recur* — the exact same label (case- and spacing-insensitively)
//! must open at least two lines — before any of its lines count as turns, so
//! a document with one stray "Note:" or a mid-sentence parenthetical is left
//! alone. This is a pure text function; it does not know about documents or
//! excerpts.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::db::text::cp_len;

/// One speaker's turn: the text after their label, up to the next label or
/// the end of the document. Code points, end-exclusive; the label itself is
/// excluded. Doubles as the IPC DTO (camelCase JSON), like `models::SearchHit`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    /// As it appears on the line (original case, timestamp stripped).
    pub speaker: String,
    pub start: i64,
    pub end: i64,
}

const MAX_LABEL_CHARS: usize = 40;
const MAX_LABEL_WORDS: usize = 4;

fn normalize_key(label: &str) -> String {
    label
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn is_label_char(c: char) -> bool {
    c.is_alphabetic()
        || c.is_numeric()
        || c == ' '
        || c == '\''
        || c == '\u{2019}'
        || c == '-'
        || c == '.'
}

/// Validate and trim a candidate label's text (the timestamp, if any, has
/// already been split off by the caller).
fn valid_label(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_LABEL_CHARS {
        return None;
    }
    if !trimmed.chars().all(is_label_char) {
        return None;
    }
    if !trimmed.chars().any(|c| c.is_alphabetic()) {
        return None;
    }
    let words = trimmed.split_whitespace().count();
    if words == 0 || words > MAX_LABEL_WORDS {
        return None;
    }
    Some(trimmed.to_string())
}

/// `00:12` or `01:02:03`: digits and colons only, so a genuine parenthetical
/// remark like `(see notes)` never passes as a timestamp.
fn valid_timestamp(raw: &str) -> bool {
    let t = raw.trim();
    !t.is_empty()
        && t.len() <= 11
        && t.contains(':')
        && t.chars().all(|c| c.is_ascii_digit() || c == ':')
}

/// Try `Name:`, `NAME:` or `Name (00:12):` at the start of `line[start..]`.
/// Returns the display label and the byte offset (from the start of `line`)
/// where the turn's own text begins.
fn colon_label(line: &str, start: usize) -> Option<(String, usize)> {
    let rest = &line[start..];
    let mut depth = 0i32;
    let mut colon_byte = None;
    for (chars_seen, (byte, c)) in rest.char_indices().enumerate() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            ':' if depth <= 0 => {
                colon_byte = Some(byte);
                break;
            }
            _ => {}
        }
        // A label (plus a short timestamp) is short; give up scanning a long
        // line rather than treating an unrelated later colon as one.
        if chars_seen > MAX_LABEL_CHARS + 16 {
            return None;
        }
    }
    let colon_byte = colon_byte?;
    let left = rest[..colon_byte].trim_end();
    let name_part = match (left.rfind('('), left.ends_with(')')) {
        (Some(open), true) => {
            if !valid_timestamp(&left[open + 1..left.len() - 1]) {
                return None;
            }
            &left[..open]
        }
        (None, false) => left,
        // An unmatched or stray paren: not one of the supported forms.
        _ => return None,
    };
    let label = valid_label(name_part)?;
    let mut content_at = start + colon_byte + 1;
    if rest.as_bytes().get(colon_byte + 1) == Some(&b' ') {
        content_at += 1;
    }
    Some((label, content_at))
}

/// Try `[Name]` at the start of `line[start..]`.
fn bracket_label(line: &str, start: usize) -> Option<(String, usize)> {
    let rest = &line[start..];
    if !rest.starts_with('[') {
        return None;
    }
    let mut close_byte = None;
    for (chars_seen, (byte, c)) in rest.char_indices().enumerate().skip(1) {
        if c == ']' {
            close_byte = Some(byte);
            break;
        }
        if chars_seen > MAX_LABEL_CHARS + 4 {
            return None;
        }
    }
    let close_byte = close_byte?;
    let label = valid_label(&rest[1..close_byte])?;
    let mut content_at = start + close_byte + 1;
    if rest.as_bytes().get(close_byte + 1) == Some(&b' ') {
        content_at += 1;
    }
    Some((label, content_at))
}

/// A line's recognized label, if any.
struct LineLabel {
    /// Case- and spacing-normalized: candidates are grouped by this for the
    /// recurrence check.
    key: String,
    /// As it appears on the line (timestamp stripped), for display.
    display: String,
    /// Byte offset into the line where the spoken text starts.
    content_at: usize,
}

fn line_label(line: &str) -> Option<LineLabel> {
    let start = line.len() - line.trim_start().len();
    let (display, content_at) = colon_label(line, start).or_else(|| bracket_label(line, start))?;
    Some(LineLabel {
        key: normalize_key(&display),
        display,
        content_at,
    })
}

/// Byte offset of every code point boundary in `text`, plus one past the
/// end, so a byte offset landing on a char boundary maps to a code point
/// index by binary search (mirrors `db::search::char_boundaries`).
fn char_boundaries(text: &str) -> Vec<usize> {
    let mut v: Vec<usize> = text.char_indices().map(|(i, _)| i).collect();
    v.push(text.len());
    v
}

fn cp_of(boundaries: &[usize], byte: usize) -> i64 {
    boundaries.binary_search(&byte).unwrap_or(0) as i64
}

/// Detect speaker turns in `text`. See the module docs for the recognized
/// label forms and the recurrence rule that keeps this conservative.
pub fn speaker_turns(text: &str) -> Vec<Turn> {
    struct Candidate {
        line_start_byte: usize,
        label: LineLabel,
    }

    let mut candidates: Vec<Candidate> = Vec::new();
    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut byte = 0usize;
    for line in text.split('\n') {
        if let Some(label) = line_label(line) {
            *counts.entry(label.key.clone()).or_insert(0) += 1;
            candidates.push(Candidate {
                line_start_byte: byte,
                label,
            });
        }
        byte += line.len() + 1; // the `\n` this `split` consumed
    }

    let accepted: Vec<&Candidate> = candidates
        .iter()
        .filter(|c| counts.get(&c.label.key).copied().unwrap_or(0) >= 2)
        .collect();
    if accepted.is_empty() {
        return vec![];
    }

    let boundaries = char_boundaries(text);
    let total_cp = cp_len(text);

    accepted
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let content_start = (c.line_start_byte + c.label.content_at).min(text.len());
            let raw_end = accepted
                .get(i + 1)
                .map(|next| next.line_start_byte)
                .unwrap_or(text.len());
            let trimmed_len = text[content_start..raw_end.max(content_start)]
                .trim_end()
                .len();
            let end_byte = content_start + trimmed_len;
            let start_cp = cp_of(&boundaries, content_start);
            let end_cp = cp_of(&boundaries, end_byte).max(start_cp);
            Turn {
                speaker: c.label.display.clone(),
                start: start_cp.min(total_cp),
                end: end_cp.min(total_cp),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// All-ASCII fixtures only, so code point offsets equal byte offsets and
    /// turns can be checked by slicing the source string directly.
    fn slice<'a>(text: &'a str, t: &Turn) -> &'a str {
        &text[t.start as usize..t.end as usize]
    }

    #[test]
    fn detects_recurring_name_colon_turns_and_splits_on_the_next_label() {
        let text =
            "Alice: Hi there.\nBob: Hello Alice.\nAlice: How are you?\nBob: Great, thanks.\n";
        let turns = speaker_turns(text);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].speaker, "Alice");
        assert_eq!(slice(text, &turns[0]), "Hi there.");
        assert_eq!(turns[1].speaker, "Bob");
        assert_eq!(slice(text, &turns[1]), "Hello Alice.");
        assert_eq!(turns[2].speaker, "Alice");
        assert_eq!(slice(text, &turns[2]), "How are you?");
        assert_eq!(turns[3].speaker, "Bob");
        assert_eq!(slice(text, &turns[3]), "Great, thanks.");
    }

    #[test]
    fn all_caps_convention_is_recognized_the_same_way() {
        let text = "ALICE: Hi.\nBOB: Hi back.\nALICE: Again.\nBOB: And again.\n";
        let turns = speaker_turns(text);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].speaker, "ALICE");
        assert_eq!(turns[1].speaker, "BOB");
    }

    #[test]
    fn bracketed_labels_are_recognized() {
        let text = "[Alice] Hi there.\n[Bob] Hello.\n[Alice] Bye.\n[Bob] Bye now.\n";
        let turns = speaker_turns(text);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].speaker, "Alice");
        assert_eq!(slice(text, &turns[0]), "Hi there.");
        assert_eq!(turns[1].speaker, "Bob");
        assert_eq!(slice(text, &turns[1]), "Hello.");
    }

    #[test]
    fn timestamped_labels_group_by_name_ignoring_the_timestamp() {
        let text =
            "Alice (00:12): Hi there.\nBob (00:15): Hello.\nAlice (01:02:03): Bye now.\nBob (01:05): See ya.\n";
        let turns = speaker_turns(text);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].speaker, "Alice");
        assert_eq!(slice(text, &turns[0]), "Hi there.");
        assert_eq!(turns[2].speaker, "Alice");
        assert_eq!(slice(text, &turns[2]), "Bye now.");
    }

    #[test]
    fn a_multi_line_turn_runs_until_the_next_label() {
        let text = "Alice: Hi there.\nStill Alice talking.\n\nBob: One line.\nAlice: Done.\nBob: Also done.\n";
        let turns = speaker_turns(text);
        assert_eq!(turns[0].speaker, "Alice");
        assert_eq!(slice(text, &turns[0]), "Hi there.\nStill Alice talking.");
    }

    #[test]
    fn a_one_off_note_label_does_not_become_a_speaker_and_is_absorbed_as_text() {
        let text = "Alice: Hi there.\nNote: off the record.\nBob: Hello.\nAlice: Again.\nBob: And again.\n";
        let turns = speaker_turns(text);
        assert!(turns.iter().all(|t| t.speaker != "Note"));
        // The stray "Note:" line stays inside Alice's turn as ordinary text.
        assert_eq!(slice(text, &turns[0]), "Hi there.\nNote: off the record.");
    }

    #[test]
    fn a_non_timestamp_parenthetical_is_never_mistaken_for_a_speaker_label() {
        let text = "The result (see notes): stays the same.\nThe result (see notes): still does.\n";
        assert_eq!(speaker_turns(text), vec![]);
    }

    #[test]
    fn a_label_with_too_many_words_or_too_long_is_rejected() {
        let text = "This is definitely not a name: hello.\nThis is definitely not a name: again.\n";
        assert_eq!(speaker_turns(text), vec![]);
    }

    #[test]
    fn documents_with_no_speaker_labels_or_only_singletons_yield_no_turns() {
        assert_eq!(
            speaker_turns("Just plain prose.\nNo labels here.\n"),
            vec![]
        );
        assert_eq!(speaker_turns(""), vec![]);
        // "Alice:" appears only once, so it never recurs.
        assert_eq!(
            speaker_turns("Alice: Hi there.\nJust more prose.\n"),
            vec![]
        );
    }

    #[test]
    fn cjk_names_are_recognized_and_sliced_correctly() {
        let text = "田中: おはよう\n鈴木: こんにちは\n田中: 元気です\n鈴木: よかった\n";
        let turns = speaker_turns(text);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].speaker, "田中");
        assert_eq!(turns[1].speaker, "鈴木");
        // Slice using code point offsets through the shared cp_slice helper,
        // since CJK text is multi-byte (raw string indexing would panic).
        use crate::db::text::cp_slice;
        assert_eq!(
            cp_slice(text, turns[0].start, turns[0].end),
            Some("おはよう")
        );
        assert_eq!(
            cp_slice(text, turns[2].start, turns[2].end),
            Some("元気です")
        );
    }
}
