//! Transcript formats: how a document marks who is speaking.
//!
//! An interview transcript opens each turn with a label — `Alice:`,
//! `[Alice]`, `Alice (00:12):`, `[00:12:03] Alice:`, `00:12 Alice:` — and the
//! spoken text follows it. Misket never edits document text (excerpt offsets
//! are code points into it and must stay valid forever), so the labels stay
//! where they are; what this module does is *find* them, so the document view
//! can lay them out in a gutter and coding can skip over them.
//!
//! A [`TranscriptFormat`] is either one of the built-in [presets](PRESETS), a
//! user-supplied regular expression, or `none` ("this is not a transcript").
//! Every pattern is anchored at the start of a line and has a named capture
//! group `speaker`, optionally also `time`.
//!
//! [`detect_format`] tries every preset and keeps the one that finds the most
//! turns. Detection is deliberately conservative — a candidate label must be
//! short (at most [`MAX_LABEL_WORDS`] words, at most [`MAX_LABEL_CHARS`]
//! characters) and must *recur*, so a document with one stray `Note:` line or
//! a mid-sentence parenthetical is left alone.
//!
//! This is pure text handling; it knows nothing about documents or excerpts.

use std::collections::HashMap;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::db::text::cp_len;
use crate::error::{AppError, Result};

/// One speaker's turn: the label that opens it and the text that follows, up
/// to the next label or the end of the document. Offsets are code points,
/// end-exclusive — the same space excerpts use.
///
/// `[label_start, label_end)` covers the whole label: any leading spaces, the
/// name, the timestamp, the delimiter and the spaces after it, so the view can
/// pull exactly that range out of the running text. `[start, end)` is the
/// spoken text, with trailing whitespace trimmed.
///
/// Doubles as the IPC DTO (camelCase JSON), like `models::SearchHit`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    /// As it appears on the line (original case, timestamp not included).
    pub speaker: String,
    /// The timestamp the label carried, verbatim (`00:12`, `01:02:03`), when
    /// the format has a `time` group and the line filled it in.
    pub time: Option<String>,
    pub label_start: i64,
    pub label_end: i64,
    pub start: i64,
    pub end: i64,
}

/// How a document marks its speaker labels.
///
/// | `kind`   | Means                                                     |
/// | -------- | --------------------------------------------------------- |
/// | `preset` | one of [`PRESETS`], named by `preset`                     |
/// | `regex`  | the user's own `pattern`                                  |
/// | `none`   | not a transcript; [`turns`] finds nothing                 |
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptFormat {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
}

impl TranscriptFormat {
    pub fn none() -> Self {
        Self {
            kind: "none".into(),
            preset: None,
            pattern: None,
        }
    }

    pub fn preset(name: &str) -> Self {
        Self {
            kind: "preset".into(),
            preset: Some(name.into()),
            pattern: None,
        }
    }

    pub fn regex(pattern: &str) -> Self {
        Self {
            kind: "regex".into(),
            preset: None,
            pattern: Some(pattern.into()),
        }
    }

    pub fn is_none(&self) -> bool {
        self.kind == "none"
    }

    /// A short human-readable name for the chip in the document header.
    pub fn label(&self) -> String {
        match self.kind.as_str() {
            "preset" => self
                .preset
                .as_deref()
                .and_then(preset_pattern_and_label)
                .map(|(_, label)| label.to_string())
                .unwrap_or_else(|| "Unknown".into()),
            "regex" => "Custom".into(),
            _ => "None".into(),
        }
    }
}

/// The built-in patterns, in the order [`detect_format`] tries them:
/// `(id, regex, human label)`.
///
/// Each one matches from the start of a line (leading spaces included in the
/// match, so the whole label is one range) and captures `speaker`, plus `time`
/// where the form carries one. A timestamp is `mm:ss` or `hh:mm:ss`; a bare
/// number or a parenthetical like `(see notes)` is not one, which is what
/// keeps ordinary prose out.
pub const PRESETS: [(&str, &str, &str); 5] = [
    (
        "name_colon",
        r"^[ \t]*(?<speaker>[^\s:][^:\n]{0,39}):[ \t]*",
        "Name:",
    ),
    (
        "bracket_name",
        r"^[ \t]*\[(?<speaker>[^\]\n]{1,40})\][ \t]*",
        "[Name]",
    ),
    (
        "name_paren_time",
        r"^[ \t]*(?<speaker>[^(:\n]{1,40}?)[ \t]*\((?<time>\d{1,2}:\d{2}(?::\d{2})?)\)[ \t]*:[ \t]*",
        "Name (00:12):",
    ),
    (
        "bracket_time_name",
        r"^[ \t]*\[(?<time>\d{1,2}:\d{2}(?::\d{2})?)\][ \t]*(?<speaker>[^:\n]{1,40}):[ \t]*",
        "[00:12:03] Name:",
    ),
    (
        "time_name",
        r"^[ \t]*(?<time>\d{1,2}:\d{2}(?::\d{2})?)[ \t]+(?<speaker>[^:\n]{1,40}):[ \t]*",
        "00:12:03 Name:",
    ),
];

fn preset_pattern_and_label(id: &str) -> Option<(&'static str, &'static str)> {
    PRESETS
        .iter()
        .find(|(name, _, _)| *name == id)
        .map(|(_, pattern, label)| (*pattern, *label))
}

/// At most this many characters in a speaker label.
pub const MAX_LABEL_CHARS: usize = 40;
/// At most this many words in a speaker label.
pub const MAX_LABEL_WORDS: usize = 4;
/// A label must open at least this many lines to count as a speaker at all.
const MIN_RECURRENCE: usize = 2;
/// Weak labels (a single letter, or a word documents use as an aside) need
/// this many instead: `Q:`/`A:` is a real transcript convention, `Note:` is
/// usually not, and the difference is how often they come back.
const MIN_WEAK_RECURRENCE: usize = 3;

/// Labels that are far more often an aside than a speaker. They are not
/// rejected — a transcript really can have a speaker called "Note" — they
/// just have to recur [`MIN_WEAK_RECURRENCE`] times rather than twice.
const WEAK_LABELS: [&str; 10] = [
    "note", "notes", "nb", "ps", "source", "example", "warning", "tip", "summary", "see",
];

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

/// Validate and trim a captured speaker: short, wordlike, at least one letter.
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

/// How many times a label has to recur before its lines count as turns.
fn min_recurrence(key: &str) -> usize {
    let single_letter = key.chars().count() == 1;
    if single_letter || WEAK_LABELS.contains(&key) {
        MIN_WEAK_RECURRENCE
    } else {
        MIN_RECURRENCE
    }
}

/// Compile a format into the regex that finds its labels. `none` compiles to
/// nothing; a custom pattern must compile *and* name a `speaker` group, which
/// is the validation the format dialog shows.
pub fn compile(format: &TranscriptFormat) -> Result<Option<Regex>> {
    let pattern = match format.kind.as_str() {
        "none" => return Ok(None),
        "preset" => {
            let id = format.preset.as_deref().unwrap_or_default();
            preset_pattern_and_label(id)
                .map(|(pattern, _)| pattern.to_string())
                .ok_or_else(|| AppError::Validation(format!("unknown transcript preset {id:?}")))?
        }
        "regex" => format
            .pattern
            .clone()
            .filter(|p| !p.trim().is_empty())
            .ok_or_else(|| {
                AppError::Validation("a custom transcript pattern is required".into())
            })?,
        other => return Err(AppError::Validation(format!(
            "unknown transcript format kind {other:?}; expected \"preset\", \"regex\" or \"none\""
        ))),
    };
    let re = Regex::new(&pattern)
        .map_err(|e| AppError::Validation(format!("that pattern does not compile: {e}")))?;
    if !re.capture_names().flatten().any(|n| n == "speaker") {
        return Err(AppError::Validation(
            "the pattern must have a named group (?<speaker>…) for the speaker".into(),
        ));
    }
    Ok(Some(re))
}

/// Byte offset of every code point boundary in `text`, plus one past the end,
/// so a byte offset landing on a char boundary maps to a code point index by
/// binary search (mirrors `db::search::char_boundaries`).
fn char_boundaries(text: &str) -> Vec<usize> {
    let mut v: Vec<usize> = text.char_indices().map(|(i, _)| i).collect();
    v.push(text.len());
    v
}

fn cp_of(boundaries: &[usize], byte: usize) -> i64 {
    boundaries.binary_search(&byte).unwrap_or(0) as i64
}

struct Candidate {
    line_start: usize,
    /// Byte offset just past the whole label match, where the spoken text starts.
    content_at: usize,
    speaker: String,
    time: Option<String>,
    key: String,
}

/// Every line of `text` whose opening matches `re` and looks like a label.
fn candidates(text: &str, re: &Regex) -> Vec<Candidate> {
    let mut out = Vec::new();
    let mut byte = 0usize;
    for line in text.split('\n') {
        // Anchored at the start of the line: a pattern without `^` must still
        // only be believed where it opens the line.
        if let Some(caps) = re
            .captures(line)
            .filter(|c| c.get(0).is_some_and(|m| m.start() == 0))
        {
            let whole = caps.get(0).expect("group 0 always matches");
            let raw = caps.name("speaker").map(|m| m.as_str()).unwrap_or_default();
            if let Some(speaker) = valid_label(raw) {
                // A label that swallowed the whole line but left nothing is
                // still a label; an empty match (a pattern matching "") is not.
                if whole.end() > 0 {
                    out.push(Candidate {
                        line_start: byte,
                        content_at: byte + whole.end(),
                        key: normalize_key(&speaker),
                        speaker,
                        time: caps.name("time").map(|m| m.as_str().to_string()),
                    });
                }
            }
        }
        byte += line.len() + 1; // the `\n` this `split` consumed
    }
    out
}

/// The turns `format` finds in `text`. An unknown preset or a pattern that
/// does not compile yields none rather than an error, so a stored format from
/// a newer build never makes a document unreadable; [`compile`] is what
/// validates a format the user is typing.
pub fn turns(text: &str, format: &TranscriptFormat) -> Vec<Turn> {
    let Ok(Some(re)) = compile(format) else {
        return vec![];
    };
    turns_with(text, &re)
}

fn turns_with(text: &str, re: &Regex) -> Vec<Turn> {
    let all = candidates(text, re);
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for c in &all {
        *counts.entry(c.key.as_str()).or_insert(0) += 1;
    }
    let accepted: Vec<&Candidate> = all
        .iter()
        .filter(|c| counts.get(c.key.as_str()).copied().unwrap_or(0) >= min_recurrence(&c.key))
        .collect();
    if accepted.is_empty() {
        return vec![];
    }

    let boundaries = char_boundaries(text);
    let total_cp = cp_len(text);
    let cp = |byte: usize| cp_of(&boundaries, byte.min(text.len())).min(total_cp);

    accepted
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let content_start = c.content_at.min(text.len());
            let raw_end = accepted
                .get(i + 1)
                .map(|next| next.line_start)
                .unwrap_or(text.len());
            let trimmed_len = text[content_start..raw_end.max(content_start)]
                .trim_end()
                .len();
            let start = cp(content_start);
            Turn {
                speaker: c.speaker.clone(),
                time: c.time.clone(),
                label_start: cp(c.line_start),
                label_end: start,
                start,
                end: cp(content_start + trimmed_len).max(start),
            }
        })
        .collect()
}

/// The speakers `turns` found, in first-seen order, with a turn count each.
pub fn speakers(turns: &[Turn]) -> Vec<(String, i64)> {
    let mut order: Vec<String> = Vec::new();
    let mut counts: HashMap<&str, i64> = HashMap::new();
    for t in turns {
        let n = counts.entry(t.speaker.as_str()).or_insert(0);
        if *n == 0 {
            order.push(t.speaker.clone());
        }
        *n += 1;
    }
    order
        .into_iter()
        .map(|name| {
            let n = counts.get(name.as_str()).copied().unwrap_or(0);
            (name, n)
        })
        .collect()
}

/// Work out which format a document is in: try every preset, keep the one
/// that finds the most turns. Returns the format and a confidence — the share
/// of the document's non-blank lines that open a turn — or `None` when no
/// preset finds anything, which is the honest answer for ordinary prose.
pub fn detect_format(text: &str) -> Option<(TranscriptFormat, f64)> {
    let non_blank = text.lines().filter(|l| !l.trim().is_empty()).count();
    if non_blank == 0 {
        return None;
    }
    let mut best: Option<(TranscriptFormat, usize)> = None;
    for (id, pattern, _) in PRESETS {
        let Ok(re) = Regex::new(pattern) else {
            continue;
        };
        let n = turns_with(text, &re).len();
        if n > 0 && n > best.as_ref().map(|(_, b)| *b).unwrap_or(0) {
            best = Some((TranscriptFormat::preset(id), n));
        }
    }
    let (format, n) = best?;
    let confidence = (n as f64 / non_blank as f64).clamp(0.0, 1.0);
    Some((format, confidence))
}

/// Speaker turns in `text` under whichever format [`detect_format`] picks.
///
/// This is the "just tell me who is speaking" entry point the auto-coding
/// feature uses; a document whose format the user has pinned goes through
/// `db::transcripts` instead, which remembers the answer.
pub fn speaker_turns(text: &str) -> Vec<Turn> {
    match detect_format(text) {
        Some((format, _)) => turns(text, &format),
        None => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::text::cp_slice;

    /// All-ASCII fixtures only, so code point offsets equal byte offsets and
    /// turns can be checked by slicing the source string directly.
    fn slice<'a>(text: &'a str, t: &Turn) -> &'a str {
        &text[t.start as usize..t.end as usize]
    }

    fn label<'a>(text: &'a str, t: &Turn) -> &'a str {
        &text[t.label_start as usize..t.label_end as usize]
    }

    fn detected(text: &str) -> Vec<Turn> {
        speaker_turns(text)
    }

    #[test]
    fn detects_recurring_name_colon_turns_and_splits_on_the_next_label() {
        let text =
            "Alice: Hi there.\nBob: Hello Alice.\nAlice: How are you?\nBob: Great, thanks.\n";
        let (format, confidence) = detect_format(text).unwrap();
        assert_eq!(format, TranscriptFormat::preset("name_colon"));
        assert!((confidence - 1.0).abs() < f64::EPSILON);
        let turns = detected(text);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].speaker, "Alice");
        assert_eq!(label(text, &turns[0]), "Alice: ");
        assert_eq!(slice(text, &turns[0]), "Hi there.");
        assert_eq!(turns[1].speaker, "Bob");
        assert_eq!(slice(text, &turns[1]), "Hello Alice.");
        assert_eq!(turns[3].speaker, "Bob");
        assert_eq!(slice(text, &turns[3]), "Great, thanks.");
        // The label range abuts the spoken text and starts at the line.
        assert_eq!(turns[0].label_start, 0);
        assert_eq!(turns[0].label_end, turns[0].start);
    }

    #[test]
    fn all_caps_convention_is_recognized_the_same_way() {
        let text = "ALICE: Hi.\nBOB: Hi back.\nALICE: Again.\nBOB: And again.\n";
        let turns = detected(text);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].speaker, "ALICE");
        assert_eq!(turns[1].speaker, "BOB");
    }

    #[test]
    fn bracketed_labels_are_recognized() {
        let text = "[Alice] Hi there.\n[Bob] Hello.\n[Alice] Bye.\n[Bob] Bye now.\n";
        let (format, _) = detect_format(text).unwrap();
        assert_eq!(format, TranscriptFormat::preset("bracket_name"));
        let turns = detected(text);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].speaker, "Alice");
        assert_eq!(label(text, &turns[0]), "[Alice] ");
        assert_eq!(slice(text, &turns[0]), "Hi there.");
        assert_eq!(slice(text, &turns[1]), "Hello.");
    }

    #[test]
    fn timestamped_labels_group_by_name_and_keep_the_time() {
        let text =
            "Alice (00:12): Hi there.\nBob (00:15): Hello.\nAlice (01:02:03): Bye now.\nBob (01:05): See ya.\n";
        let (format, _) = detect_format(text).unwrap();
        assert_eq!(format, TranscriptFormat::preset("name_paren_time"));
        let turns = detected(text);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].speaker, "Alice");
        assert_eq!(turns[0].time.as_deref(), Some("00:12"));
        assert_eq!(label(text, &turns[0]), "Alice (00:12): ");
        assert_eq!(slice(text, &turns[0]), "Hi there.");
        // With hours as well as minutes.
        assert_eq!(turns[2].time.as_deref(), Some("01:02:03"));
        assert_eq!(slice(text, &turns[2]), "Bye now.");
    }

    #[test]
    fn a_leading_bracketed_timestamp_is_recognized() {
        let text = "[00:12:03] Alice: Hi there.\n[00:12:40] Bob: Hello.\n[00:13:01] Alice: Bye.\n[00:13:20] Bob: Bye now.\n";
        let (format, _) = detect_format(text).unwrap();
        assert_eq!(format, TranscriptFormat::preset("bracket_time_name"));
        let turns = detected(text);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].speaker, "Alice");
        assert_eq!(turns[0].time.as_deref(), Some("00:12:03"));
        assert_eq!(label(text, &turns[0]), "[00:12:03] Alice: ");
        assert_eq!(slice(text, &turns[0]), "Hi there.");
    }

    #[test]
    fn a_bare_leading_timestamp_is_recognized_with_and_without_hours() {
        let text = "00:12:03 Alice: Hi there.\n12:40 Bob: Hello.\n00:13:01 Alice: Bye.\n13:20 Bob: Bye now.\n";
        let (format, _) = detect_format(text).unwrap();
        assert_eq!(format, TranscriptFormat::preset("time_name"));
        let turns = detected(text);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].time.as_deref(), Some("00:12:03"));
        assert_eq!(turns[1].time.as_deref(), Some("12:40"));
        assert_eq!(turns[1].speaker, "Bob");
        assert_eq!(slice(text, &turns[1]), "Hello.");
    }

    #[test]
    fn a_multi_line_turn_runs_until_the_next_label() {
        let text = "Alice: Hi there.\nStill Alice talking.\n\nBob: One line.\nAlice: Done.\nBob: Also done.\n";
        let turns = detected(text);
        assert_eq!(turns[0].speaker, "Alice");
        assert_eq!(slice(text, &turns[0]), "Hi there.\nStill Alice talking.");
    }

    #[test]
    fn a_one_off_note_label_does_not_become_a_speaker_and_is_absorbed_as_text() {
        let text = "Alice: Hi there.\nNote: off the record.\nBob: Hello.\nAlice: Again.\nBob: And again.\n";
        let turns = detected(text);
        assert!(turns.iter().all(|t| t.speaker != "Note"));
        // The stray "Note:" line stays inside Alice's turn as ordinary text.
        assert_eq!(slice(text, &turns[0]), "Hi there.\nNote: off the record.");
    }

    #[test]
    fn a_recurring_note_label_still_needs_three_occurrences_but_q_and_a_get_in() {
        let twice = "Alice: Hi.\nNote: aside.\nBob: Ho.\nNote: aside.\nAlice: Bye.\nBob: Bye.\n";
        assert!(detected(twice).iter().all(|t| t.speaker != "Note"));
        let thrice = "Alice: Hi.\nNote: a.\nBob: Ho.\nNote: b.\nAlice: Bye.\nNote: c.\nBob: Bye.\n";
        assert!(detected(thrice).iter().any(|t| t.speaker == "Note"));
        // A genuine Q/A transcript: single letters, so three each.
        let qa = "Q: One?\nA: Yes.\nQ: Two?\nA: No.\nQ: Three?\nA: Maybe.\n";
        let turns = detected(qa);
        assert_eq!(turns.len(), 6);
        assert_eq!(turns[0].speaker, "Q");
        // Two each is not enough.
        let short_qa = "Q: One?\nA: Yes.\nQ: Two?\nA: No.\n";
        assert_eq!(detected(short_qa), vec![]);
    }

    #[test]
    fn a_non_timestamp_parenthetical_is_never_mistaken_for_a_speaker_label() {
        let text = "The result (see notes): stays the same.\nThe result (see notes): still does.\n";
        assert_eq!(detected(text), vec![]);
        assert_eq!(detect_format(text), None);
    }

    #[test]
    fn a_label_with_too_many_words_or_too_long_is_rejected() {
        let text = "This is definitely not a name: hello.\nThis is definitely not a name: again.\n";
        assert_eq!(detected(text), vec![]);
    }

    #[test]
    fn documents_with_no_speaker_labels_or_only_singletons_yield_no_turns() {
        assert_eq!(detected("Just plain prose.\nNo labels here.\n"), vec![]);
        assert_eq!(detected(""), vec![]);
        assert_eq!(detect_format(""), None);
        // "Alice:" appears only once, so it never recurs.
        assert_eq!(detected("Alice: Hi there.\nJust more prose.\n"), vec![]);
    }

    #[test]
    fn cjk_names_are_recognized_and_sliced_correctly() {
        let text = "田中: おはよう\n鈴木: こんにちは\n田中: 元気です\n鈴木: よかった\n";
        let turns = detected(text);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].speaker, "田中");
        assert_eq!(turns[1].speaker, "鈴木");
        // Code point offsets, so CJK text slices through the shared helper.
        assert_eq!(
            cp_slice(text, turns[0].start, turns[0].end),
            Some("おはよう")
        );
        assert_eq!(
            cp_slice(text, turns[0].label_start, turns[0].label_end),
            Some("田中: ")
        );
        assert_eq!(
            cp_slice(text, turns[2].start, turns[2].end),
            Some("元気です")
        );
    }

    #[test]
    fn a_custom_pattern_finds_what_no_preset_can() {
        // A double-angle convention no preset knows.
        let text = "<<Alice>> Hi there.\n<<Bob>> Hello.\n<<Alice>> Bye.\n<<Bob>> Bye now.\n";
        assert_eq!(detect_format(text), None);
        let format = TranscriptFormat::regex(r"^<<(?<speaker>[^>\n]{1,40})>>[ \t]*");
        let turns = turns(text, &format);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0].speaker, "Alice");
        assert_eq!(label(text, &turns[0]), "<<Alice>> ");
        assert_eq!(slice(text, &turns[0]), "Hi there.");
        assert_eq!(format.label(), "Custom");
    }

    #[test]
    fn a_custom_pattern_must_compile_and_name_a_speaker_group() {
        assert!(matches!(
            compile(&TranscriptFormat::regex("(unclosed")),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            compile(&TranscriptFormat::regex("^(?<who>.+):")),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            compile(&TranscriptFormat::regex("   ")),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            compile(&TranscriptFormat::preset("no_such_preset")),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            compile(&TranscriptFormat {
                kind: "whatever".into(),
                preset: None,
                pattern: None
            }),
            Err(AppError::Validation(_))
        ));
        assert!(compile(&TranscriptFormat::none()).unwrap().is_none());
        // Every preset compiles and names a speaker group.
        for (id, _, _) in PRESETS {
            assert!(
                compile(&TranscriptFormat::preset(id)).unwrap().is_some(),
                "preset {id}"
            );
        }
    }

    #[test]
    fn the_none_format_finds_nothing_however_speakerlike_the_text_is() {
        let text = "Alice: Hi.\nBob: Ho.\nAlice: Bye.\nBob: Bye.\n";
        assert_eq!(turns(text, &TranscriptFormat::none()), vec![]);
        assert!(TranscriptFormat::none().is_none());
        assert_eq!(TranscriptFormat::none().label(), "None");
        assert_eq!(TranscriptFormat::preset("name_colon").label(), "Name:");
    }

    #[test]
    fn speakers_are_listed_in_first_seen_order_with_counts() {
        let text = "Bob: Ho.\nAlice: Hi.\nBob: Again.\nAlice: Also.\nBob: Last.\n";
        let list = speakers(&detected(text));
        assert_eq!(list, vec![("Bob".to_string(), 3), ("Alice".to_string(), 2)]);
        assert_eq!(speakers(&[]), vec![]);
    }

    #[test]
    fn detection_prefers_the_format_that_finds_the_most_turns() {
        // Two conventions in one file; the timestamped one opens more lines,
        // and `name_colon` cannot read those lines at all (the name would
        // carry a paren), so the timestamped preset wins.
        let text = "Alice (00:01): One.\nBob (00:02): Two.\nAlice (00:03): Three.\nBob: Four.\nAlice: Five.\n";
        let (format, _) = detect_format(text).unwrap();
        assert_eq!(format, TranscriptFormat::preset("name_paren_time"));
    }
}
