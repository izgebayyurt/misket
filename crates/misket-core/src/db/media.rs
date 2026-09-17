//! Audio and video documents, held **by reference**.
//!
//! An image document keeps its pixels inside the project file (`media_blobs`)
//! so a `.misket` stays self-contained. A recording cannot: a two-hour
//! interview is gigabytes, and a project file is opened, copied and backed up
//! whole. So an audio or video document stores only where the file is
//! (`documents.source_path`) and what was measured from it
//! (`documents.media_json`): MIME, duration, pixel size, size on disk and a
//! cheap content fingerprint.
//!
//! That trade-off has a cost — the file can move — so this module also owns
//! detecting a missing file ([`missing`], [`is_missing`]) and pointing a
//! document at a new one ([`relink`], undoable like every other write).

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;

use super::history::DocumentOp;
use super::{activity, documents, history, text, transcripts, util};
use crate::error::{AppError, Result};
use crate::models::{
    Document, DocumentSummary, MediaInfo, MediaThumbnail, MissingMedia, NewMediaDocument,
};

/// The audio and video types Misket imports, with the `source_format`
/// recorded for each. Whether a given build's webview can actually decode one
/// is the frontend's business: it measures the file before importing it and
/// refuses what it cannot play (see `src/core/media.ts`).
pub const MEDIA_MIMES: [(&str, &str); 11] = [
    ("audio/mpeg", "mp3"),
    ("audio/wav", "wav"),
    ("audio/mp4", "m4a"),
    ("audio/aac", "aac"),
    ("audio/ogg", "ogg"),
    ("audio/flac", "flac"),
    ("video/mp4", "mp4"),
    ("video/quicktime", "mov"),
    ("video/webm", "webm"),
    ("video/x-m4v", "m4v"),
    ("video/x-matroska", "mkv"),
];

/// How much of each end of the file goes into [`file_hash`].
const HASH_WINDOW: u64 = 1024 * 1024;

/// The name a thumbnail is stored under in `media_blobs`.
const THUMBNAIL: &str = "thumbnail";

/// A cheap content fingerprint: SHA-256 over the first and last mebibyte of
/// the file plus its length.
///
/// Hashing a 4 GB recording in full would take a minute and buy nothing —
/// container headers sit at the front, the moov atom or index at the back,
/// and the length pins the rest. Two different recordings colliding on all
/// three is not a case worth engineering against: the hash decides whether an
/// import is a duplicate and whether a relinked file looks like the same
/// recording, and both are advisory.
pub fn file_hash(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};

    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    let mut hasher = Sha256::new();
    hasher.update(len.to_le_bytes());

    let window = HASH_WINDOW.min(len) as usize;
    let mut buf = vec![0u8; window];
    f.read_exact(&mut buf)?;
    hasher.update(&buf);
    if len > HASH_WINDOW {
        f.seek(SeekFrom::End(-(window as i64)))?;
        f.read_exact(&mut buf)?;
        hasher.update(&buf);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Whether this document's media file is not where it is supposed to be.
///
/// Only recordings can go missing: text and image bytes are inside the
/// project file.
pub fn is_missing(kind: &str, source_path: Option<&str>) -> bool {
    if kind != documents::MEDIA_KIND {
        return false;
    }
    match source_path {
        Some(p) => !Path::new(p).is_file(),
        None => true,
    }
}

/// Where `copy_into_project` puts media: a folder beside the project file,
/// named after it. `/data/study.misket` → `/data/study.media/`.
pub fn media_dir(project_path: &Path) -> PathBuf {
    let stem = project_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project".into());
    project_path.with_file_name(format!("{stem}.media"))
}

fn format_for(mime: &str) -> Result<&'static str> {
    MEDIA_MIMES
        .iter()
        .find(|(m, _)| *m == mime)
        .map(|(_, f)| *f)
        .ok_or_else(|| {
            AppError::Validation(format!(
                "unsupported media type {mime:?}; Misket reads {}",
                MEDIA_MIMES
                    .iter()
                    .map(|(_, f)| *f)
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })
}

/// A duration as `m:ss.s`, the unit a coder reads a timeline in. Hours are
/// only shown once there are any.
pub fn timecode(ms: i64) -> String {
    let ms = ms.max(0);
    let tenths = (ms % 1000) / 100;
    let total_seconds = ms / 1000;
    let seconds = total_seconds % 60;
    let minutes = (total_seconds / 60) % 60;
    let hours = total_seconds / 3600;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}.{tenths}")
    } else {
        format!("{minutes}:{seconds:02}.{tenths}")
    }
}

/// The stand-in an excerpt browser, export or memo list shows for a coded
/// stretch of a recording: `[1:02.4–1:09.0]`.
pub fn range_label(start_ms: i64, end_ms: i64) -> String {
    format!("[{}–{}]", timecode(start_ms), timecode(end_ms))
}

/// Import an audio or video document.
///
/// `project_path` is the open project's file, needed only for
/// `copy_into_project`. The file is never read into the project: it is
/// fingerprinted (and optionally copied beside the project) and the row keeps
/// its path.
pub fn create(
    conn: &Connection,
    project_path: Option<&Path>,
    input: NewMediaDocument,
) -> Result<Document> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("document name is required".into()));
    }
    let mime = input.mime.trim().to_ascii_lowercase();
    let format = format_for(&mime)?;
    let duration = input.media.duration_ms.unwrap_or_default();
    if duration <= 0 {
        return Err(AppError::Validation(
            "the recording's duration could not be read; the file may use a codec this build cannot play".into(),
        ));
    }
    let source = Path::new(&input.source_path);
    if !source.is_file() {
        return Err(AppError::NotFound(format!(
            "no file at {}",
            source.display()
        )));
    }
    let hash = file_hash(source)?;
    if !input.allow_duplicate {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM documents WHERE content_hash = ?1",
                [&hash],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            return Err(AppError::Conflict(format!(
                "an identical document already exists ({id})"
            )));
        }
    }
    let size = source.metadata()?.len() as i64;
    let stored_path = if input.copy_into_project {
        let project = project_path.ok_or_else(|| {
            AppError::Validation(
                "the project has to be saved to a file before media can be copied into it".into(),
            )
        })?;
        copy_into_project(source, &media_dir(project))?
    } else {
        source.to_path_buf()
    };

    let media = MediaInfo {
        mime: mime.clone(),
        duration_ms: Some(duration),
        size_bytes: Some(size),
        file_hash: Some(hash.clone()),
        // Peaks are computed by the viewer on first open, never at import.
        peaks: None,
        ..input.media
    };
    let id = util::new_id();
    let now = util::now();
    let sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM documents",
        [],
        |r| r.get(0),
    )?;
    let tx = util::tx(conn)?;
    tx.execute(
        "INSERT INTO documents (id, kind, name, source_path, source_format, content_hash,
                                media_json, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            documents::MEDIA_KIND,
            name,
            stored_path.to_string_lossy(),
            format,
            hash,
            serde_json::to_string(&media)?,
            sort_order,
            now
        ],
    )?;
    // A recording has no text to read speakers out of, but it gets the same
    // "looked at, not a transcript" answer as any other document before the
    // import is snapshotted for the history.
    transcripts::ensure(&tx, &id)?;
    documents::log_import(&tx, &id)?;
    tx.commit()?;
    documents::get(conn, &id)
}

/// Copy a media file into `dir`, keeping its name unless something else is
/// already there under it.
fn copy_into_project(source: &Path, dir: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let file_name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "media".into());
    let mut target = dir.join(&file_name);
    if target.exists() {
        let stem = Path::new(&file_name)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "media".into());
        let ext = Path::new(&file_name)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        for n in 2.. {
            let candidate = dir.join(format!("{stem} ({n}){ext}"));
            if !candidate.exists() {
                target = candidate;
                break;
            }
        }
    }
    std::fs::copy(source, &target)?;
    Ok(target)
}

/// Point a media document at a different file.
///
/// The new file is fingerprinted and measured for size, and its duration is
/// kept from the old row: the frontend does not re-measure on relink, and a
/// stretch already coded must not silently fall outside the recording. A
/// genuinely different recording should be imported, not relinked.
pub fn relink(conn: &Connection, id: &str, new_path: &str) -> Result<DocumentSummary> {
    let before = documents::get_summary(conn, id)?;
    if before.kind != documents::MEDIA_KIND {
        return Err(AppError::Validation(format!(
            "{:?} is not an audio or video document",
            before.name
        )));
    }
    let path = Path::new(new_path.trim());
    if !path.is_file() {
        return Err(AppError::NotFound(format!("no file at {}", path.display())));
    }
    let hash = file_hash(path)?;
    let mut media = before.media.clone().unwrap_or_default();
    media.size_bytes = Some(path.metadata()?.len() as i64);
    media.file_hash = Some(hash.clone());
    // The waveform belongs to the old bytes.
    media.peaks = None;
    let media_json = serde_json::to_string(&media)?;
    let now = util::now();
    let path_text = path.to_string_lossy().into_owned();

    let tx = util::tx(conn)?;
    tx.execute(
        "UPDATE documents SET source_path = ?2, content_hash = ?3, media_json = ?4,
                              updated_at = ?5
          WHERE id = ?1",
        params![id, path_text, hash, media_json, now],
    )?;
    activity::record(
        &tx,
        "document.relinked",
        "document",
        Some(id),
        format!("Relinked \"{}\" to {path_text}", before.name),
        json!({
            "name": before.name,
            "sourcePath": activity::change(before.source_path.clone(), Some(path_text.clone())),
        }),
        Some(history::payload(&DocumentOp::Relink {
            document_id: id.to_string(),
            source_path: Some(path_text),
            content_hash: hash,
            media_json: Some(media_json),
            updated_at: now,
        })),
        Some(history::payload(&DocumentOp::Relink {
            document_id: id.to_string(),
            source_path: before.source_path.clone(),
            content_hash: content_hash_of(&tx, id)?,
            media_json: before
                .media
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            updated_at: before.updated_at.clone(),
        })),
    )?;
    tx.commit()?;
    documents::get_summary(conn, id)
}

/// The `content_hash` a document row holds right now.
fn content_hash_of(conn: &Connection, id: &str) -> Result<String> {
    Ok(conn.query_row(
        "SELECT content_hash FROM documents WHERE id = ?1",
        [id],
        |r| r.get(0),
    )?)
}

/// Cache the waveform the viewer computed for a recording.
///
/// Not recorded in the history: peaks are a rendering cache derived from the
/// file, exactly like the transcript format cached by
/// [`transcripts::ensure`], and nobody should have to press undo twice
/// because opening a document drew a waveform. `updated_at` is deliberately
/// left alone for the same reason.
pub fn set_peaks(conn: &Connection, id: &str, peaks: &[f64]) -> Result<DocumentSummary> {
    let summary = documents::get_summary(conn, id)?;
    if summary.kind != documents::MEDIA_KIND {
        return Err(AppError::Validation(format!(
            "{:?} is not an audio or video document",
            summary.name
        )));
    }
    if peaks.len() > 8000 {
        return Err(AppError::Validation(
            "a waveform of more than 8000 peaks is finer than any timeline can draw".into(),
        ));
    }
    let mut media = summary.media.clone().unwrap_or_default();
    media.peaks = if peaks.is_empty() {
        None
    } else {
        // Store two decimals: a peak is drawn as a few pixels of height, and
        // 2000 full-precision floats would triple the row for nothing.
        Some(
            peaks
                .iter()
                .map(|p| (p.clamp(0.0, 1.0) * 100.0).round() / 100.0)
                .collect(),
        )
    };
    conn.execute(
        "UPDATE documents SET media_json = ?2 WHERE id = ?1",
        params![id, serde_json::to_string(&media)?],
    )?;
    documents::get_summary(conn, id)
}

/// Store the frame captured for a `video_range` excerpt.
///
/// A cache like [`set_peaks`]: it is derived from the media file and the
/// excerpt's in-point, so it is written without a history node. It travels
/// with the excerpt through delete and undo all the same, because
/// [`super::excerpts::snapshot`] picks it up.
pub fn set_thumbnail(conn: &Connection, excerpt_id: &str, mime: &str, bytes: &[u8]) -> Result<()> {
    let (document_id, kind): (String, String) = conn
        .query_row(
            "SELECT document_id, kind FROM excerpts WHERE id = ?1",
            [excerpt_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("excerpt {excerpt_id} not found")))?;
    if kind != "video_range" {
        return Err(AppError::Validation(
            "only a coded stretch of a recording has a frame to capture".into(),
        ));
    }
    if bytes.is_empty() {
        return Err(AppError::Validation("the thumbnail is empty".into()));
    }
    if bytes.len() > 512 * 1024 {
        return Err(AppError::Validation(
            "a thumbnail larger than 512 KB does not belong in the project file".into(),
        ));
    }
    write_thumbnail(conn, &document_id, excerpt_id, mime, bytes)
}

fn write_thumbnail(
    conn: &Connection,
    document_id: &str,
    excerpt_id: &str,
    mime: &str,
    bytes: &[u8],
) -> Result<()> {
    conn.execute(
        "DELETE FROM media_blobs WHERE excerpt_id = ?1 AND name = ?2",
        params![excerpt_id, THUMBNAIL],
    )?;
    conn.execute(
        "INSERT INTO media_blobs (document_id, excerpt_id, name, mime, bytes)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![document_id, excerpt_id, THUMBNAIL, mime, bytes],
    )?;
    Ok(())
}

/// The frame stored for an excerpt, if one was ever captured.
pub fn thumbnail(conn: &Connection, excerpt_id: &str) -> Result<Option<MediaThumbnail>> {
    Ok(conn
        .query_row(
            "SELECT mime, bytes FROM media_blobs WHERE excerpt_id = ?1 AND name = ?2",
            params![excerpt_id, THUMBNAIL],
            |r| {
                Ok(MediaThumbnail {
                    mime: r.get(0)?,
                    bytes: r.get(1)?,
                })
            },
        )
        .optional()?)
}

/// Put a thumbnail back as part of restoring its excerpt.
pub(super) fn restore_thumbnail(
    conn: &Connection,
    document_id: &str,
    excerpt_id: &str,
    thumb: &MediaThumbnail,
) -> Result<()> {
    write_thumbnail(conn, document_id, excerpt_id, &thumb.mime, &thumb.bytes)
}

/// Every audio or video document whose file is not at its `source_path`.
pub fn missing(conn: &Connection) -> Result<Vec<MissingMedia>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, source_path FROM documents WHERE kind = ?1
         ORDER BY sort_order, created_at",
    )?;
    let rows = stmt
        .query_map([documents::MEDIA_KIND], |r| {
            Ok(MissingMedia {
                document_id: r.get(0)?,
                name: r.get(1)?,
                source_path: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows
        .into_iter()
        .filter(|m| is_missing(documents::MEDIA_KIND, m.source_path.as_deref()))
        .collect())
}

/// The bytes of a media document, as the custom protocol serves them: either
/// the blob stored inside the project (an image) or the file on disk (a
/// recording). Recordings are answered by path so the protocol can stream a
/// byte range instead of loading gigabytes into memory.
pub enum Source {
    /// Bytes held in `media_blobs`.
    Blob { mime: String, bytes: Vec<u8> },
    /// A file on disk, to be read (or range-read) by the caller.
    File { mime: String, path: PathBuf },
}

/// Where the bytes for `document_id` are.
pub fn source(conn: &Connection, document_id: &str) -> Result<Source> {
    let summary = documents::get_summary(conn, document_id)?;
    if summary.kind != documents::MEDIA_KIND {
        let (mime, bytes) = documents::get_media(conn, document_id)?;
        return Ok(Source::Blob { mime, bytes });
    }
    let path = summary
        .source_path
        .as_deref()
        .ok_or_else(|| AppError::NotFound(format!("document {document_id} has no media file")))?;
    if !Path::new(path).is_file() {
        return Err(AppError::NotFound(format!(
            "the media file for {:?} is not at {path} any more",
            summary.name
        )));
    }
    Ok(Source::File {
        mime: summary
            .media
            .map(|m| m.mime)
            .unwrap_or_else(|| "application/octet-stream".into()),
        path: PathBuf::from(path),
    })
}

/// The bytes of an excerpt's thumbnail, for the protocol.
pub fn thumbnail_source(conn: &Connection, excerpt_id: &str) -> Result<Source> {
    thumbnail(conn, excerpt_id)?
        .map(|t| Source::Blob {
            mime: t.mime,
            bytes: t.bytes,
        })
        .ok_or_else(|| AppError::NotFound(format!("excerpt {excerpt_id} has no thumbnail")))
}

/// A hash of some bytes, for callers that have them in memory already.
pub fn bytes_hash(bytes: &[u8]) -> String {
    text::sha256_hex(bytes)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::{codes, excerpts, OpenProject};
    use crate::models::ApplyCodesInput;

    /// A file of `len` bytes whose contents depend on `seed`.
    pub(crate) fn fake_file(dir: &Path, name: &str, len: usize, seed: u8) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        let bytes: Vec<u8> = (0..len)
            .map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed))
            .collect();
        std::fs::write(&path, bytes).unwrap();
        path
    }

    pub(crate) fn new_media(path: &Path) -> NewMediaDocument {
        NewMediaDocument {
            name: "Interview audio".into(),
            source_path: path.to_string_lossy().into_owned(),
            mime: "audio/mpeg".into(),
            media: MediaInfo {
                mime: "audio/mpeg".into(),
                duration_ms: Some(125_400),
                ..Default::default()
            },
            copy_into_project: false,
            allow_duplicate: false,
        }
    }

    #[test]
    fn timecodes_read_as_minutes_and_tenths() {
        assert_eq!(timecode(0), "0:00.0");
        assert_eq!(timecode(999), "0:00.9");
        assert_eq!(timecode(1_000), "0:01.0");
        assert_eq!(timecode(62_450), "1:02.4");
        assert_eq!(timecode(3_600_000), "1:00:00.0");
        assert_eq!(timecode(-5), "0:00.0");
        assert_eq!(range_label(62_450, 69_000), "[1:02.4–1:09.0]");
    }

    #[test]
    fn file_hash_covers_both_ends_and_the_length() {
        let dir = tempfile::tempdir().unwrap();
        let a = fake_file(dir.path(), "a.bin", 4096, 1);
        let b = fake_file(dir.path(), "b.bin", 4096, 2);
        let c = fake_file(dir.path(), "c.bin", 8192, 1);
        assert_eq!(file_hash(&a).unwrap(), file_hash(&a).unwrap());
        assert_ne!(file_hash(&a).unwrap(), file_hash(&b).unwrap());
        // Same leading bytes, different length.
        assert_ne!(file_hash(&a).unwrap(), file_hash(&c).unwrap());
        // A file larger than the window hashes its tail too.
        let big = fake_file(dir.path(), "big.bin", (HASH_WINDOW as usize) + 1024, 3);
        let mut tweaked = std::fs::read(&big).unwrap();
        let last = tweaked.len() - 1;
        tweaked[last] ^= 0xff;
        let big2 = dir.path().join("big2.bin");
        std::fs::write(&big2, &tweaked).unwrap();
        assert_ne!(file_hash(&big).unwrap(), file_hash(&big2).unwrap());
    }

    #[test]
    fn create_keeps_the_bytes_out_of_the_project_file() {
        let p = OpenProject::in_memory("t").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = fake_file(dir.path(), "interview.mp3", 40_000, 7);
        let d = create(&p.conn, None, new_media(&path)).unwrap();
        assert_eq!(d.summary.kind, "video");
        assert_eq!(d.summary.source_format.as_deref(), Some("mp3"));
        assert!(d.text.is_none());
        assert_eq!(d.summary.text_length, None);
        assert!(!d.summary.media_missing);
        let media = d.summary.media.clone().unwrap();
        assert_eq!(media.duration_ms, Some(125_400));
        assert_eq!(media.size_bytes, Some(40_000));
        assert_eq!(
            media.file_hash.as_deref(),
            Some(&*file_hash(&path).unwrap())
        );
        // Nothing was copied into the project.
        let blobs: i64 = p
            .conn
            .query_row("SELECT count(*) FROM media_blobs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(blobs, 0);
        assert!(matches!(
            documents::get_media(&p.conn, &d.summary.id),
            Err(AppError::NotFound(_))
        ));
        // The cheap file hash is the document's content hash, so the same
        // file twice is a conflict.
        assert!(matches!(
            create(&p.conn, None, new_media(&path)),
            Err(AppError::Conflict(_))
        ));
        let dup = NewMediaDocument {
            allow_duplicate: true,
            ..new_media(&path)
        };
        create(&p.conn, None, dup).unwrap();
        assert_eq!(documents::list(&p.conn).unwrap().len(), 2);
    }

    #[test]
    fn create_validates_the_type_the_duration_and_the_file() {
        let p = OpenProject::in_memory("t").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = fake_file(dir.path(), "clip.mp3", 1024, 1);
        let bad_mime = NewMediaDocument {
            mime: "video/avi".into(),
            ..new_media(&path)
        };
        assert!(matches!(
            create(&p.conn, None, bad_mime),
            Err(AppError::Validation(_))
        ));
        let no_duration = NewMediaDocument {
            media: MediaInfo {
                mime: "audio/mpeg".into(),
                duration_ms: None,
                ..Default::default()
            },
            ..new_media(&path)
        };
        assert!(matches!(
            create(&p.conn, None, no_duration),
            Err(AppError::Validation(_))
        ));
        let nameless = NewMediaDocument {
            name: "  ".into(),
            ..new_media(&path)
        };
        assert!(matches!(
            create(&p.conn, None, nameless),
            Err(AppError::Validation(_))
        ));
        let gone = NewMediaDocument {
            source_path: dir.path().join("nope.mp3").to_string_lossy().into_owned(),
            ..new_media(&path)
        };
        assert!(matches!(
            create(&p.conn, None, gone),
            Err(AppError::NotFound(_))
        ));
        assert_eq!(documents::list(&p.conn).unwrap().len(), 0);
    }

    #[test]
    fn copy_into_project_puts_the_file_beside_the_project() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("study.misket");
        let p = OpenProject::create(&project, "study", "test").unwrap();
        let source = fake_file(dir.path(), "tape.wav", 2048, 5);
        let input = NewMediaDocument {
            mime: "audio/wav".into(),
            copy_into_project: true,
            media: MediaInfo {
                mime: "audio/wav".into(),
                duration_ms: Some(1_000),
                ..Default::default()
            },
            ..new_media(&source)
        };
        let d = create(&p.conn, Some(&project), input).unwrap();
        let stored = d.summary.source_path.clone().unwrap();
        assert_eq!(
            Path::new(&stored).parent().unwrap(),
            dir.path().join("study.media")
        );
        assert!(Path::new(&stored).is_file());
        // The original is untouched and the copy is byte-identical.
        assert_eq!(
            std::fs::read(&source).unwrap(),
            std::fs::read(&stored).unwrap()
        );
        // A second file of the same name lands beside it rather than over it.
        let other = fake_file(&dir.path().join("sub"), "tape.wav", 4096, 6);
        let input = NewMediaDocument {
            name: "Second".into(),
            source_path: other.to_string_lossy().into_owned(),
            mime: "audio/wav".into(),
            copy_into_project: true,
            media: MediaInfo {
                mime: "audio/wav".into(),
                duration_ms: Some(2_000),
                ..Default::default()
            },
            allow_duplicate: false,
        };
        let e = create(&p.conn, Some(&project), input).unwrap();
        assert_ne!(e.summary.source_path, d.summary.source_path);
        assert!(e.summary.source_path.unwrap().ends_with("tape (2).wav"));
    }

    #[test]
    fn a_moved_file_is_reported_missing_and_can_be_relinked() {
        let p = OpenProject::in_memory("t").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = fake_file(dir.path(), "interview.mp3", 20_000, 9);
        let id = create(&p.conn, None, new_media(&path)).unwrap().summary.id;
        assert!(missing(&p.conn).unwrap().is_empty());

        let moved = dir.path().join("archive").join("interview.mp3");
        std::fs::create_dir_all(moved.parent().unwrap()).unwrap();
        std::fs::rename(&path, &moved).unwrap();
        let gone = missing(&p.conn).unwrap();
        assert_eq!(gone.len(), 1);
        assert_eq!(gone[0].document_id, id);
        assert!(documents::get_summary(&p.conn, &id).unwrap().media_missing);
        assert!(matches!(source(&p.conn, &id), Err(AppError::NotFound(_))));

        let after = relink(&p.conn, &id, &moved.to_string_lossy()).unwrap();
        assert!(!after.media_missing);
        assert_eq!(
            after.source_path.as_deref(),
            Some(&*moved.to_string_lossy())
        );
        // The duration survives a relink; the waveform does not.
        assert_eq!(after.media.as_ref().unwrap().duration_ms, Some(125_400));
        assert!(after.media.as_ref().unwrap().peaks.is_none());
        assert!(missing(&p.conn).unwrap().is_empty());
        assert!(matches!(source(&p.conn, &id), Ok(Source::File { .. })));

        assert!(matches!(
            relink(&p.conn, &id, &dir.path().join("nope.mp3").to_string_lossy()),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn relink_rejects_a_text_document() {
        let p = OpenProject::in_memory("t").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = fake_file(dir.path(), "x.mp3", 512, 1);
        let text = documents::create(&p.conn, documents::tests::new_doc("hello"))
            .unwrap()
            .summary
            .id;
        assert!(matches!(
            relink(&p.conn, &text, &path.to_string_lossy()),
            Err(AppError::Validation(_))
        ));
        assert!(
            !documents::get_summary(&p.conn, &text)
                .unwrap()
                .media_missing
        );
    }

    #[test]
    fn peaks_are_cached_rounded_and_bounded() {
        let p = OpenProject::in_memory("t").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = fake_file(dir.path(), "a.mp3", 4096, 3);
        let id = create(&p.conn, None, new_media(&path)).unwrap().summary.id;
        let s = set_peaks(&p.conn, &id, &[0.0, 0.126, 1.9, -1.0]).unwrap();
        assert_eq!(
            s.media.as_ref().unwrap().peaks.as_deref(),
            Some(&[0.0, 0.13, 1.0, 0.0][..])
        );
        // Everything else about the recording survives.
        assert_eq!(s.media.as_ref().unwrap().duration_ms, Some(125_400));
        // Clearing them is allowed, an absurd number of them is not.
        assert!(set_peaks(&p.conn, &id, &[])
            .unwrap()
            .media
            .unwrap()
            .peaks
            .is_none());
        assert!(matches!(
            set_peaks(&p.conn, &id, &vec![0.5; 8001]),
            Err(AppError::Validation(_))
        ));
        let text = documents::create(&p.conn, documents::tests::new_doc("hello"))
            .unwrap()
            .summary
            .id;
        assert!(matches!(
            set_peaks(&p.conn, &text, &[0.5]),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn a_thumbnail_belongs_to_a_video_range_and_survives_delete_and_restore() {
        let p = OpenProject::in_memory("t").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = fake_file(dir.path(), "a.mp4", 4096, 4);
        let doc = create(&p.conn, None, new_media(&path)).unwrap().summary.id;
        let code = codes::tests::mk(&p.conn, "A", None).id;
        let e = excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: doc.clone(),
                kind: Some("video_range".into()),
                start_pos: Some(1_000),
                end_pos: Some(4_000),
                code_ids: vec![code],
                ..Default::default()
            },
        )
        .unwrap()
        .excerpt
        .id;
        assert!(thumbnail(&p.conn, &e).unwrap().is_none());
        set_thumbnail(&p.conn, &e, "image/jpeg", b"\xff\xd8fake").unwrap();
        let t = thumbnail(&p.conn, &e).unwrap().unwrap();
        assert_eq!(t.mime, "image/jpeg");
        assert_eq!(t.bytes, b"\xff\xd8fake");
        // Writing again replaces rather than duplicating.
        set_thumbnail(&p.conn, &e, "image/jpeg", b"\xff\xd8other").unwrap();
        assert_eq!(
            thumbnail(&p.conn, &e).unwrap().unwrap().bytes,
            b"\xff\xd8other"
        );

        let snapshot = excerpts::delete(&p.conn, &e).unwrap();
        assert!(thumbnail(&p.conn, &e).unwrap().is_none());
        assert!(snapshot.thumbnail.is_some());
        excerpts::restore(&p.conn, &snapshot).unwrap();
        assert_eq!(
            thumbnail(&p.conn, &e).unwrap().unwrap().bytes,
            b"\xff\xd8other"
        );

        // Only a coded stretch of a recording has a frame.
        let text = documents::create(&p.conn, documents::tests::new_doc("hello world"))
            .unwrap()
            .summary
            .id;
        let te = excerpts::apply_codes(
            &p.conn,
            ApplyCodesInput {
                document_id: text,
                start_pos: Some(0),
                end_pos: Some(5),
                code_ids: vec![],
                ..Default::default()
            },
        )
        .unwrap()
        .excerpt
        .id;
        assert!(matches!(
            set_thumbnail(&p.conn, &te, "image/jpeg", b"x"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            set_thumbnail(&p.conn, "nope", "image/jpeg", b"x"),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            set_thumbnail(&p.conn, &e, "image/jpeg", b""),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn deleting_a_media_document_leaves_the_file_alone() {
        let p = OpenProject::in_memory("t").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = fake_file(dir.path(), "a.mp3", 4096, 4);
        let id = create(&p.conn, None, new_media(&path)).unwrap().summary.id;
        documents::rename(&p.conn, &id, "Renamed").unwrap();
        assert_eq!(
            documents::get_summary(&p.conn, &id).unwrap().name,
            "Renamed"
        );
        documents::delete(&p.conn, &id).unwrap();
        assert!(matches!(
            documents::get(&p.conn, &id),
            Err(AppError::NotFound(_))
        ));
        assert!(path.is_file());
    }

    #[test]
    fn media_dir_is_named_after_the_project() {
        assert_eq!(
            media_dir(Path::new("/data/study.misket")),
            Path::new("/data/study.media")
        );
        assert_eq!(
            media_dir(Path::new("notes.misket")),
            Path::new("notes.media")
        );
    }
}
