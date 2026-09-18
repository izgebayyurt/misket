//! Linking a transcript to its recording, and the anchors that align them.
//!
//! Two pieces of state:
//!
//! - `documents.linked_media_id` — a text document points at the recording it
//!   is the transcript of. One link, set and cleared from the document row or
//!   the inspector, undoable as `document.linked`.
//! - `transcript_anchors` — `(document_id, pos) -> ms`, the points where the
//!   two are known to meet. [`crate::text::align`] interpolates everything in
//!   between; this module only stores them.
//!
//! Anchors reach the table three ways: an SRT/VTT import brings one per cue
//! (through [`crate::models::NewDocument::anchors`]), [`build_from_timestamps`]
//! reads the timestamps a transcript format already captured, and
//! ["Align here"](set) drops one at the caret while the recording plays.
//!
//! Every write here is undoable, and every one of them records the document's
//! *whole* anchor list on both sides ([`history::AnchorChange`]): an anchor
//! list is a few hundred small pairs at most, and replacing it wholesale is
//! an exact inverse for setting one, removing one and rebuilding all of them
//! alike.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;

use super::history::{AnchorChange, DocumentOp};
use super::{activity, documents, excerpts, history, transcripts, util};
use crate::error::{AppError, Result};
use crate::models::{ApplyCodesInput, ApplyResult, DocumentSummary};
use crate::text::align::{self, Anchor};

/// The anchors stored for a document, earliest first.
pub fn list(conn: &Connection, document_id: &str) -> Result<Vec<Anchor>> {
    let mut stmt =
        conn.prepare("SELECT pos, ms FROM transcript_anchors WHERE document_id = ?1 ORDER BY pos")?;
    let rows = stmt.query_map([document_id], |r| {
        Ok(Anchor {
            pos: r.get(0)?,
            ms: r.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Replace a document's anchors without touching the history.
///
/// The raw write every recorded operation is built out of, and the one an
/// import and an undo replay use directly.
pub(super) fn write(conn: &Connection, document_id: &str, anchors: &[Anchor]) -> Result<()> {
    conn.execute(
        "DELETE FROM transcript_anchors WHERE document_id = ?1",
        [document_id],
    )?;
    for a in align::prepare(anchors) {
        conn.execute(
            "INSERT OR REPLACE INTO transcript_anchors (document_id, pos, ms) VALUES (?1, ?2, ?3)",
            params![document_id, a.pos, a.ms],
        )?;
    }
    Ok(())
}

/// The text document `id`, with its length — or a clear refusal.
fn text_document(conn: &Connection, id: &str) -> Result<(DocumentSummary, i64)> {
    let doc = documents::get_summary(conn, id)?;
    if doc.kind != "text" {
        return Err(AppError::Validation(format!(
            "{:?} is not a text document, so it cannot be aligned to a recording",
            doc.name
        )));
    }
    Ok((doc, doc_len(conn, id)?))
}

fn doc_len(conn: &Connection, id: &str) -> Result<i64> {
    Ok(documents::get_text(conn, id)
        .map(|(_, len)| len)
        .unwrap_or(0))
}

/// Record a change to `document_id`'s anchors, from `before` to `after`.
fn record(
    conn: &Connection,
    document_id: &str,
    kind: &str,
    summary: String,
    before: Vec<Anchor>,
    after: Vec<Anchor>,
) -> Result<Vec<Anchor>> {
    let tx = util::tx(conn)?;
    write(&tx, document_id, &after)?;
    activity::record(
        &tx,
        kind,
        "document",
        Some(document_id),
        summary,
        json!({
            "anchors": activity::change(before.len() as i64, after.len() as i64),
        }),
        Some(history::payload(&AnchorChange {
            document_id: document_id.to_string(),
            anchors: after.clone(),
        })),
        Some(history::payload(&AnchorChange {
            document_id: document_id.to_string(),
            anchors: before,
        })),
    )?;
    tx.commit()?;
    list(conn, document_id)
}

/// "Align here": the text at `pos` is heard at `ms` of the recording.
///
/// An anchor already at that position is moved rather than doubled — the
/// primary key says so, and a coder pressing the key twice means the second
/// answer.
pub fn set(conn: &Connection, document_id: &str, pos: i64, ms: i64) -> Result<Vec<Anchor>> {
    let (doc, len) = text_document(conn, document_id)?;
    if pos <= 0 || pos > len {
        return Err(AppError::Validation(format!(
            "position {pos} is outside {:?} (length {len}); the start of a document is always 0 ms",
            doc.name
        )));
    }
    if ms < 0 {
        return Err(AppError::Validation(
            "an anchor cannot be before the start of the recording".into(),
        ));
    }
    let before = list(conn, document_id)?;
    let mut after: Vec<Anchor> = before.iter().copied().filter(|a| a.pos != pos).collect();
    after.push(Anchor::new(pos, ms));
    record(
        conn,
        document_id,
        "transcript.anchor_set",
        format!(
            "Aligned \"{}\" at {} with {}",
            doc.name,
            pos,
            super::media::timecode(ms)
        ),
        before,
        after,
    )
}

/// Forget the anchor at `pos`.
pub fn remove(conn: &Connection, document_id: &str, pos: i64) -> Result<Vec<Anchor>> {
    let (doc, _) = text_document(conn, document_id)?;
    let before = list(conn, document_id)?;
    if !before.iter().any(|a| a.pos == pos) {
        return Ok(before);
    }
    let after: Vec<Anchor> = before.iter().copied().filter(|a| a.pos != pos).collect();
    record(
        conn,
        document_id,
        "transcript.anchor_removed",
        format!("Removed the alignment point at {pos} in \"{}\"", doc.name),
        before,
        after,
    )
}

/// Replace every anchor at once (the SRT importer's "re-read the cues", and
/// what the frontend calls to clear an alignment).
pub fn set_all(conn: &Connection, document_id: &str, anchors: &[Anchor]) -> Result<Vec<Anchor>> {
    let (doc, len) = text_document(conn, document_id)?;
    let before = list(conn, document_id)?;
    let after: Vec<Anchor> = align::prepare(anchors)
        .into_iter()
        .filter(|a| a.pos <= len)
        .collect();
    if after == before {
        return Ok(before);
    }
    record(
        conn,
        document_id,
        "transcript.anchors_built",
        format!(
            "Set {} alignment point{} in \"{}\"",
            after.len(),
            if after.len() == 1 { "" } else { "s" },
            doc.name
        ),
        before,
        after,
    )
}

/// Build anchors from the timestamps the document's transcript format already
/// captures: every turn whose `time` group parses becomes one anchor at the
/// start of what was said.
///
/// The anchor goes on the *spoken* text rather than the label, so clicking
/// the first word of a turn seeks to the moment it is said — and so an anchor
/// never sits inside a label the gutter has taken out of flow.
pub fn build_from_timestamps(conn: &Connection, document_id: &str) -> Result<Vec<Anchor>> {
    let (doc, _) = text_document(conn, document_id)?;
    let info = transcripts::get(conn, document_id)?;
    let anchors: Vec<Anchor> = info
        .turns
        .iter()
        .filter_map(|t| {
            let ms = align::parse_time_ms(t.time.as_deref()?)?;
            Some(Anchor::new(t.start, ms))
        })
        .collect();
    if anchors.is_empty() {
        return Err(AppError::Validation(format!(
            "no turn in \"{}\" carries a timestamp this format captures; pick a format with a time in its label, or align by hand",
            doc.name
        )));
    }
    set_all(conn, document_id, &anchors)
}

// ----------------------------------------------------------------- linking

/// Point a text document at the recording it transcribes, or (with `None`)
/// unlink it. Undoable as `document.linked`.
pub fn link(
    conn: &Connection,
    document_id: &str,
    media_id: Option<&str>,
) -> Result<DocumentSummary> {
    let before = documents::get_summary(conn, document_id)?;
    if before.kind != "text" {
        return Err(AppError::Validation(format!(
            "{:?} is not a text document; a recording is linked *from* its transcript",
            before.name
        )));
    }
    let media_name = match media_id {
        Some(id) => {
            if id == document_id {
                return Err(AppError::Validation(
                    "a document cannot be its own recording".into(),
                ));
            }
            let media = documents::get_summary(conn, id)?;
            if media.kind != documents::MEDIA_KIND {
                return Err(AppError::Validation(format!(
                    "{:?} is not an audio or video document",
                    media.name
                )));
            }
            Some(media.name)
        }
        None => None,
    };
    if before.linked_media_id.as_deref() == media_id {
        return Ok(before);
    }
    let now = util::now();
    let tx = util::tx(conn)?;
    tx.execute(
        "UPDATE documents SET linked_media_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![document_id, media_id, now],
    )?;
    activity::record(
        &tx,
        "document.linked",
        "document",
        Some(document_id),
        match &media_name {
            Some(name) => format!("Linked \"{}\" to the recording \"{name}\"", before.name),
            None => format!("Unlinked \"{}\" from its recording", before.name),
        },
        json!({
            "linkedMediaId": activity::change(
                before.linked_media_id.clone(),
                media_id.map(str::to_string),
            ),
        }),
        Some(history::payload(&DocumentOp::Link {
            document_id: document_id.to_string(),
            linked_media_id: media_id.map(str::to_string),
            updated_at: now,
        })),
        Some(history::payload(&DocumentOp::Link {
            document_id: document_id.to_string(),
            linked_media_id: before.linked_media_id.clone(),
            updated_at: before.updated_at.clone(),
        })),
    )?;
    tx.commit()?;
    documents::get_summary(conn, document_id)
}

/// The text documents that point at `media_id`, so a deleted recording's
/// snapshot can put their links back.
pub(super) fn linked_by(conn: &Connection, media_id: &str) -> Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT id FROM documents WHERE linked_media_id = ?1 ORDER BY id")?;
    let rows = stmt.query_map([media_id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

// ------------------------------------------------------- coding across both

/// Code the stretch of the recording a text excerpt was spoken in, with the
/// same codes the excerpt carries.
///
/// One undoable group: the `video_range` excerpt on the linked recording and
/// the codes on it go back together.
pub fn code_recording_for_excerpt(conn: &Connection, excerpt_id: &str) -> Result<ApplyResult> {
    let (document_id, kind, start, end): (String, String, Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT document_id, kind, start_pos, end_pos FROM excerpts WHERE id = ?1",
            [excerpt_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("excerpt {excerpt_id} not found")))?;
    if kind != "text" {
        return Err(AppError::Validation(
            "only a passage of a transcript can be traced back to the recording".into(),
        ));
    }
    let (Some(start), Some(end)) = (start, end) else {
        return Err(AppError::Validation("this excerpt has no range".into()));
    };
    let doc = documents::get_summary(conn, &document_id)?;
    let media_id = doc.linked_media_id.clone().ok_or_else(|| {
        AppError::Validation(format!("\"{}\" is not linked to a recording yet", doc.name))
    })?;
    let anchors = list(conn, &document_id)?;
    if anchors.is_empty() {
        return Err(AppError::Validation(format!(
            "\"{}\" has no alignment points yet, so Misket does not know when this passage was said",
            doc.name
        )));
    }
    let start_ms = align::pos_to_ms(&anchors, start);
    let end_ms = align::pos_to_ms(&anchors, end).max(start_ms + 1);
    let code_ids = excerpts::get(conn, excerpt_id)?.code_ids;
    history::group(conn, "Coded the recording for a passage", |conn| {
        excerpts::apply_codes(
            conn,
            ApplyCodesInput {
                document_id: media_id.clone(),
                kind: Some("video_range".into()),
                start_pos: Some(start_ms),
                end_pos: Some(end_ms),
                code_ids: code_ids.clone(),
                ..Default::default()
            },
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::documents::tests::new_doc;
    use crate::db::{codes, history, media, OpenProject};
    use crate::models::{NewCode, NewMediaDocument};
    use crate::text::TranscriptFormat;

    /// A recording on disk, so `media::create` can fingerprint it.
    pub(crate) fn media_doc(p: &OpenProject, dir: &std::path::Path, name: &str) -> String {
        let path = dir.join(format!("{name}.wav"));
        std::fs::write(&path, format!("RIFF fake wav for {name}")).unwrap();
        media::create(
            &p.conn,
            None,
            NewMediaDocument {
                name: name.into(),
                source_path: path.to_string_lossy().into_owned(),
                mime: "audio/wav".into(),
                media: crate::models::MediaInfo {
                    duration_ms: Some(120_000),
                    ..Default::default()
                },
                copy_into_project: false,
                allow_duplicate: false,
            },
        )
        .unwrap()
        .summary
        .id
    }

    /// Four turns, two each, because a speaker has to recur before
    /// `text::transcript` believes in them.
    const TIMED: &str = "[00:05] Alice: Hello there.\n[00:20] Bob: Hello back.\n\
                         [01:00] Alice: Goodbye.\n[01:30] Bob: Bye now.\n";

    #[test]
    fn anchors_round_trip_through_the_table() {
        let p = OpenProject::in_memory("t").unwrap();
        let d = documents::create(&p.conn, new_doc("one two three four five"))
            .unwrap()
            .summary
            .id;
        assert_eq!(list(&p.conn, &d).unwrap(), vec![]);
        set(&p.conn, &d, 4, 1_000).unwrap();
        set(&p.conn, &d, 8, 3_000).unwrap();
        assert_eq!(
            list(&p.conn, &d).unwrap(),
            vec![Anchor::new(4, 1_000), Anchor::new(8, 3_000)]
        );
        // Setting the same position again moves it.
        set(&p.conn, &d, 4, 1_500).unwrap();
        assert_eq!(
            list(&p.conn, &d).unwrap(),
            vec![Anchor::new(4, 1_500), Anchor::new(8, 3_000)]
        );
        remove(&p.conn, &d, 4).unwrap();
        assert_eq!(list(&p.conn, &d).unwrap(), vec![Anchor::new(8, 3_000)]);
        // Removing one that is not there is not an error.
        assert_eq!(
            remove(&p.conn, &d, 99).unwrap(),
            vec![Anchor::new(8, 3_000)]
        );
    }

    #[test]
    fn an_anchor_outside_the_document_is_refused() {
        let p = OpenProject::in_memory("t").unwrap();
        let d = documents::create(&p.conn, new_doc("short"))
            .unwrap()
            .summary
            .id;
        assert!(matches!(
            set(&p.conn, &d, 0, 100),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            set(&p.conn, &d, 900, 100),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            set(&p.conn, &d, 3, -1),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn building_anchors_reads_the_timestamps_the_format_captured() {
        let p = OpenProject::in_memory("t").unwrap();
        let d = documents::create(&p.conn, new_doc(TIMED))
            .unwrap()
            .summary
            .id;
        let info = transcripts::get(&p.conn, &d).unwrap();
        assert_eq!(info.format, TranscriptFormat::preset("bracket_time_name"));
        let anchors = build_from_timestamps(&p.conn, &d).unwrap();
        assert_eq!(
            anchors.iter().map(|a| a.ms).collect::<Vec<_>>(),
            vec![5_000, 20_000, 60_000, 90_000]
        );
        // Each anchor sits on the first character of what was said.
        let text = documents::get_text(&p.conn, &d).unwrap().0;
        for a in &anchors {
            let at: char = text.chars().nth(a.pos as usize).unwrap();
            assert!(at.is_alphabetic(), "anchor {a:?} landed on {at:?}");
        }
        // And the built anchors map a time back onto the right sentence.
        assert_eq!(ms_at(&p.conn, &d, anchors[1].pos), 20_000);
        assert_eq!(align::ms_to_pos(&anchors, 20_000), anchors[1].pos);
        // A position halfway through Bob's turn lands inside his turn.
        let mid = (anchors[1].pos + anchors[2].pos) / 2;
        let ms = align::pos_to_ms(&anchors, mid);
        assert!(ms > 20_000 && ms < 60_000);
        assert_eq!(align::ms_to_pos(&anchors, ms), mid);
    }

    fn ms_at(conn: &Connection, document_id: &str, pos: i64) -> i64 {
        align::pos_to_ms(&list(conn, document_id).unwrap(), pos)
    }

    #[test]
    fn a_document_with_no_timestamps_says_so() {
        let p = OpenProject::in_memory("t").unwrap();
        let d = documents::create(&p.conn, new_doc("Alice: Hi.\nBob: Hello.\nAlice: Bye.\n"))
            .unwrap()
            .summary
            .id;
        assert!(matches!(
            build_from_timestamps(&p.conn, &d),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn linking_and_unlinking_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let p = OpenProject::in_memory("t").unwrap();
        let text = documents::create(&p.conn, new_doc(TIMED))
            .unwrap()
            .summary
            .id;
        let rec = media_doc(&p, dir.path(), "Interview");
        assert!(documents::get_summary(&p.conn, &text)
            .unwrap()
            .linked_media_id
            .is_none());
        link(&p.conn, &text, Some(&rec)).unwrap();
        let summary = documents::get_summary(&p.conn, &text).unwrap();
        assert_eq!(summary.linked_media_id.as_deref(), Some(rec.as_str()));
        // The recording's own row knows which transcript belongs to it.
        assert_eq!(
            documents::get_summary(&p.conn, &rec)
                .unwrap()
                .transcript_id
                .as_deref(),
            Some(text.as_str())
        );
        link(&p.conn, &text, None).unwrap();
        assert!(documents::get_summary(&p.conn, &text)
            .unwrap()
            .linked_media_id
            .is_none());
        assert!(documents::get_summary(&p.conn, &rec)
            .unwrap()
            .transcript_id
            .is_none());
        // Only a text document can carry a link, and only to a recording.
        assert!(matches!(
            link(&p.conn, &rec, Some(&text)),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            link(&p.conn, &text, Some(&text)),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn anchors_and_links_survive_deleting_the_documents() {
        let dir = tempfile::tempdir().unwrap();
        let p = OpenProject::in_memory("t").unwrap();
        let text = documents::create(&p.conn, new_doc(TIMED))
            .unwrap()
            .summary
            .id;
        let rec = media_doc(&p, dir.path(), "Interview");
        link(&p.conn, &text, Some(&rec)).unwrap();
        let anchors = build_from_timestamps(&p.conn, &text).unwrap();

        // Deleting the transcript takes its anchors; undo brings them back.
        documents::delete(&p.conn, &text).unwrap();
        assert_eq!(list(&p.conn, &text).unwrap(), vec![]);
        history::undo(&p.conn).unwrap().unwrap();
        assert_eq!(list(&p.conn, &text).unwrap(), anchors);
        assert_eq!(
            documents::get_summary(&p.conn, &text)
                .unwrap()
                .linked_media_id
                .as_deref(),
            Some(rec.as_str())
        );

        // Deleting the recording unlinks the transcript rather than deleting
        // it; undo puts the link back.
        documents::delete(&p.conn, &rec).unwrap();
        assert!(documents::get_summary(&p.conn, &text)
            .unwrap()
            .linked_media_id
            .is_none());
        assert_eq!(list(&p.conn, &text).unwrap(), anchors);
        history::undo(&p.conn).unwrap().unwrap();
        assert_eq!(
            documents::get_summary(&p.conn, &text)
                .unwrap()
                .linked_media_id
                .as_deref(),
            Some(rec.as_str())
        );
    }

    #[test]
    fn coding_the_recording_for_a_passage_mirrors_the_codes() {
        let dir = tempfile::tempdir().unwrap();
        let p = OpenProject::in_memory("t").unwrap();
        let text = documents::create(&p.conn, new_doc(TIMED))
            .unwrap()
            .summary
            .id;
        let rec = media_doc(&p, dir.path(), "Interview");
        link(&p.conn, &text, Some(&rec)).unwrap();
        let anchors = build_from_timestamps(&p.conn, &text).unwrap();
        let code = codes::create(
            &p.conn,
            NewCode {
                name: "Trust".into(),
                ..Default::default()
            },
        )
        .unwrap()
        .id;
        let start = anchors[1].pos;
        let end = start + 5;
        let excerpt = excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: text.clone(),
                start_pos: Some(start),
                end_pos: Some(end),
                code_ids: vec![code.clone()],
                ..Default::default()
            },
        )
        .unwrap()
        .excerpt
        .id;

        let result = code_recording_for_excerpt(&p.conn, &excerpt).unwrap();
        assert_eq!(result.excerpt.document_id, rec);
        assert_eq!(result.excerpt.kind, "video_range");
        assert_eq!(result.excerpt.start_pos, Some(20_000));
        assert_eq!(result.excerpt.code_ids, vec![code]);

        // One group, so one undo takes the whole thing back.
        history::undo(&p.conn).unwrap().unwrap();
        assert_eq!(excerpts::list_for_document(&p.conn, &rec).unwrap().len(), 0);
    }

    #[test]
    fn coding_the_recording_needs_a_link_and_an_alignment() {
        let p = OpenProject::in_memory("t").unwrap();
        let text = documents::create(&p.conn, new_doc(TIMED))
            .unwrap()
            .summary
            .id;
        let excerpt = excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: text.clone(),
                start_pos: Some(1),
                end_pos: Some(5),
                code_ids: vec![],
                ..Default::default()
            },
        )
        .unwrap()
        .excerpt
        .id;
        assert!(matches!(
            code_recording_for_excerpt(&p.conn, &excerpt),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn an_import_can_bring_its_own_anchors() {
        let p = OpenProject::in_memory("t").unwrap();
        let doc = documents::create(
            &p.conn,
            crate::models::NewDocument {
                anchors: vec![Anchor::new(5, 1_000), Anchor::new(12, 4_000)],
                ..new_doc("one two three four five six")
            },
        )
        .unwrap()
        .summary;
        assert_eq!(doc.anchor_count, 2);
        assert_eq!(
            list(&p.conn, &doc.id).unwrap(),
            vec![Anchor::new(5, 1_000), Anchor::new(12, 4_000)]
        );
        // And they travel with the document through delete and undo.
        documents::delete(&p.conn, &doc.id).unwrap();
        history::undo(&p.conn).unwrap().unwrap();
        assert_eq!(list(&p.conn, &doc.id).unwrap().len(), 2);
    }
}
