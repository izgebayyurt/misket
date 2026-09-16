//! Documents: imported text (milestone 1) and, later, images and video.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::json;

use super::{activity, text, util};
use crate::error::{AppError, Result};
use crate::models::{Document, DocumentSummary, MediaInfo, NewDocument, NewImageDocument};

const SUMMARY_COLUMNS: &str =
    "d.id, d.kind, d.name, d.source_path, d.source_format, d.text_length, d.media_json, d.sort_order,
     (SELECT count(*) FROM excerpts e WHERE e.document_id = d.id) AS excerpt_count,
     d.created_at, d.updated_at";

/// The image types Misket imports, with the `source_format` recorded for each.
pub const IMAGE_MIMES: [(&str, &str); 3] = [
    ("image/png", "png"),
    ("image/jpeg", "jpeg"),
    ("image/webp", "webp"),
];

fn summary_from_row(r: &Row) -> rusqlite::Result<DocumentSummary> {
    let media_json: Option<String> = r.get(6)?;
    Ok(DocumentSummary {
        id: r.get(0)?,
        kind: r.get(1)?,
        name: r.get(2)?,
        source_path: r.get(3)?,
        source_format: r.get(4)?,
        text_length: r.get(5)?,
        // A media_json we cannot parse (written by a newer build) is simply
        // not reported rather than failing the whole listing.
        media: media_json.and_then(|j| serde_json::from_str(&j).ok()),
        sort_order: r.get(7)?,
        excerpt_count: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

/// Import a text document. The text is normalized and hashed; a document with
/// the same hash already in the project is a `Conflict` unless
/// `allow_duplicate` is set.
pub fn create(conn: &Connection, input: NewDocument) -> Result<Document> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("document name is required".into()));
    }
    let text = text::normalize(&input.text);
    let hash = text::sha256_hex(text.as_bytes());
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
    let id = util::new_id();
    let now = util::now();
    let sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM documents",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO documents (id, kind, name, source_path, source_format, content_hash, text, text_length, sort_order, created_at, updated_at)
         VALUES (?1, 'text', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            id,
            name,
            input.source_path,
            input.source_format,
            hash,
            text,
            text::cp_len(&text),
            sort_order,
            now
        ],
    )?;
    let doc = get(conn, &id)?;
    log_import(conn, &doc.summary)?;
    Ok(doc)
}

/// One entry per imported document, whatever its kind.
fn log_import(conn: &Connection, doc: &DocumentSummary) -> Result<()> {
    activity::record(
        conn,
        "document.imported",
        "document",
        Some(&doc.id),
        format!("Imported {} document \"{}\"", doc.kind, doc.name),
        json!({
            "name": doc.name,
            "documentKind": doc.kind,
            "sourceFormat": doc.source_format,
            "sourcePath": doc.source_path,
            "textLength": doc.text_length,
        }),
    )
}

/// Import an image document. The bytes are stored inside the project file
/// (`media_blobs`) so the project stays self-contained, hashed like text so
/// re-importing the same file is a `Conflict` unless `allow_duplicate` is set.
/// When `bytes` is absent they are read from `source_path`.
pub fn create_image(conn: &Connection, input: NewImageDocument) -> Result<Document> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("document name is required".into()));
    }
    let mime = input.mime.trim().to_ascii_lowercase();
    let format = IMAGE_MIMES
        .iter()
        .find(|(m, _)| *m == mime)
        .map(|(_, f)| *f)
        .ok_or_else(|| {
            AppError::Validation(format!(
                "unsupported image type {:?}; Misket reads PNG, JPEG and WebP",
                input.mime
            ))
        })?;
    if input.width <= 0 || input.height <= 0 {
        return Err(AppError::Validation(
            "the image size could not be read".into(),
        ));
    }
    let bytes = match input.bytes {
        Some(b) => b,
        None => match input.source_path.as_deref() {
            Some(path) => std::fs::read(path)?,
            None => {
                return Err(AppError::Validation(
                    "image bytes or a source path are required".into(),
                ))
            }
        },
    };
    if bytes.is_empty() {
        return Err(AppError::Validation("the image file is empty".into()));
    }
    let hash = text::sha256_hex(&bytes);
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
    let media = serde_json::to_string(&MediaInfo {
        width: input.width,
        height: input.height,
        mime: mime.clone(),
    })?;
    let id = util::new_id();
    let now = util::now();
    let sort_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM documents",
        [],
        |r| r.get(0),
    )?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO documents (id, kind, name, source_path, source_format, content_hash, media_json, sort_order, created_at, updated_at)
         VALUES (?1, 'image', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            name,
            input.source_path,
            format,
            hash,
            media,
            sort_order,
            now
        ],
    )?;
    tx.execute(
        "INSERT INTO media_blobs (document_id, mime, bytes) VALUES (?1, ?2, ?3)",
        params![id, mime, bytes],
    )?;
    log_import(&tx, &get_summary(&tx, &id)?)?;
    tx.commit()?;
    get(conn, &id)
}

/// The stored bytes of a media document, with their MIME type.
pub fn get_media(conn: &Connection, id: &str) -> Result<(String, Vec<u8>)> {
    conn.query_row(
        "SELECT mime, bytes FROM media_blobs WHERE document_id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("document {id} has no media")))
}

pub fn list(conn: &Connection) -> Result<Vec<DocumentSummary>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SUMMARY_COLUMNS} FROM documents d ORDER BY d.sort_order, d.created_at"
    ))?;
    let rows = stmt.query_map([], summary_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get_summary(conn: &Connection, id: &str) -> Result<DocumentSummary> {
    conn.query_row(
        &format!("SELECT {SUMMARY_COLUMNS} FROM documents d WHERE d.id = ?1"),
        [id],
        summary_from_row,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("document {id} not found")))
}

pub fn get(conn: &Connection, id: &str) -> Result<Document> {
    let summary = get_summary(conn, id)?;
    let text: Option<String> =
        conn.query_row("SELECT text FROM documents WHERE id = ?1", [id], |r| {
            r.get(0)
        })?;
    Ok(Document { summary, text })
}

pub fn get_text(conn: &Connection, id: &str) -> Result<(String, i64)> {
    conn.query_row(
        "SELECT text, text_length FROM documents WHERE id = ?1 AND kind = 'text'",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("text document {id} not found")))
}

pub fn rename(conn: &Connection, id: &str, name: &str) -> Result<DocumentSummary> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("document name is required".into()));
    }
    let before = get_summary(conn, id)?;
    let n = conn.execute(
        "UPDATE documents SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name, util::now()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("document {id} not found")));
    }
    if before.name != name {
        activity::record(
            conn,
            "document.renamed",
            "document",
            Some(id),
            format!("Renamed document \"{}\" to \"{name}\"", before.name),
            json!({ "name": activity::change(before.name.clone(), name.to_string()) }),
        )?;
    }
    get_summary(conn, id)
}

/// Reorder documents; ids not mentioned keep their relative order after the listed ones.
pub fn reorder(conn: &Connection, ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let existing = list(&tx)?;
    let mut order: Vec<String> = ids.to_vec();
    for d in existing {
        if !order.contains(&d.id) {
            order.push(d.id);
        }
    }
    for (i, id) in order.iter().enumerate() {
        tx.execute(
            "UPDATE documents SET sort_order = ?2 WHERE id = ?1",
            params![id, i as i64],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    let doc = get_summary(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    let n = tx.execute("DELETE FROM documents WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(AppError::NotFound(format!("document {id} not found")));
    }
    activity::record(
        &tx,
        "document.deleted",
        "document",
        Some(id),
        format!("Deleted document \"{}\"", doc.name),
        json!({
            "name": doc.name,
            "documentKind": doc.kind,
            "excerptCount": doc.excerpt_count,
        }),
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::OpenProject;

    pub(crate) fn new_image(bytes: &[u8]) -> NewImageDocument {
        NewImageDocument {
            name: "Poster".into(),
            source_path: Some("/somewhere/poster.png".into()),
            mime: "image/png".into(),
            width: 800,
            height: 600,
            bytes: Some(bytes.to_vec()),
            allow_duplicate: false,
        }
    }

    pub(crate) fn new_doc(text: &str) -> NewDocument {
        NewDocument {
            name: "Interview 1".into(),
            source_path: None,
            source_format: "txt".into(),
            text: text.into(),
            allow_duplicate: false,
        }
    }

    #[test]
    fn create_normalizes_hashes_and_counts_code_points() {
        let p = OpenProject::in_memory("t").unwrap();
        let d = create(&p.conn, new_doc("\u{FEFF}héllo\r\n😀")).unwrap();
        assert_eq!(d.text.as_deref(), Some("héllo\n😀"));
        assert_eq!(d.summary.text_length, Some(7));
        assert_eq!(d.summary.kind, "text");
        assert_eq!(d.summary.excerpt_count, 0);
        assert_eq!(list(&p.conn).unwrap().len(), 1);
    }

    #[test]
    fn duplicate_content_is_a_conflict_unless_allowed() {
        let p = OpenProject::in_memory("t").unwrap();
        create(&p.conn, new_doc("same")).unwrap();
        assert!(matches!(
            create(&p.conn, new_doc("same")),
            Err(AppError::Conflict(_))
        ));
        let mut again = new_doc("same");
        again.allow_duplicate = true;
        create(&p.conn, again).unwrap();
        assert_eq!(list(&p.conn).unwrap().len(), 2);
    }

    #[test]
    fn rename_reorder_delete() {
        let p = OpenProject::in_memory("t").unwrap();
        let a = create(&p.conn, new_doc("a")).unwrap().summary.id;
        let b = create(&p.conn, new_doc("b")).unwrap().summary.id;
        let c = create(&p.conn, new_doc("c")).unwrap().summary.id;
        rename(&p.conn, &a, "  Renamed ").unwrap();
        assert_eq!(get_summary(&p.conn, &a).unwrap().name, "Renamed");
        assert!(matches!(
            rename(&p.conn, &a, " "),
            Err(AppError::Validation(_))
        ));
        reorder(&p.conn, &[c.clone(), a.clone()]).unwrap();
        let ids: Vec<_> = list(&p.conn).unwrap().into_iter().map(|d| d.id).collect();
        assert_eq!(ids, vec![c.clone(), a.clone(), b.clone()]);
        delete(&p.conn, &b).unwrap();
        assert!(matches!(delete(&p.conn, &b), Err(AppError::NotFound(_))));
        assert_eq!(list(&p.conn).unwrap().len(), 2);
        assert!(matches!(get(&p.conn, &b), Err(AppError::NotFound(_))));
    }

    #[test]
    fn create_image_stores_bytes_media_and_hash() {
        let p = OpenProject::in_memory("t").unwrap();
        let d = create_image(&p.conn, new_image(b"\x89PNG fake bytes")).unwrap();
        assert_eq!(d.summary.kind, "image");
        assert_eq!(d.summary.source_format.as_deref(), Some("png"));
        assert_eq!(d.summary.text_length, None);
        assert!(d.text.is_none());
        let media = d.summary.media.clone().unwrap();
        assert_eq!((media.width, media.height), (800, 600));
        assert_eq!(media.mime, "image/png");
        assert_eq!(
            d.summary.source_path.as_deref(),
            Some("/somewhere/poster.png")
        );
        let (mime, bytes) = get_media(&p.conn, &d.summary.id).unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, b"\x89PNG fake bytes");
        // Hashed like text, so the same file twice is a conflict.
        assert!(matches!(
            create_image(&p.conn, new_image(b"\x89PNG fake bytes")),
            Err(AppError::Conflict(_))
        ));
        let mut again = new_image(b"\x89PNG fake bytes");
        again.allow_duplicate = true;
        create_image(&p.conn, again).unwrap();
        assert_eq!(list(&p.conn).unwrap().len(), 2);
        // Images show up in the normal listing with their media.
        assert!(list(&p.conn).unwrap()[0].media.is_some());
    }

    #[test]
    fn create_image_validates_type_size_and_bytes() {
        let p = OpenProject::in_memory("t").unwrap();
        let bad_mime = NewImageDocument {
            mime: "image/gif".into(),
            ..new_image(b"x")
        };
        assert!(matches!(
            create_image(&p.conn, bad_mime),
            Err(AppError::Validation(_))
        ));
        let no_size = NewImageDocument {
            height: 0,
            ..new_image(b"x")
        };
        assert!(matches!(
            create_image(&p.conn, no_size),
            Err(AppError::Validation(_))
        ));
        let empty = NewImageDocument {
            bytes: Some(vec![]),
            ..new_image(b"x")
        };
        assert!(matches!(
            create_image(&p.conn, empty),
            Err(AppError::Validation(_))
        ));
        let nameless = NewImageDocument {
            name: "  ".into(),
            ..new_image(b"x")
        };
        assert!(matches!(
            create_image(&p.conn, nameless),
            Err(AppError::Validation(_))
        ));
        let nothing = NewImageDocument {
            bytes: None,
            source_path: None,
            ..new_image(b"x")
        };
        assert!(matches!(
            create_image(&p.conn, nothing),
            Err(AppError::Validation(_))
        ));
        assert_eq!(list(&p.conn).unwrap().len(), 0);
    }

    #[test]
    fn create_image_reads_the_file_when_bytes_are_absent() {
        let p = OpenProject::in_memory("t").unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shot.webp");
        std::fs::write(&path, b"RIFFfake").unwrap();
        let d = create_image(
            &p.conn,
            NewImageDocument {
                name: "Shot".into(),
                source_path: Some(path.to_string_lossy().into_owned()),
                mime: "image/webp".into(),
                width: 10,
                height: 20,
                bytes: None,
                allow_duplicate: false,
            },
        )
        .unwrap();
        assert_eq!(d.summary.source_format.as_deref(), Some("webp"));
        assert_eq!(get_media(&p.conn, &d.summary.id).unwrap().1, b"RIFFfake");
        // A missing file is an Io error, not a panic.
        assert!(matches!(
            create_image(
                &p.conn,
                NewImageDocument {
                    source_path: Some(dir.path().join("gone.png").to_string_lossy().into_owned()),
                    bytes: None,
                    ..new_image(b"x")
                }
            ),
            Err(AppError::Io(_))
        ));
    }

    #[test]
    fn deleting_an_image_document_drops_its_blob() {
        let p = OpenProject::in_memory("t").unwrap();
        let id = create_image(&p.conn, new_image(b"bytes"))
            .unwrap()
            .summary
            .id;
        delete(&p.conn, &id).unwrap();
        assert!(matches!(
            get_media(&p.conn, &id),
            Err(AppError::NotFound(_))
        ));
        let n: i64 = p
            .conn
            .query_row("SELECT count(*) FROM media_blobs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn get_text_rejects_an_image_document() {
        let p = OpenProject::in_memory("t").unwrap();
        let id = create_image(&p.conn, new_image(b"bytes"))
            .unwrap()
            .summary
            .id;
        assert!(matches!(get_text(&p.conn, &id), Err(AppError::NotFound(_))));
    }
}
