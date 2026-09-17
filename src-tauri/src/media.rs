//! The `misket-media://` protocol: media bytes for the webview.
//!
//! Three kinds of thing are served, all by document or excerpt id, never by a
//! path the page could choose:
//!
//! - `/document/<id>` for an image document — the blob stored inside the
//!   project file (`media_blobs`);
//! - `/document/<id>` for an audio or video document — the file on disk at
//!   `documents.source_path`, because a recording is held by reference;
//! - `/thumbnail/<excerptId>` — the frame captured for a coded stretch of
//!   video.
//!
//! A recording is served with **HTTP range support**. WebKit will not let the
//! user seek in a `<video>` or `<audio>` element whose source cannot answer
//! `Range: bytes=…` with a `206` and a `Content-Range`, and reading a
//! gigabyte into memory to answer one seek is not an option either, so a
//! ranged request reads exactly the slice it asked for (up to [`CHUNK`]) off
//! the disk.

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use misket_core::db::media::{self, Source};
use tauri::http::{header, Response, StatusCode};
use tauri::Manager;

use crate::state::AppState;

/// Scheme name registered with Tauri. The webview reaches it at
/// `misket-media://localhost/…` on Linux and macOS and at
/// `http://misket-media.localhost/…` on Windows and Android; `mediaUrl()` in
/// `src/api/media.ts` builds both.
pub const MEDIA_PROTOCOL: &str = "misket-media";

/// The most bytes one response carries. A 206 is allowed to be shorter than
/// what was asked for, and every media element copes with that by asking for
/// the next slice, so this bounds memory no matter how long the recording is.
const CHUNK: u64 = 4 * 1024 * 1024;

/// Above this, a request with no `Range` header at all is answered with the
/// first [`CHUNK`] as a 206 rather than the whole file, which nudges the
/// client into ranged requests instead of loading gigabytes into memory.
const MAX_WHOLE: u64 = 16 * 1024 * 1024;

/// What a `Range` header asks for, resolved against the resource's length.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangeRequest {
    /// Send the whole resource (no header, or one we do not understand).
    Whole,
    /// Inclusive byte offsets, clamped to the resource.
    Partial { start: u64, end: u64 },
    /// The header named a range outside the resource: `416`.
    Unsatisfiable,
}

/// Resolve a `Range` header against a resource of `len` bytes.
///
/// Only the single-range `bytes=` form is understood, which is the only form
/// a media element sends. Anything else — several ranges, another unit, a
/// malformed value — is treated as no header at all, as the HTTP spec allows,
/// rather than as an error the user would see as a broken player.
pub fn parse_range(value: Option<&str>, len: u64) -> RangeRequest {
    let Some(raw) = value else {
        return RangeRequest::Whole;
    };
    let Some(spec) = raw.trim().strip_prefix("bytes=") else {
        return RangeRequest::Whole;
    };
    let spec = spec.trim();
    if spec.contains(',') {
        return RangeRequest::Whole;
    }
    let Some((from, to)) = spec.split_once('-') else {
        return RangeRequest::Whole;
    };
    let (from, to) = (from.trim(), to.trim());
    let parse = |s: &str| s.parse::<u64>().ok();

    let (start, end) = if from.is_empty() {
        // A suffix range: `bytes=-500` is the last 500 bytes.
        let Some(n) = parse(to).filter(|n| *n > 0) else {
            return RangeRequest::Whole;
        };
        if len == 0 {
            return RangeRequest::Unsatisfiable;
        }
        (len.saturating_sub(n.min(len)), len - 1)
    } else {
        let Some(start) = parse(from) else {
            return RangeRequest::Whole;
        };
        if start >= len {
            return RangeRequest::Unsatisfiable;
        }
        let end = if to.is_empty() {
            len - 1
        } else {
            match parse(to) {
                Some(e) if e >= start => e.min(len - 1),
                // `bytes=500-100` is nonsense, not a range.
                Some(_) => return RangeRequest::Unsatisfiable,
                None => return RangeRequest::Whole,
            }
        };
        (start, end)
    };
    // Never promise more than one chunk; the client asks again for the rest.
    RangeRequest::Partial {
        start,
        end: end.min(start + CHUNK - 1),
    }
}

/// The slice of `path` that `range` asks for, read straight off the disk.
fn read_slice(path: &Path, start: u64, end: u64) -> std::io::Result<Vec<u8>> {
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::Start(start))?;
    let want = (end - start + 1) as usize;
    let mut buf = vec![0u8; want];
    let mut filled = 0;
    while filled < want {
        match f.read(&mut buf[filled..])? {
            0 => break,
            n => filled += n,
        }
    }
    buf.truncate(filled);
    Ok(buf)
}

fn fail(status: StatusCode, message: String) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::ACCEPT_RANGES, "bytes")
        .body(message.into_bytes())
        .expect("static response")
}

fn unsatisfiable(len: u64) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::RANGE_NOT_SATISFIABLE)
        .header(header::CONTENT_RANGE, format!("bytes */{len}"))
        .header(header::ACCEPT_RANGES, "bytes")
        .body(Vec::new())
        .expect("static response")
}

/// Build the 200 or 206 for a resource whose bytes are already in hand.
fn serve(
    mime: &str,
    len: u64,
    range: RangeRequest,
    cache: &str,
    read: impl FnOnce(u64, u64) -> std::io::Result<Vec<u8>>,
) -> Response<Vec<u8>> {
    let whole = |range: RangeRequest| match range {
        RangeRequest::Whole if len <= MAX_WHOLE => None,
        RangeRequest::Whole => Some((0, (len.max(1) - 1).min(CHUNK - 1))),
        RangeRequest::Partial { start, end } => Some((start, end)),
        RangeRequest::Unsatisfiable => None,
    };
    if range == RangeRequest::Unsatisfiable {
        return unsatisfiable(len);
    }
    let base = |builder: tauri::http::response::Builder| {
        builder
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CACHE_CONTROL, cache)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
    };
    match whole(range) {
        None => match read(0, len.max(1) - 1) {
            Ok(bytes) => base(Response::builder())
                .header(header::CONTENT_LENGTH, bytes.len())
                .body(bytes)
                .expect("media response"),
            Err(e) => fail(StatusCode::NOT_FOUND, e.to_string()),
        },
        Some((start, end)) => match read(start, end) {
            Ok(bytes) => {
                let last = start + bytes.len() as u64 - 1;
                base(Response::builder())
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_LENGTH, bytes.len())
                    .header(header::CONTENT_RANGE, format!("bytes {start}-{last}/{len}"))
                    .body(bytes)
                    .expect("media response")
            }
            Err(e) => fail(StatusCode::NOT_FOUND, e.to_string()),
        },
    }
}

/// Answer one `misket-media://` request.
pub fn response<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
    range_header: Option<&str>,
) -> Response<Vec<u8>> {
    let state = app.state::<AppState>();
    let source = if let Some(id) = path.strip_prefix("/document/").filter(|s| !s.is_empty()) {
        state.with_project(|p| media::source(&p.conn, id))
    } else if let Some(id) = path.strip_prefix("/thumbnail/").filter(|s| !s.is_empty()) {
        state.with_project(|p| media::thumbnail_source(&p.conn, id))
    } else {
        return fail(
            StatusCode::BAD_REQUEST,
            format!("expected /document/<id> or /thumbnail/<id>, got {path}"),
        );
    };
    match source {
        // Bytes inside the project file are immutable once imported and keyed
        // by a UUID, so they can be cached for as long as the webview lives.
        Ok(Source::Blob { mime, bytes }) => {
            let len = bytes.len() as u64;
            serve(
                &mime,
                len,
                parse_range(range_header, len),
                "private, max-age=31536000, immutable",
                move |start, end| {
                    if len == 0 {
                        return Ok(Vec::new());
                    }
                    Ok(bytes[start as usize..=(end as usize).min(bytes.len() - 1)].to_vec())
                },
            )
        }
        // A referenced file can be relinked under the same id, so it must not
        // be cached across that.
        Ok(Source::File { mime, path }) => {
            let len = match std::fs::metadata(&path) {
                Ok(m) => m.len(),
                Err(e) => return fail(StatusCode::NOT_FOUND, e.to_string()),
            };
            serve(
                &mime,
                len,
                parse_range(range_header, len),
                "private, no-cache",
                move |start, end| {
                    if len == 0 {
                        return Ok(Vec::new());
                    }
                    read_slice(&path, start, end)
                },
            )
        }
        Err(e) => fail(StatusCode::NOT_FOUND, e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KB: u64 = 1024;

    #[test]
    fn no_header_or_an_unusable_one_means_the_whole_resource() {
        for value in [
            None,
            Some("bytes="),
            Some("bytes=abc-def"),
            Some("items=0-10"),
            Some("bytes=0-5, 10-20"),
            Some("nonsense"),
        ] {
            assert_eq!(parse_range(value, 4 * KB), RangeRequest::Whole, "{value:?}");
        }
    }

    #[test]
    fn explicit_offsets_are_inclusive_and_clamped() {
        assert_eq!(
            parse_range(Some("bytes=0-99"), 4 * KB),
            RangeRequest::Partial { start: 0, end: 99 }
        );
        assert_eq!(
            parse_range(Some("bytes=100-199"), 4 * KB),
            RangeRequest::Partial {
                start: 100,
                end: 199
            }
        );
        // An open-ended range runs to the last byte.
        assert_eq!(
            parse_range(Some("bytes=4000-"), 4 * KB),
            RangeRequest::Partial {
                start: 4000,
                end: 4095
            }
        );
        // An end past the resource is clamped, not refused.
        assert_eq!(
            parse_range(Some("bytes=4000-99999"), 4 * KB),
            RangeRequest::Partial {
                start: 4000,
                end: 4095
            }
        );
        // Whitespace around the value is tolerated.
        assert_eq!(
            parse_range(Some(" bytes=0-1 "), 4 * KB),
            RangeRequest::Partial { start: 0, end: 1 }
        );
    }

    #[test]
    fn a_suffix_range_counts_back_from_the_end() {
        assert_eq!(
            parse_range(Some("bytes=-500"), 4 * KB),
            RangeRequest::Partial {
                start: 3596,
                end: 4095
            }
        );
        // Asking for more than there is gives everything there is.
        assert_eq!(
            parse_range(Some("bytes=-99999"), 4 * KB),
            RangeRequest::Partial {
                start: 0,
                end: 4095
            }
        );
        // `bytes=-0` asks for nothing, which is not a range.
        assert_eq!(parse_range(Some("bytes=-0"), 4 * KB), RangeRequest::Whole);
    }

    #[test]
    fn a_range_outside_the_resource_is_unsatisfiable() {
        assert_eq!(
            parse_range(Some("bytes=4096-"), 4 * KB),
            RangeRequest::Unsatisfiable
        );
        assert_eq!(
            parse_range(Some("bytes=99999-100000"), 4 * KB),
            RangeRequest::Unsatisfiable
        );
        // An inverted range is a mistake, not "the whole thing".
        assert_eq!(
            parse_range(Some("bytes=500-100"), 4 * KB),
            RangeRequest::Unsatisfiable
        );
        // Nothing can be served out of an empty resource.
        assert_eq!(
            parse_range(Some("bytes=0-10"), 0),
            RangeRequest::Unsatisfiable
        );
        assert_eq!(
            parse_range(Some("bytes=-10"), 0),
            RangeRequest::Unsatisfiable
        );
    }

    #[test]
    fn one_response_never_carries_more_than_a_chunk() {
        let len = 64 * 1024 * 1024;
        assert_eq!(
            parse_range(Some("bytes=0-"), len),
            RangeRequest::Partial {
                start: 0,
                end: CHUNK - 1
            }
        );
        assert_eq!(
            parse_range(Some("bytes=1000-99999999"), len),
            RangeRequest::Partial {
                start: 1000,
                end: 1000 + CHUNK - 1
            }
        );
    }

    #[test]
    fn a_slice_is_read_straight_off_the_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.bin");
        let bytes: Vec<u8> = (0..=255u8).collect();
        std::fs::write(&path, &bytes).unwrap();
        assert_eq!(read_slice(&path, 0, 3).unwrap(), [0, 1, 2, 3]);
        assert_eq!(
            read_slice(&path, 250, 255).unwrap(),
            [250, 251, 252, 253, 254, 255]
        );
        // A slice that runs off the end comes back short rather than failing.
        assert_eq!(read_slice(&path, 254, 300).unwrap(), [254, 255]);
    }
}
