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
//!   video;
//! - `/probe/<token>` — a file the user has just picked in the import dialog,
//!   staged in `AppState` so the webview can measure its duration before it
//!   becomes a document. The page hands over a token, never a path.
//!
//! A recording is served with **HTTP range support**. WebKit will not let the
//! user seek in a `<video>` or `<audio>` element whose source cannot answer
//! `Range: bytes=…` with a `206` and a `Content-Range`, and reading a
//! gigabyte into memory to answer one seek is not an option either, so a
//! ranged request reads exactly the slice it asked for (up to [`CHUNK`]) off
//! the disk.
//!
//! # Why a recording also needs a loopback HTTP server
//!
//! An `<img>` loads happily from a custom scheme, but a media element does
//! not: on Linux WebKitGTK hands playback to GStreamer, which only knows a
//! handful of URI schemes, and `misket-media://`, Tauri's own `asset://` and
//! plain `file://` are all refused with `MEDIA_ERR_SRC_NOT_SUPPORTED`
//! (measured, not guessed — see `e2e/`). A `blob:` URL works, but building
//! one means holding the whole recording in the page's memory, which is the
//! very thing holding media by reference exists to avoid.
//!
//! So [`Server`] binds a listener on `127.0.0.1` with an ephemeral port and
//! serves the same three routes over HTTP/1.1, which GStreamer streams and
//! seeks in natively. It answers only requests carrying the random token
//! minted for this run of the app, it never leaves the loopback interface,
//! and it stops with the process.

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
    } else if let Some(token) = path.strip_prefix("/probe/").filter(|s| !s.is_empty()) {
        match state.probe_path(token) {
            Some(file) => Ok(Source::File {
                mime: media::mime_for_path(&file)
                    .unwrap_or("application/octet-stream")
                    .to_string(),
                path: file,
            }),
            None => Err(misket_core::AppError::NotFound(
                "that file is no longer staged for import".into(),
            )),
        }
    } else {
        return fail(
            StatusCode::BAD_REQUEST,
            format!("expected /document/<id>, /thumbnail/<id> or /probe/<token>, got {path}"),
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

/// A URL-decoded percent escape (`%2F` and friends) in a request target.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Split a request target into its path and the value of its `t` parameter.
fn split_target(target: &str) -> (String, Option<String>) {
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (target, None),
    };
    let token = query.and_then(|q| {
        q.split('&')
            .filter_map(|pair| pair.split_once('='))
            .find(|(k, _)| *k == "t")
            .map(|(_, v)| percent_decode(v))
    });
    (percent_decode(path), token)
}

/// Whether two tokens match, without leaking where they first differ.
fn token_matches(given: Option<&str>, expected: &str) -> bool {
    let Some(given) = given else { return false };
    if given.len() != expected.len() {
        return false;
    }
    given
        .bytes()
        .zip(expected.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

/// The loopback HTTP server a media element can actually play from.
///
/// Its `origin` is what the frontend builds URLs against; the token is part
/// of it, so a URL that leaves the app is useless once the app has quit.
pub struct Server {
    pub port: u16,
    pub token: String,
}

impl Server {
    /// `http://127.0.0.1:<port>`, with no trailing slash.
    pub fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}

/// How long a connection may take to send its request line and headers.
const HEADER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// The most bytes of request head to read before giving up on a client.
const MAX_HEAD: usize = 16 * 1024;

/// Bind the loopback server and answer requests on it until the app exits.
///
/// Binding port 0 asks the OS for a free one, so two copies of Misket never
/// fight over it. Each connection is answered on its own thread and closed
/// again: a media element makes many short ranged requests, and over loopback
/// a fresh connection costs nothing worth keeping alive for.
pub fn serve_on_loopback<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> std::io::Result<Server> {
    use std::net::TcpListener;

    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let token = misket_core::db::util::new_id();
    let expected = token.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let app = app.clone();
            let expected = expected.clone();
            std::thread::spawn(move || {
                let _ = answer(&app, stream, &expected);
            });
        }
    });
    Ok(Server { port, token })
}

/// Read one request off `stream` and write one response back.
fn answer<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    mut stream: std::net::TcpStream,
    expected: &str,
) -> std::io::Result<()> {
    use std::io::Write;

    stream.set_read_timeout(Some(HEADER_TIMEOUT))?;
    let mut head = Vec::with_capacity(1024);
    let mut byte = [0u8; 1];
    // Read up to the blank line that ends the head; the body (there is never
    // one for GET or HEAD) is left unread.
    while !head.ends_with(b"\r\n\r\n") && !head.ends_with(b"\n\n") {
        match stream.read(&mut byte)? {
            0 => break,
            _ => head.push(byte[0]),
        }
        if head.len() > MAX_HEAD {
            return write_head(&mut stream, StatusCode::BAD_REQUEST, &[], 0).map(|_| ());
        }
    }
    let head = String::from_utf8_lossy(&head).into_owned();
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_ascii_uppercase();
    let target = parts.next().unwrap_or("/");
    let mut range: Option<String> = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("range") {
                range = Some(value.trim().to_string());
            }
        }
    }

    // A ranged `fetch` from the page is a cross-origin request with a
    // non-simple header, so the browser asks first.
    if method == "OPTIONS" {
        return write_head(
            &mut stream,
            StatusCode::NO_CONTENT,
            &[
                ("access-control-allow-origin", "*".into()),
                ("access-control-allow-methods", "GET, HEAD, OPTIONS".into()),
                ("access-control-allow-headers", "range".into()),
                ("access-control-max-age", "86400".into()),
            ],
            0,
        )
        .map(|_| ());
    }
    if method != "GET" && method != "HEAD" {
        return write_head(&mut stream, StatusCode::METHOD_NOT_ALLOWED, &[], 0).map(|_| ());
    }

    let (path, given) = split_target(target);
    if !token_matches(given.as_deref(), expected) {
        // No explanation: a request without this run's token is not ours.
        return write_head(&mut stream, StatusCode::FORBIDDEN, &[], 0).map(|_| ());
    }

    let response = response(app, &path, range.as_deref());
    let status = response.status();
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|v| (k.as_str().to_string(), v.to_string()))
        })
        .collect();
    let mut extra: Vec<(&str, String)> = headers
        .iter()
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect();
    // So a ranged `fetch` from the page can read what it got.
    extra.push((
        "access-control-expose-headers",
        "content-range, content-length, accept-ranges, content-type".into(),
    ));
    let body = response.body();
    write_head(&mut stream, status, &extra, body.len())?;
    if method == "GET" {
        stream.write_all(body)?;
    }
    stream.flush()
}

/// Write a status line and headers, then `Connection: close`.
fn write_head(
    stream: &mut std::net::TcpStream,
    status: StatusCode,
    headers: &[(&str, String)],
    body_len: usize,
) -> std::io::Result<()> {
    use std::io::Write;

    let reason = status.canonical_reason().unwrap_or("");
    let mut out = format!("HTTP/1.1 {} {reason}\r\n", status.as_u16());
    let mut wrote_length = false;
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("content-length") {
            wrote_length = true;
        }
        out.push_str(&format!("{name}: {value}\r\n"));
    }
    if !wrote_length {
        out.push_str(&format!("content-length: {body_len}\r\n"));
    }
    out.push_str("connection: close\r\n\r\n");
    stream.write_all(out.as_bytes())
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
    fn a_request_target_gives_up_its_path_and_token() {
        assert_eq!(
            split_target("/document/abc?t=xyz"),
            ("/document/abc".into(), Some("xyz".into()))
        );
        assert_eq!(
            split_target("/document/abc"),
            ("/document/abc".into(), None)
        );
        // Anything percent-escaped comes back decoded, in the path and the
        // token alike.
        assert_eq!(
            split_target("/thumbnail/a%2Fb?x=1&t=a%20b"),
            ("/thumbnail/a/b".into(), Some("a b".into()))
        );
        // A malformed escape is left alone rather than dropped.
        assert_eq!(split_target("/a%zz"), ("/a%zz".into(), None));
    }

    #[test]
    fn only_this_runs_token_is_accepted() {
        assert!(token_matches(Some("abc"), "abc"));
        assert!(!token_matches(Some("abd"), "abc"));
        assert!(!token_matches(Some("ab"), "abc"));
        assert!(!token_matches(Some(""), "abc"));
        assert!(!token_matches(None, "abc"));
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
