use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// ISO-8601 / RFC 3339 UTC timestamp with millisecond precision.
pub fn now() -> String {
    let t = OffsetDateTime::now_utc();
    let t = t
        .replace_nanosecond(t.millisecond() as u32 * 1_000_000)
        .unwrap_or(t);
    t.format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}
