//! Remembering how each document marks who is speaking.
//!
//! `text::transcript` knows how to *find* speaker labels; this module decides
//! which format a document is in and keeps the answer in
//! `documents.transcript_json`, so detection runs once per document rather
//! than on every read:
//!
//! | `transcript_json` | Means                                            |
//! | ----------------- | ------------------------------------------------ |
//! | `NULL`            | never looked at; the next read detects and stores |
//! | `{"kind":"none"}` | looked at, and explicitly not a transcript        |
//! | a format          | this is how its labels are written                |
//!
//! Stored next to the format is a small cache of what it finds — the speakers
//! and their turn counts — so a document listing can show the speakers without
//! re-scanning the text. Document text is immutable, so that cache is valid
//! for as long as the format is.
//!
//! The project-level default (`project_meta.transcript_default`) is what a
//! newly imported document starts from: `auto` (detect, the default) or a
//! format every import should be read with.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::history::TranscriptChange;
use super::{activity, documents, history, util};
use crate::error::{AppError, Result};
use crate::text::transcript::{self, TranscriptFormat, Turn};

/// A speaker and how many turns they take in one document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerCount {
    pub name: String,
    pub turns: i64,
}

/// What `documents.transcript_json` holds: the format, flattened, plus the
/// cache of what it finds in this document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTranscript {
    #[serde(flatten)]
    pub format: TranscriptFormat,
    #[serde(default)]
    pub speakers: Vec<SpeakerCount>,
    #[serde(default)]
    pub turn_count: i64,
}

impl StoredTranscript {
    pub(super) fn of(text: &str, format: TranscriptFormat) -> Self {
        let turns = transcript::turns(text, &format);
        Self {
            speakers: transcript::speakers(&turns)
                .into_iter()
                .map(|(name, turns)| SpeakerCount { name, turns })
                .collect(),
            turn_count: turns.len() as i64,
            format,
        }
    }
}

/// A document's transcript, as the document view and the format dialog want
/// it: the format in force, every turn, and the speakers with their counts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptInfo {
    pub format: TranscriptFormat,
    pub turns: Vec<Turn>,
    pub speakers: Vec<SpeakerCount>,
}

/// The `project_meta` key holding the project-level default.
const DEFAULT_KEY: &str = "transcript_default";

/// The project's default format for newly imported documents: `None` means
/// "auto" — detect each document on its own.
pub fn get_default(conn: &Connection) -> Result<Option<TranscriptFormat>> {
    let raw = super::meta(conn, DEFAULT_KEY)?;
    Ok(match raw.as_deref() {
        None | Some("auto") | Some("") => None,
        // A default written by a newer build reads back as "auto" rather than
        // making every import fail.
        Some(json) => serde_json::from_str(json).ok(),
    })
}

/// Set (or clear, with `None` = auto) the project-level default. The format is
/// validated first, so an unusable pattern can never be stored.
pub fn set_default(conn: &Connection, format: Option<TranscriptFormat>) -> Result<()> {
    let before = super::meta(conn, DEFAULT_KEY)?.unwrap_or_else(|| "auto".into());
    let value = match &format {
        Some(f) => {
            transcript::compile(f)?;
            serde_json::to_string(f)?
        }
        None => "auto".into(),
    };
    if value == before {
        return Ok(());
    }
    let tx = util::tx(conn)?;
    tx.execute(
        "INSERT INTO project_meta(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![DEFAULT_KEY, value],
    )?;
    activity::record(
        &tx,
        "transcript.default_set",
        "project",
        None,
        format!(
            "Set the project's transcript format to {}",
            format
                .as_ref()
                .map(|f| f.label())
                .unwrap_or_else(|| "Detect automatically".into())
        ),
        json!({ "format": activity::change(before.clone(), value) }),
        Some(history::payload(&TranscriptChange {
            document_id: None,
            format: format.clone(),
        })),
        Some(history::payload(&TranscriptChange {
            document_id: None,
            // What was there before, read back the same way `get_default` does.
            format: match before.as_str() {
                "auto" | "" => None,
                json => serde_json::from_str(json).ok(),
            },
        })),
    )?;
    tx.commit()?;
    Ok(())
}

/// The format stored for `id`, without detecting anything.
fn stored(conn: &Connection, id: &str) -> Result<Option<StoredTranscript>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT transcript_json FROM documents WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    // JSON written by a newer build reads back as "not looked at yet" rather
    // than making the document unopenable.
    Ok(raw.and_then(|j| serde_json::from_str(&j).ok()))
}

fn write(conn: &Connection, id: &str, stored: &StoredTranscript) -> Result<()> {
    conn.execute(
        "UPDATE documents SET transcript_json = ?2 WHERE id = ?1",
        params![id, serde_json::to_string(stored)?],
    )?;
    Ok(())
}

/// The format for `id`, detecting and storing one when the document has never
/// been looked at. Media documents have no text, so they get `none`.
///
/// This is what `documents::create` and `documents::get` call; it is a write
/// on a read path by design — the answer is expensive enough to be worth
/// keeping and, because document text never changes, it stays correct.
pub fn ensure(conn: &Connection, id: &str) -> Result<StoredTranscript> {
    if let Some(found) = stored(conn, id)? {
        return Ok(found);
    }
    let text: Option<String> = conn
        .query_row(
            "SELECT text FROM documents WHERE id = ?1 AND kind = 'text'",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    let Some(text) = text else {
        // Not a text document (or not a document at all): nothing to detect.
        // Only a real document gets a stored answer.
        let exists: bool = conn
            .query_row("SELECT 1 FROM documents WHERE id = ?1", [id], |_| Ok(true))
            .optional()?
            .unwrap_or(false);
        if !exists {
            return Err(AppError::NotFound(format!("document {id} not found")));
        }
        let none = StoredTranscript::of("", TranscriptFormat::none());
        write(conn, id, &none)?;
        return Ok(none);
    };
    // The project default wins over detection when one is set, so a project
    // whose transcripts all use the same odd convention is configured once.
    let format = match get_default(conn)? {
        Some(default) => default,
        None => transcript::detect_format(&text)
            .map(|(format, _)| format)
            .unwrap_or_else(TranscriptFormat::none),
    };
    let found = StoredTranscript::of(&text, format);
    write(conn, id, &found)?;
    Ok(found)
}

/// Everything the document view and the format dialog need for one document.
pub fn get(conn: &Connection, id: &str) -> Result<TranscriptInfo> {
    let found = ensure(conn, id)?;
    let text = documents::get_text(conn, id)
        .map(|(t, _)| t)
        .unwrap_or_default();
    Ok(TranscriptInfo {
        turns: transcript::turns(&text, &found.format),
        speakers: found.speakers,
        format: found.format,
    })
}

/// What `format` would find in `id` without storing anything — the format
/// dialog's live preview, and the validation of a custom pattern.
pub fn preview(conn: &Connection, id: &str, format: &TranscriptFormat) -> Result<TranscriptInfo> {
    transcript::compile(format)?;
    let text = documents::get_text(conn, id)
        .map(|(t, _)| t)
        .unwrap_or_default();
    let turns = transcript::turns(&text, format);
    Ok(TranscriptInfo {
        speakers: transcript::speakers(&turns)
            .into_iter()
            .map(|(name, turns)| SpeakerCount { name, turns })
            .collect(),
        turns,
        format: format.clone(),
    })
}

/// Pin `id` to a format, or (with `None`) forget the stored answer so the next
/// read detects again. Returns the transcript as it now stands.
///
/// Logs the previous and next format in the activity entry's `detail`, so undo
/// is "set it back to the previous one".
pub fn set_format(
    conn: &Connection,
    id: &str,
    format: Option<TranscriptFormat>,
) -> Result<TranscriptInfo> {
    let before = ensure(conn, id)?.format;
    let tx = util::tx(conn)?;
    match &format {
        Some(f) => {
            transcript::compile(f)?;
            let (text, _) = documents::get_text(&tx, id)?;
            write(&tx, id, &StoredTranscript::of(&text, f.clone()))?;
        }
        None => {
            tx.execute(
                "UPDATE documents SET transcript_json = NULL WHERE id = ?1",
                [id],
            )?;
        }
    }
    tx.execute(
        "UPDATE documents SET updated_at = ?2 WHERE id = ?1",
        params![id, util::now()],
    )?;
    let next = format.clone().unwrap_or_else(|| {
        // Re-detecting is what the next read will do; name it as such.
        TranscriptFormat {
            kind: "auto".into(),
            preset: None,
            pattern: None,
        }
    });
    activity::record(
        &tx,
        "transcript.format_set",
        "document",
        Some(id),
        format!(
            "Set the transcript format of \"{}\" to {}",
            activity::document_name(&tx, id),
            if format.is_some() {
                next.label()
            } else {
                "Detect automatically".into()
            }
        ),
        json!({
            "format": activity::change(
                serde_json::to_value(&before)?,
                serde_json::to_value(&next)?,
            )
        }),
        Some(history::payload(&TranscriptChange {
            document_id: Some(id.to_string()),
            format: format.clone(),
        })),
        // Undo pins whatever was in force before — the same reading of the
        // document, whether it had been detected or chosen.
        Some(history::payload(&TranscriptChange {
            document_id: Some(id.to_string()),
            format: Some(before.clone()),
        })),
    )?;
    tx.commit()?;
    get(conn, id)
}

/// Per-document turns, loaded once and kept, for the paths that ask "who was
/// speaking here?" about a lot of excerpts at once (the excerpt browser, the
/// speaker cross-tab). Documents with no transcript cache an empty list, so
/// they are read once too.
#[derive(Default)]
pub struct TurnIndex {
    by_document: HashMap<String, Vec<Turn>>,
}

impl TurnIndex {
    pub fn new() -> Self {
        Self::default()
    }

    /// The turns of `document_id`, detecting and storing the format if this is
    /// the first time the document has been looked at.
    pub fn turns(&mut self, conn: &Connection, document_id: &str) -> Result<&[Turn]> {
        if !self.by_document.contains_key(document_id) {
            let turns = match ensure(conn, document_id) {
                Ok(found) if !found.format.is_none() => {
                    let text = documents::get_text(conn, document_id)
                        .map(|(t, _)| t)
                        .unwrap_or_default();
                    transcript::turns(&text, &found.format)
                }
                // A missing or non-transcript document simply has no turns.
                _ => vec![],
            };
            self.by_document.insert(document_id.to_string(), turns);
        }
        Ok(self
            .by_document
            .get(document_id)
            .map(Vec::as_slice)
            .unwrap_or_default())
    }

    /// Who was speaking at `pos` (a code point offset) in `document_id`.
    ///
    /// A position inside a turn's spoken text answers with that speaker; one
    /// inside a *label* answers with the speaker whose label it is, so an
    /// excerpt that swallowed a label is still attributed to the right person.
    pub fn speaker_at(
        &mut self,
        conn: &Connection,
        document_id: &str,
        pos: i64,
    ) -> Result<Option<String>> {
        let turns = self.turns(conn, document_id)?;
        Ok(turns
            .iter()
            .rev()
            .find(|t| t.label_start <= pos && pos < t.end.max(t.label_end))
            .map(|t| t.speaker.clone()))
    }
}

/// Every speaker in the project, de-duplicated and sorted case-insensitively:
/// what the excerpt browser's speaker filter lists.
pub fn project_speakers(conn: &Connection) -> Result<Vec<String>> {
    let ids: Vec<String> = documents::list(conn)?
        .into_iter()
        .filter(|d| d.kind == "text")
        .map(|d| d.id)
        .collect();
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        for s in ensure(conn, &id)?.speakers {
            if !out.iter().any(|n| n.eq_ignore_ascii_case(&s.name)) {
                out.push(s.name);
            }
        }
    }
    out.sort_by_key(|n| n.to_lowercase());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::documents::tests::new_doc;
    use crate::db::{documents, OpenProject};
    use crate::models::NewDocument;

    const TRANSCRIPT: &str = "Alice: Hi there.\nBob: Hello.\nAlice: Bye.\nBob: Bye now.\n";

    fn project() -> OpenProject {
        OpenProject::in_memory("t").unwrap()
    }

    #[test]
    fn importing_a_transcript_detects_and_stores_its_format() {
        let p = project();
        let doc = documents::create(&p.conn, new_doc(TRANSCRIPT)).unwrap();
        let raw: Option<String> = p
            .conn
            .query_row(
                "SELECT transcript_json FROM documents WHERE id = ?1",
                [&doc.summary.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(raw.is_some(), "the format is stored at import");
        let info = get(&p.conn, &doc.summary.id).unwrap();
        assert_eq!(info.format, TranscriptFormat::preset("name_colon"));
        assert_eq!(info.turns.len(), 4);
        assert_eq!(
            info.speakers,
            vec![
                SpeakerCount {
                    name: "Alice".into(),
                    turns: 2
                },
                SpeakerCount {
                    name: "Bob".into(),
                    turns: 2
                },
            ]
        );
        // The summary carries the speakers for cheap display.
        assert_eq!(
            documents::get_summary(&p.conn, &doc.summary.id)
                .unwrap()
                .speakers,
            vec!["Alice".to_string(), "Bob".to_string()]
        );
    }

    #[test]
    fn a_document_that_is_not_a_transcript_is_stored_as_none_and_not_looked_at_twice() {
        let p = project();
        let doc = documents::create(&p.conn, new_doc("Just prose.\nNo labels.\n")).unwrap();
        let info = get(&p.conn, &doc.summary.id).unwrap();
        assert_eq!(info.format, TranscriptFormat::none());
        assert_eq!(info.turns, vec![]);
        let raw: Option<String> = p
            .conn
            .query_row(
                "SELECT transcript_json FROM documents WHERE id = ?1",
                [&doc.summary.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            raw.as_deref(),
            Some(r#"{"kind":"none","speakers":[],"turnCount":0}"#)
        );
    }

    #[test]
    fn an_older_document_with_no_stored_format_is_detected_on_read() {
        let p = project();
        let doc = documents::create(&p.conn, new_doc(TRANSCRIPT)).unwrap();
        // Back to how a pre-migration file looks.
        p.conn
            .execute("UPDATE documents SET transcript_json = NULL", [])
            .unwrap();
        assert_eq!(
            documents::get(&p.conn, &doc.summary.id)
                .unwrap()
                .summary
                .speakers,
            vec!["Alice".to_string(), "Bob".to_string()]
        );
        assert!(stored(&p.conn, &doc.summary.id).unwrap().is_some());
    }

    #[test]
    fn setting_a_format_pins_it_and_clearing_it_detects_again() {
        let p = project();
        let doc = documents::create(&p.conn, new_doc(TRANSCRIPT)).unwrap();
        let info = set_format(&p.conn, &doc.summary.id, Some(TranscriptFormat::none())).unwrap();
        assert_eq!(info.format, TranscriptFormat::none());
        assert_eq!(info.turns, vec![]);
        assert!(documents::get_summary(&p.conn, &doc.summary.id)
            .unwrap()
            .speakers
            .is_empty());
        // Clearing goes back to detection.
        let info = set_format(&p.conn, &doc.summary.id, None).unwrap();
        assert_eq!(info.format, TranscriptFormat::preset("name_colon"));
        assert_eq!(info.turns.len(), 4);
        // A pattern that cannot work is refused before anything is written.
        assert!(matches!(
            set_format(
                &p.conn,
                &doc.summary.id,
                Some(TranscriptFormat::regex("^(?<who>.+):"))
            ),
            Err(AppError::Validation(_))
        ));
        assert_eq!(
            get(&p.conn, &doc.summary.id).unwrap().format,
            TranscriptFormat::preset("name_colon")
        );
    }

    #[test]
    fn the_previous_and_next_format_are_logged_so_the_change_can_be_undone() {
        let p = project();
        let doc = documents::create(&p.conn, new_doc(TRANSCRIPT)).unwrap();
        set_format(&p.conn, &doc.summary.id, Some(TranscriptFormat::none())).unwrap();
        let entries = activity::all(&p.conn).unwrap();
        let entry = entries
            .iter()
            .find(|e| e.kind == "transcript.format_set")
            .expect("the change is logged");
        assert_eq!(entry.target_id.as_deref(), Some(doc.summary.id.as_str()));
        assert_eq!(entry.detail["format"]["from"]["preset"], "name_colon");
        assert_eq!(entry.detail["format"]["to"]["kind"], "none");
    }

    #[test]
    fn setting_a_format_is_undoable_through_the_history_tree() {
        let p = project();
        let doc = documents::create(&p.conn, new_doc(TRANSCRIPT)).unwrap();
        let id = doc.summary.id;
        set_format(&p.conn, &id, Some(TranscriptFormat::none())).unwrap();
        assert_eq!(get(&p.conn, &id).unwrap().format, TranscriptFormat::none());

        history::undo(&p.conn).unwrap().expect("a node to undo");
        assert_eq!(
            get(&p.conn, &id).unwrap().format,
            TranscriptFormat::preset("name_colon")
        );
        history::redo(&p.conn, None)
            .unwrap()
            .expect("a node to redo");
        assert_eq!(get(&p.conn, &id).unwrap().format, TranscriptFormat::none());

        // …and so is the project default.
        set_default(&p.conn, Some(TranscriptFormat::preset("bracket_name"))).unwrap();
        history::undo(&p.conn).unwrap().expect("a node to undo");
        assert_eq!(get_default(&p.conn).unwrap(), None);
        history::redo(&p.conn, None)
            .unwrap()
            .expect("a node to redo");
        assert_eq!(
            get_default(&p.conn).unwrap(),
            Some(TranscriptFormat::preset("bracket_name"))
        );
        // Replaying a step never writes a second history node.
        let steps = history::tree(&p.conn).unwrap().len();
        history::undo(&p.conn).unwrap();
        assert_eq!(history::tree(&p.conn).unwrap().len(), steps);
    }

    #[test]
    fn a_project_default_is_used_instead_of_detection_for_new_documents() {
        let p = project();
        assert_eq!(get_default(&p.conn).unwrap(), None);
        set_default(&p.conn, Some(TranscriptFormat::none())).unwrap();
        assert_eq!(
            get_default(&p.conn).unwrap(),
            Some(TranscriptFormat::none())
        );
        let doc = documents::create(&p.conn, new_doc(TRANSCRIPT)).unwrap();
        assert_eq!(
            get(&p.conn, &doc.summary.id).unwrap().format,
            TranscriptFormat::none()
        );
        // Back to auto; documents imported afterwards are detected again.
        set_default(&p.conn, None).unwrap();
        assert_eq!(get_default(&p.conn).unwrap(), None);
        let other = documents::create(
            &p.conn,
            NewDocument {
                name: "Interview 2".into(),
                ..new_doc(&TRANSCRIPT.replace("Bye now.", "Bye then."))
            },
        )
        .unwrap();
        assert_eq!(
            get(&p.conn, &other.summary.id).unwrap().format,
            TranscriptFormat::preset("name_colon")
        );
        // An unusable default is refused.
        assert!(matches!(
            set_default(&p.conn, Some(TranscriptFormat::regex("(unclosed"))),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn preview_does_not_store_anything() {
        let p = project();
        let doc = documents::create(&p.conn, new_doc(TRANSCRIPT)).unwrap();
        let info = preview(&p.conn, &doc.summary.id, &TranscriptFormat::none()).unwrap();
        assert_eq!(info.turns, vec![]);
        assert_eq!(
            get(&p.conn, &doc.summary.id).unwrap().format,
            TranscriptFormat::preset("name_colon")
        );
        assert!(matches!(
            preview(
                &p.conn,
                &doc.summary.id,
                &TranscriptFormat::regex("(unclosed")
            ),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn the_turn_index_answers_who_was_speaking_and_lists_project_speakers() {
        let p = project();
        let doc = documents::create(&p.conn, new_doc(TRANSCRIPT)).unwrap();
        let id = doc.summary.id;
        let mut index = TurnIndex::new();
        // "Alice: Hi there." — offset 0 is inside Alice's label, 7 inside her text.
        assert_eq!(
            index.speaker_at(&p.conn, &id, 0).unwrap().as_deref(),
            Some("Alice")
        );
        assert_eq!(
            index.speaker_at(&p.conn, &id, 8).unwrap().as_deref(),
            Some("Alice")
        );
        // The first character of Bob's line.
        let bob_at = TRANSCRIPT.find("Bob:").unwrap() as i64;
        assert_eq!(
            index.speaker_at(&p.conn, &id, bob_at).unwrap().as_deref(),
            Some("Bob")
        );
        // An unknown document has no turns rather than an error.
        assert_eq!(index.speaker_at(&p.conn, "nope", 0).unwrap(), None);
        assert_eq!(
            project_speakers(&p.conn).unwrap(),
            vec!["Alice".to_string(), "Bob".to_string()]
        );
    }

    #[test]
    fn an_image_document_has_no_transcript_and_an_unknown_id_is_not_found() {
        let p = project();
        let id = documents::create_image(&p.conn, crate::db::documents::tests::new_image(b"png"))
            .unwrap()
            .summary
            .id;
        assert_eq!(get(&p.conn, &id).unwrap().format, TranscriptFormat::none());
        assert!(matches!(
            ensure(&p.conn, "nope"),
            Err(AppError::NotFound(_))
        ));
    }
}
