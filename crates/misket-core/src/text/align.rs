//! Lining a transcript up with the recording it was typed from.
//!
//! An alignment is a handful of [`Anchor`]s: "code point 412 of this text is
//! heard at 62 300 ms of that recording". Everything else is worked out from
//! them, because nobody is going to anchor every word:
//!
//! - **Between two anchors**, linearly. Speech is not uniform, but over a
//!   cue or a speaker turn it is close enough to put the playhead inside the
//!   right sentence, which is what a coder needs.
//! - **Before the first anchor**, the recording is assumed to start at 0 ms:
//!   the segment from `(0, 0)` to the first anchor is interpolated like any
//!   other. A transcript's preamble therefore maps into the opening seconds
//!   rather than nowhere.
//! - **After the last anchor**, at the document's average rate — the
//!   milliseconds per code point the anchored part of the document ran at,
//!   i.e. `last.ms / last.pos`. With no anchor past the halfway mark that is
//!   a guess, but a monotone one, and it is what makes "play this excerpt"
//!   work at the tail of a transcript whose timestamps stop early.
//!
//! Both directions are total functions of the anchor list: with no anchors at
//! all everything is at 0 ms, and with no anchor of its own position 0 is at
//! 0 ms. An anchor *at* position 0 is allowed and wins — a subtitle file whose
//! first cue starts thirty seconds in says so.
//!
//! The mapping is kept **monotone**. Anchors arrive sorted by position (they
//! are a primary key on `(document_id, pos)`), but a hand-set anchor can
//! still name a time earlier than the one before it; [`prepare`] clamps such
//! an anchor up to its predecessor rather than letting the transcript run
//! backwards, so [`ms_to_pos`] has exactly one answer.
//!
//! This module is pure: it knows nothing about documents, excerpts or the
//! database. `db::align` stores anchors and calls in here.

use serde::{Deserialize, Serialize};

/// One point where the text and the recording are known to meet: a code point
/// offset into the document and a millisecond of the recording.
///
/// Doubles as the IPC DTO (camelCase JSON), like [`super::transcript::Turn`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    /// Code point offset into the document text.
    pub pos: i64,
    /// Milliseconds into the recording.
    pub ms: i64,
}

impl Anchor {
    pub fn new(pos: i64, ms: i64) -> Self {
        Self { pos, ms }
    }
}

/// Sort by position, drop duplicates and anything before the text, and clamp
/// times
/// so they never run backwards. The result is what both mappings read.
///
/// Exposed because the storage layer normalizes the same way before writing:
/// an anchor list that has been through here reads back unchanged.
pub fn prepare(anchors: &[Anchor]) -> Vec<Anchor> {
    let mut out: Vec<Anchor> = anchors
        .iter()
        .copied()
        .filter(|a| a.pos >= 0 && a.ms >= 0)
        .collect();
    out.sort_by_key(|a| a.pos);
    out.dedup_by_key(|a| a.pos);
    let mut floor = 0;
    for a in out.iter_mut() {
        a.ms = a.ms.max(floor);
        floor = a.ms;
    }
    out
}

/// Milliseconds per code point past the last anchor: the average rate of the
/// anchored part of the document. Zero when nothing is anchored.
fn tail_rate(prepared: &[Anchor]) -> f64 {
    match prepared.last() {
        Some(last) if last.pos > 0 => last.ms as f64 / last.pos as f64,
        _ => 0.0,
    }
}

/// Where in the recording the text at `pos` is heard, in milliseconds.
///
/// `anchors` need not be sorted; see [`prepare`].
pub fn pos_to_ms(anchors: &[Anchor], pos: i64) -> i64 {
    let a = prepare(anchors);
    let pos = pos.max(0);
    if a.is_empty() {
        return 0;
    }
    let mut prev = Anchor::new(0, 0);
    for next in &a {
        if pos <= next.pos {
            let span = next.pos - prev.pos;
            if span <= 0 {
                return next.ms;
            }
            let t = (pos - prev.pos) as f64 / span as f64;
            return prev.ms + (t * (next.ms - prev.ms) as f64).round() as i64;
        }
        prev = *next;
    }
    prev.ms + ((pos - prev.pos) as f64 * tail_rate(&a)).round() as i64
}

/// Where in the text the recording is at `ms`, as a code point offset.
///
/// The inverse of [`pos_to_ms`] wherever the mapping is strictly increasing.
/// Across a flat stretch (two anchors at the same millisecond, which a pause
/// in the recording produces) it answers with the *start* of that stretch, so
/// a playhead sitting in the pause highlights the passage about to be read
/// rather than the one just finished.
pub fn ms_to_pos(anchors: &[Anchor], ms: i64) -> i64 {
    let a = prepare(anchors);
    let ms = ms.max(0);
    if a.is_empty() {
        return 0;
    }
    let mut prev = Anchor::new(0, 0);
    for next in &a {
        if ms <= next.ms {
            let span = next.ms - prev.ms;
            if span <= 0 {
                return prev.pos;
            }
            let t = (ms - prev.ms) as f64 / span as f64;
            return prev.pos + (t * (next.pos - prev.pos) as f64).round() as i64;
        }
        prev = *next;
    }
    let rate = tail_rate(&a);
    if rate <= 0.0 {
        return prev.pos;
    }
    prev.pos + ((ms - prev.ms) as f64 / rate).round() as i64
}

/// Parse a transcript timestamp into milliseconds.
///
/// Takes what a speaker label or a subtitle cue actually carries: `mm:ss`,
/// `h:mm:ss`, either with a `.mmm` or `,mmm` fraction, optionally wrapped in
/// `[…]` or `(…)` and surrounded by spaces. Returns `None` for anything else,
/// so a format whose `time` group caught something that is not a clock simply
/// contributes no anchor.
pub fn parse_time_ms(raw: &str) -> Option<i64> {
    let t = raw.trim();
    let t = t
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .or_else(|| t.strip_prefix('(').and_then(|s| s.strip_suffix(')')))
        .or_else(|| t.strip_prefix('<').and_then(|s| s.strip_suffix('>')))
        .unwrap_or(t)
        .trim();
    if t.is_empty() {
        return None;
    }
    // The fractional part, if any: `.5`, `.25`, `.250` and `,250` all mean
    // what they read as.
    let (clock, fraction) = match t.find(['.', ',']) {
        Some(i) => (&t[..i], Some(&t[i + 1..])),
        None => (t, None),
    };
    let millis = match fraction {
        None => 0,
        Some(f) => {
            if f.is_empty() || !f.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            let digits: String = f.chars().take(3).collect();
            let scale = 10i64.pow(3 - digits.len() as u32);
            digits.parse::<i64>().ok()? * scale
        }
    };

    let parts: Vec<&str> = clock.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let mut seconds: i64 = 0;
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() || !part.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        // Only the leading field may exceed two digits (a 100-minute tape).
        if i > 0 && part.len() != 2 {
            return None;
        }
        let value: i64 = part.parse().ok()?;
        if i > 0 && value > 59 {
            return None;
        }
        seconds = seconds * 60 + value;
    }
    Some(seconds * 1000 + millis)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anchors(pairs: &[(i64, i64)]) -> Vec<Anchor> {
        pairs.iter().map(|&(p, m)| Anchor::new(p, m)).collect()
    }

    #[test]
    fn with_no_anchors_everything_is_at_the_start() {
        assert_eq!(pos_to_ms(&[], 0), 0);
        assert_eq!(pos_to_ms(&[], 5_000), 0);
        assert_eq!(ms_to_pos(&[], 0), 0);
        assert_eq!(ms_to_pos(&[], 90_000), 0);
    }

    #[test]
    fn interpolates_linearly_between_anchors() {
        let a = anchors(&[(100, 10_000), (200, 30_000)]);
        assert_eq!(pos_to_ms(&a, 100), 10_000);
        assert_eq!(pos_to_ms(&a, 200), 30_000);
        assert_eq!(pos_to_ms(&a, 150), 20_000);
        assert_eq!(pos_to_ms(&a, 125), 15_000);
        // And back again.
        assert_eq!(ms_to_pos(&a, 20_000), 150);
        assert_eq!(ms_to_pos(&a, 15_000), 125);
        assert_eq!(ms_to_pos(&a, 30_000), 200);
    }

    #[test]
    fn before_the_first_anchor_the_recording_starts_at_zero() {
        let a = anchors(&[(100, 10_000)]);
        assert_eq!(pos_to_ms(&a, 0), 0);
        assert_eq!(pos_to_ms(&a, 50), 5_000);
        assert_eq!(ms_to_pos(&a, 0), 0);
        assert_eq!(ms_to_pos(&a, 5_000), 50);
        // A negative position is simply the start.
        assert_eq!(pos_to_ms(&a, -20), 0);
        assert_eq!(ms_to_pos(&a, -20), 0);
    }

    #[test]
    fn past_the_last_anchor_it_carries_on_at_the_average_rate() {
        // 200 code points in 40 s: 200 ms per code point.
        let a = anchors(&[(100, 10_000), (200, 40_000)]);
        assert_eq!(pos_to_ms(&a, 300), 40_000 + 100 * 200);
        assert_eq!(ms_to_pos(&a, 60_000), 300);
        // Round trip at an arbitrary point past the end.
        let ms = pos_to_ms(&a, 517);
        assert_eq!(ms_to_pos(&a, ms), 517);
    }

    #[test]
    fn a_round_trip_through_both_directions_lands_where_it_started() {
        let a = anchors(&[(40, 2_000), (120, 9_500), (400, 61_000)]);
        for pos in [0, 1, 39, 40, 41, 119, 120, 260, 399, 400, 401, 900] {
            let ms = pos_to_ms(&a, pos);
            let back = ms_to_pos(&a, ms);
            // Rounding to whole milliseconds can shift a position by one.
            assert!(
                (back - pos).abs() <= 1,
                "pos {pos} -> {ms} ms -> {back} should come back to itself"
            );
        }
    }

    #[test]
    fn anchors_are_sorted_deduplicated_and_never_run_backwards() {
        let messy = anchors(&[(200, 30_000), (100, 10_000), (150, 5_000), (-3, 1)]);
        let a = prepare(&messy);
        assert_eq!(a, anchors(&[(100, 10_000), (150, 10_000), (200, 30_000)]));
        // Preparing twice changes nothing.
        assert_eq!(prepare(&a), a);
        // The mapping stays monotone across the clamped anchor.
        assert!(pos_to_ms(&messy, 120) <= pos_to_ms(&messy, 160));
    }

    #[test]
    fn a_pause_answers_with_the_passage_about_to_be_read() {
        // Nothing is said between code points 100 and 160.
        let a = anchors(&[(100, 10_000), (160, 10_000), (200, 14_000)]);
        assert_eq!(pos_to_ms(&a, 130), 10_000);
        assert_eq!(ms_to_pos(&a, 10_000), 100);
        assert_eq!(ms_to_pos(&a, 12_000), 180);
    }

    #[test]
    fn an_anchor_at_the_very_start_pushes_the_whole_document_back() {
        // A subtitle file whose first cue begins half a minute in.
        let a = anchors(&[(0, 30_000), (100, 40_000)]);
        assert_eq!(pos_to_ms(&a, 0), 30_000);
        assert_eq!(pos_to_ms(&a, 50), 35_000);
        assert_eq!(ms_to_pos(&a, 30_000), 0);
        assert_eq!(ms_to_pos(&a, 0), 0);
        assert_eq!(ms_to_pos(&a, 35_000), 50);
    }

    #[test]
    fn parses_the_timestamp_shapes_transcripts_use() {
        assert_eq!(parse_time_ms("0:05"), Some(5_000));
        assert_eq!(parse_time_ms("12:34"), Some(754_000));
        assert_eq!(parse_time_ms("1:02:03"), Some(3_723_000));
        assert_eq!(parse_time_ms("01:02:03"), Some(3_723_000));
        assert_eq!(parse_time_ms("00:01.250"), Some(1_250));
        assert_eq!(parse_time_ms("00:01,250"), Some(1_250));
        assert_eq!(parse_time_ms("00:01.5"), Some(1_500));
        assert_eq!(parse_time_ms(" [12:34] "), Some(754_000));
        assert_eq!(parse_time_ms("(1:02:03)"), Some(3_723_000));
        assert_eq!(parse_time_ms("<00:00:02.000>"), Some(2_000));
        // A 100-minute tape with no hours field.
        assert_eq!(parse_time_ms("124:00"), Some(7_440_000));
    }

    #[test]
    fn refuses_anything_that_is_not_a_clock() {
        for bad in [
            "", "12", "12:3", "12:345", "ten", "1:2:3:4", "12:60", "1:99:00", "12:ab", "12:34.",
            "12:34.x", "-1:00", "[12:34)",
        ] {
            assert_eq!(parse_time_ms(bad), None, "{bad:?} should not parse");
        }
    }
}
