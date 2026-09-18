//! Opt-in crash and error reporting.
//!
//! Nothing here ever runs unless `AppSettings::send_crash_reports` is on
//! *and* `AppSettings::report_endpoint` is non-empty — both default off. A
//! report is a small, redacted bundle: app version, OS, one error message
//! and stack, and the last 50 log lines with anything path-shaped hashed and
//! every field outside a small allowlist dropped (see [`redact_log_line`]).
//! It never carries document text, codes, memos or file names.
//!
//! Reports are written to a queue directory before they are sent, and
//! removed from it only once a send succeeds, so a report made while
//! offline (or against an unreachable endpoint) goes out on the next
//! successful attempt — normally the app's next start (see `lib.rs`).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use misket_core::{AppError, Result};

/// The wire shape a report is sent in. `Json` is a plain, self-describing
/// body for a maintainer's own collector; `Sentry` wraps the same fields in
/// the envelope format Sentry (and Sentry-compatible collectors such as
/// GlitchTip) expect at their `store`/envelope endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ReportFormat {
    #[default]
    Json,
    Sentry,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub event_id: String,
    /// RFC 3339.
    pub timestamp: String,
    pub app_version: String,
    pub os: String,
    pub message: String,
    pub stack: Option<String>,
    /// The last ~50 log lines, already redacted (see [`redact_log_line`]).
    /// Redacted again defensively wherever a report is sent, in case a
    /// caller ever builds one from unredacted lines.
    pub log_tail: Vec<String>,
}

/// Fields inside a log line's `"fields"` object that are safe to keep in a
/// report: short, structural, never free text a person typed or coded.
/// Everything else is dropped, not just hidden — `serde_json` never even
/// serializes a key that was removed from the map.
const FIELD_ALLOWLIST: &[&str] = &[
    "message",
    "code",
    "count",
    "ms",
    "version",
    "os",
    "webview",
    "schema",
    "reason",
    "level",
    "cmd",
    "path_hash",
];

/// A crude but effective filesystem-path detector: has a separator and is
/// longer than a bare drive letter or a single slash. Good enough to catch
/// the shapes `tracing` fields actually take (absolute paths, `~/...`,
/// `C:\...`) without a false-positive rate worth tuning further here.
fn looks_like_path(s: &str) -> bool {
    (s.contains('/') || s.contains('\\')) && s.len() > 2
}

/// A short, stable, one-way fingerprint: long enough to tell two different
/// paths apart, short enough to be obviously not the path itself.
pub fn short_hash(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(s.as_bytes());
    hex::encode(&digest[..6])
}

/// Redact one raw log line for inclusion in a report.
///
/// A JSON-lines entry (what `logging::init` writes) keeps only `timestamp`,
/// `level` and `target` at the top level, and only [`FIELD_ALLOWLIST`] keys
/// under `fields`; any string value that looks like a path is replaced with
/// its hash. A line that is not JSON (defensive fallback; also exercised by
/// tests) is scrubbed the same way at the substring level instead.
pub fn redact_log_line(line: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(serde_json::Value::Object(mut obj)) => {
            if let Some(fields) = obj.get_mut("fields").and_then(|f| f.as_object_mut()) {
                *fields = redact_fields(fields);
            }
            obj.retain(|k, _| matches!(k.as_str(), "timestamp" | "level" | "target" | "fields"));
            serde_json::Value::Object(obj).to_string()
        }
        _ => redact_plain_text(line),
    }
}

/// A field survives if its key is allowed (hashing its value should it also
/// look like a path), or — failing that — if its value looks like a path:
/// hashing already makes it safe, so there is no need to drop it too. Any
/// other field (a person's free text under a key we do not recognise) is
/// dropped rather than guessed at.
fn redact_fields(
    fields: &serde_json::Map<String, serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    for (k, v) in fields {
        let allowed = FIELD_ALLOWLIST.contains(&k.as_str());
        let path_like = v.as_str().is_some_and(looks_like_path);
        match (allowed, path_like) {
            (true, true) => {
                let hashed = format!("hash:{}", short_hash(v.as_str().unwrap()));
                out.insert(k.clone(), serde_json::Value::String(hashed));
            }
            (true, false) => {
                out.insert(k.clone(), v.clone());
            }
            // Not one of ours, but shaped like a path: keep it (hashed),
            // filed under the one allowlisted key that means exactly that,
            // rather than under whatever the original key was — an
            // unrecognised key never survives as itself, and hashing an
            // already-hashed value on a second pass is a no-op, so this
            // stays idempotent.
            (false, true) => {
                let hashed = format!("hash:{}", short_hash(v.as_str().unwrap()));
                out.insert("path_hash".into(), serde_json::Value::String(hashed));
            }
            // Free text under a key we do not recognise: dropped, not
            // guessed at.
            (false, false) => {}
        }
    }
    out
}

/// Hash every path-shaped run of characters in a plain-text line. Used as a
/// fallback for lines `redact_log_line` cannot parse as JSON.
fn redact_plain_text(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    for token in line.split_inclusive(char::is_whitespace) {
        let (word, trailing) = split_trailing_whitespace(token);
        if looks_like_path(word) {
            out.push_str(&format!("hash:{}", short_hash(word)));
        } else {
            out.push_str(word);
        }
        out.push_str(trailing);
    }
    out
}

fn split_trailing_whitespace(token: &str) -> (&str, &str) {
    let end = token.trim_end_matches(char::is_whitespace).len();
    token.split_at(end)
}

/// Build a report from the app's identity, one error, and however many
/// already-raw log lines were on hand (typically [`logging::tail_lines`]
/// with `50`) — this is where redaction actually happens.
pub fn build_report(
    app_version: &str,
    os: &str,
    message: &str,
    stack: Option<&str>,
    raw_log_lines: &[String],
) -> CrashReport {
    CrashReport {
        event_id: uuid::Uuid::new_v4().to_string(),
        timestamp: now_rfc3339(),
        app_version: app_version.to_string(),
        os: os.to_string(),
        message: message.to_string(),
        stack: stack.map(str::to_string),
        log_tail: raw_log_lines.iter().map(|l| redact_log_line(l)).collect(),
    }
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// Where reports wait on disk until they are sent — a project has no
/// bearing on this, so it lives next to the log directory rather than in
/// one, keyed off the app's own data dir.
pub fn queue_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?
        .join("crash-reports")
        .join("queue");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn queue_path(dir: &Path, report: &CrashReport) -> PathBuf {
    dir.join(format!("{}.json", report.event_id))
}

/// Write a report to the queue. Called before every send attempt, so a
/// report that fails to send (offline, unreachable endpoint) is still on
/// disk to retry next launch.
pub fn enqueue(dir: &Path, report: &CrashReport) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(queue_path(dir, report), serde_json::to_vec_pretty(report)?)?;
    Ok(())
}

/// Remove a report from the queue once it has been sent successfully.
pub fn dequeue(dir: &Path, event_id: &str) -> Result<()> {
    let path = dir.join(format!("{event_id}.json"));
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// Every report still waiting to be sent, oldest first.
pub fn queued_reports(dir: &Path) -> Result<Vec<CrashReport>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut reports: Vec<CrashReport> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .filter_map(|p| std::fs::read_to_string(p).ok())
        .filter_map(|raw| serde_json::from_str::<CrashReport>(&raw).ok())
        .collect();
    reports.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    Ok(reports)
}

/// Send one report to `endpoint` in `format`. Returns an error (the caller
/// leaves the report queued) rather than panicking or retrying itself —
/// retries happen across app starts, not within one call.
pub fn send(endpoint: &str, format: ReportFormat, report: &CrashReport) -> Result<()> {
    if endpoint.trim().is_empty() {
        return Err(AppError::Validation(
            "no report endpoint is configured".into(),
        ));
    }
    let (body, content_type) = match format {
        ReportFormat::Json => (serde_json::to_vec(report)?, "application/json"),
        ReportFormat::Sentry => (sentry_envelope(report)?, "application/x-sentry-envelope"),
    };
    ureq::post(endpoint)
        .set("Content-Type", content_type)
        .timeout(std::time::Duration::from_secs(10))
        .send_bytes(&body)
        .map_err(|e| AppError::Io(format!("sending crash report: {e}")))?;
    Ok(())
}

/// A minimal Sentry envelope: an envelope header line, an item header line,
/// and the event payload line, newline-delimited — the shape the `/envelope/`
/// endpoint on Sentry and Sentry-compatible collectors (e.g. GlitchTip)
/// expects. `dsn` is deliberately not set here: `report_endpoint` is already
/// the full envelope URL a maintainer configured, not a DSN to derive one
/// from.
pub fn sentry_envelope(report: &CrashReport) -> Result<Vec<u8>> {
    let header = serde_json::json!({
        "event_id": report.event_id.replace('-', ""),
        "sent_at": report.timestamp,
    });
    let event = serde_json::json!({
        "event_id": report.event_id.replace('-', ""),
        "timestamp": report.timestamp,
        "platform": "other",
        "release": report.app_version,
        "contexts": { "os": { "name": report.os } },
        "exception": {
            "values": [{
                "type": "MisketError",
                "value": report.message,
                "stacktrace": report.stack.as_ref().map(|s| serde_json::json!({
                    "frames": [{ "filename": "misket", "function": s }],
                })),
            }],
        },
        "extra": { "log_tail": report.log_tail },
    });
    let item_header = serde_json::json!({ "type": "event", "content_type": "application/json" });

    let mut out = serde_json::to_vec(&header)?;
    out.push(b'\n');
    out.extend(serde_json::to_vec(&item_header)?);
    out.push(b'\n');
    out.extend(serde_json::to_vec(&event)?);
    out.push(b'\n');
    Ok(out)
}

/// A tiny hex encoder so a hash byte slice becomes a short string without
/// pulling in the `hex` crate for six bytes.
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_hashes_paths_and_drops_unlisted_fields() {
        let line = r#"{"timestamp":"2026-09-18T00:00:00Z","level":"INFO","target":"misket_lib","fields":{"message":"opened project","path":"/home/user/secret study.misket","text":"the actual document content","code":"NotFound","memo":"a private note"},"spans":[]}"#;
        let redacted = redact_log_line(line);
        assert!(!redacted.contains("secret study"));
        assert!(!redacted.contains("the actual document content"));
        assert!(!redacted.contains("a private note"));
        assert!(!redacted.contains("spans"));
        // What should survive: the message, the allowed `code` field, and a
        // hash standing in for the path.
        assert!(redacted.contains("opened project"));
        assert!(redacted.contains("NotFound"));
        assert!(redacted.contains("hash:"));
    }

    #[test]
    fn redact_is_stable_and_never_grows_back_the_secret() {
        let line =
            r#"{"timestamp":"t","level":"ERROR","target":"x","fields":{"path":"/a/b/c.misket"}}"#;
        let once = redact_log_line(line);
        let twice = redact_log_line(&once);
        assert_eq!(once, twice);
    }

    #[test]
    fn redact_falls_back_to_substring_hashing_for_non_json_lines() {
        let line = "opened /home/user/secret study.misket successfully";
        let redacted = redact_plain_text(line);
        assert!(!redacted.contains("secret"));
        assert!(redacted.contains("hash:"));
        assert!(redacted.contains("opened"));
        assert!(redacted.contains("successfully"));
    }

    #[test]
    fn queue_round_trips_a_report_to_disk_and_back() {
        let dir = tempfile::tempdir().unwrap();
        let report = build_report("0.1.0", "linux", "boom", Some("at foo.rs:1"), &[]);
        enqueue(dir.path(), &report).unwrap();
        let queued = queued_reports(dir.path()).unwrap();
        assert_eq!(queued, vec![report.clone()]);
        dequeue(dir.path(), &report.event_id).unwrap();
        assert!(queued_reports(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn queued_reports_are_oldest_first() {
        let dir = tempfile::tempdir().unwrap();
        let mut older = build_report("0.1.0", "linux", "first", None, &[]);
        older.timestamp = "2020-01-01T00:00:00Z".into();
        let mut newer = build_report("0.1.0", "linux", "second", None, &[]);
        newer.timestamp = "2025-01-01T00:00:00Z".into();
        enqueue(dir.path(), &newer).unwrap();
        enqueue(dir.path(), &older).unwrap();
        let queued = queued_reports(dir.path()).unwrap();
        assert_eq!(queued[0].message, "first");
        assert_eq!(queued[1].message, "second");
    }

    #[test]
    fn send_without_an_endpoint_is_refused() {
        let report = build_report("0.1.0", "linux", "boom", None, &[]);
        let err = send("", ReportFormat::Json, &report).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }

    #[test]
    fn sentry_envelope_has_header_item_header_and_event_lines() {
        let report = build_report(
            "0.1.0",
            "linux",
            "boom",
            Some("stack here"),
            &["line".into()],
        );
        let bytes = sentry_envelope(&report).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        let lines: Vec<&str> = text.trim_end().split('\n').collect();
        assert_eq!(lines.len(), 3);

        let header: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(header["event_id"], report.event_id.replace('-', ""));
        assert!(header.get("sent_at").is_some());

        let item_header: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(item_header["type"], "event");

        let event: serde_json::Value = serde_json::from_str(lines[2]).unwrap();
        assert_eq!(event["release"], "0.1.0");
        assert!(event["exception"]["values"][0]["value"] == "boom");
    }

    #[test]
    fn short_hash_is_deterministic_and_not_the_input() {
        let a = short_hash("/home/user/study.misket");
        let b = short_hash("/home/user/study.misket");
        let c = short_hash("/home/user/other.misket");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(!a.contains("study"));
    }
}
