//! Turning Whisper's segments into a Misket text document.
//!
//! The document is plain text, one paragraph per segment (or per N seconds of
//! recording), each opening with `[mm:ss]` — the shape a person would type a
//! transcript in, and one the timestamp-aware transcript presets in
//! `misket_core::text::transcript` can read.
//!
//! Alongside the text, each paragraph produces an **anchor**: the code-point
//! offset where the paragraph starts, and the millisecond into the recording
//! it was spoken at. That is what transcript alignment (roadmap 18) needs to
//! seek the player from a position in the text. Until the column that stores
//! anchors lands, they are still computed and handed back — nothing here
//! depends on where they end up.

use serde::{Deserialize, Serialize};

/// One stretch of speech as Whisper reports it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

/// Where a position in the transcript sits in the recording.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    /// Code-point offset into the transcript text, like every other offset in
    /// Misket.
    pub pos: i64,
    /// Milliseconds into the recording.
    pub ms: i64,
}

/// A finished transcript: the document text, its anchors, and the speakers —
/// which is always `None`, because Whisper does not do diarisation and
/// guessing speakers from pauses would be a lie dressed up as data. The field
/// exists so that a real diarisation engine could fill it in later without
/// changing this type's shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub text: String,
    pub anchors: Vec<Anchor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub speakers: Option<Vec<String>>,
}

/// How the segments are laid out as paragraphs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    /// Open every paragraph with `[mm:ss]`. Off gives running prose with
    /// anchors still recorded.
    pub timestamps: bool,
    /// `None` is one paragraph per segment; `Some(n)` merges consecutive
    /// segments until the paragraph covers at least `n` seconds.
    pub group_seconds: Option<i64>,
}

impl Default for Layout {
    fn default() -> Self {
        Layout {
            timestamps: true,
            group_seconds: None,
        }
    }
}

/// `[mm:ss]`, or `[h:mm:ss]` once the recording passes an hour.
pub fn timecode(ms: i64) -> String {
    let total = (ms.max(0)) / 1000;
    let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

/// Render `segments` into document text plus anchors.
///
/// Whisper puts a leading space on nearly every segment and sometimes emits a
/// segment that is only whitespace or a lone `[BLANK_AUDIO]`-style marker;
/// both are dropped rather than becoming empty paragraphs.
pub fn render(segments: &[Segment], layout: Layout) -> TranscriptionResult {
    let mut text = String::new();
    let mut anchors: Vec<Anchor> = Vec::new();
    let mut pos: i64 = 0;

    for para in paragraphs(segments, layout.group_seconds) {
        if !text.is_empty() {
            text.push_str("\n\n");
            pos += 2;
        }
        anchors.push(Anchor {
            pos,
            ms: para.start_ms,
        });
        let body = if layout.timestamps {
            format!("[{}] {}", timecode(para.start_ms), para.text)
        } else {
            para.text
        };
        // Normalized here rather than at import so the anchors are counted
        // against exactly the text `documents::create` will store.
        let body = misket_core::db::text::normalize(&body);
        pos += misket_core::db::text::cp_len(&body);
        text.push_str(&body);
    }
    TranscriptionResult {
        text,
        anchors,
        speakers: None,
    }
}

/// Group segments into the paragraphs [`render`] writes.
fn paragraphs(segments: &[Segment], group_seconds: Option<i64>) -> Vec<Segment> {
    let group_ms = group_seconds.filter(|n| *n > 0).map(|n| n * 1000);
    let mut out: Vec<Segment> = Vec::new();
    for seg in segments {
        let body = clean(&seg.text);
        if body.is_empty() {
            continue;
        }
        match (group_ms, out.last_mut()) {
            // Keep filling the open paragraph until it already covers the
            // window; the segment that tips it over closes it.
            (Some(limit), Some(last)) if last.end_ms - last.start_ms < limit => {
                last.text.push(' ');
                last.text.push_str(&body);
                last.end_ms = seg.end_ms;
            }
            _ => out.push(Segment {
                start_ms: seg.start_ms,
                end_ms: seg.end_ms,
                text: body,
            }),
        }
    }
    out
}

/// Whisper's non-speech markers, which are noise in a transcript document.
const MARKERS: [&str; 6] = [
    "[BLANK_AUDIO]",
    "[SILENCE]",
    "(silence)",
    "[ Silence ]",
    "[MUSIC]",
    "[Music]",
];

/// Trim a segment down to what belongs in the document: no leading space, no
/// internal newlines, and nothing if all it holds is a non-speech marker.
fn clean(raw: &str) -> String {
    let collapsed = raw.replace(['\n', '\r'], " ");
    let trimmed = collapsed.split_whitespace().collect::<Vec<_>>().join(" ");
    if MARKERS.iter().any(|m| m.eq_ignore_ascii_case(&trimmed)) {
        return String::new();
    }
    trimmed
}

/// The name a transcript document gets: `<recording> (transcript)`.
///
/// Imported recordings are already named without their file extension
/// (`src/core/importers`), so there is nothing to strip here — only the
/// suffix to avoid stacking when a recording is transcribed twice.
pub fn transcript_name(recording: &str) -> String {
    let base = recording.trim();
    if base.to_lowercase().ends_with("(transcript)") {
        base.to_string()
    } else {
        format!("{base} (transcript)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start_ms: i64, end_ms: i64, text: &str) -> Segment {
        Segment {
            start_ms,
            end_ms,
            text: text.into(),
        }
    }

    #[test]
    fn timecodes_roll_over_into_hours() {
        assert_eq!(timecode(0), "00:00");
        assert_eq!(timecode(1_500), "00:01");
        assert_eq!(timecode(62_000), "01:02");
        assert_eq!(timecode(3_723_000), "1:02:03");
        assert_eq!(timecode(-5), "00:00");
    }

    #[test]
    fn one_paragraph_per_segment_with_anchors_at_the_bracket() {
        let out = render(
            &[
                seg(0, 2_000, " Hello there."),
                seg(2_000, 5_400, " This is the second bit."),
            ],
            Layout::default(),
        );
        assert_eq!(
            out.text,
            "[00:00] Hello there.\n\n[00:02] This is the second bit."
        );
        assert_eq!(
            out.anchors,
            vec![Anchor { pos: 0, ms: 0 }, Anchor { pos: 22, ms: 2_000 }]
        );
        // Every anchor must land exactly on the "[" that opens its paragraph.
        let chars: Vec<char> = out.text.chars().collect();
        for a in &out.anchors {
            assert_eq!(chars[a.pos as usize], '[');
        }
        assert_eq!(out.speakers, None, "transcription never invents speakers");
    }

    #[test]
    fn grouping_merges_segments_until_the_window_is_full() {
        let segs = [
            seg(0, 4_000, "One."),
            seg(4_000, 9_000, "Two."),
            seg(9_000, 14_000, "Three."),
            seg(14_000, 20_000, "Four."),
        ];
        let out = render(
            &segs,
            Layout {
                timestamps: true,
                group_seconds: Some(10),
            },
        );
        assert_eq!(out.text, "[00:00] One. Two. Three.\n\n[00:14] Four.");
        assert_eq!(out.anchors.len(), 2);
        assert_eq!(out.anchors[1].ms, 14_000);
    }

    #[test]
    fn timestamps_can_be_left_off_without_losing_anchors() {
        let out = render(
            &[seg(0, 1_000, "One."), seg(1_000, 2_000, "Two.")],
            Layout {
                timestamps: false,
                group_seconds: None,
            },
        );
        assert_eq!(out.text, "One.\n\nTwo.");
        assert_eq!(
            out.anchors,
            vec![Anchor { pos: 0, ms: 0 }, Anchor { pos: 6, ms: 1_000 }]
        );
    }

    #[test]
    fn blank_and_marker_segments_do_not_become_paragraphs() {
        let out = render(
            &[
                seg(0, 1_000, "  "),
                seg(1_000, 2_000, "[BLANK_AUDIO]"),
                seg(2_000, 3_000, " Real\nspeech  here "),
            ],
            Layout::default(),
        );
        assert_eq!(out.text, "[00:02] Real speech here");
        assert_eq!(out.anchors, vec![Anchor { pos: 0, ms: 2_000 }]);
    }

    #[test]
    fn nothing_at_all_renders_as_nothing_at_all() {
        let out = render(&[], Layout::default());
        assert!(out.text.is_empty());
        assert!(out.anchors.is_empty());
    }

    #[test]
    fn anchors_are_counted_in_code_points_not_bytes() {
        let out = render(
            &[
                seg(0, 1_000, "Görüşme başladı."),
                seg(1_000, 2_000, "Evet."),
            ],
            Layout::default(),
        );
        let chars: Vec<char> = out.text.chars().collect();
        for a in &out.anchors {
            assert_eq!(chars[a.pos as usize], '[');
        }
        assert!(out.anchors[1].pos < out.text.len() as i64, "bytes > chars");
    }

    #[test]
    fn transcript_names_follow_the_recording() {
        assert_eq!(transcript_name("Interview 3"), "Interview 3 (transcript)");
        assert_eq!(transcript_name("  talk  "), "talk (transcript)");
        assert_eq!(
            transcript_name("talk (transcript)"),
            "talk (transcript)",
            "re-transcribing must not stack suffixes"
        );
    }
}
