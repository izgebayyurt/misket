use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::Connection;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::error::Result;

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

/// `YYYY-MM-DD` for a moment in time; matches the first 10 characters of
/// [`now`], so it lines up with timestamps already stored in the database.
pub fn day_key(t: OffsetDateTime) -> String {
    t.format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())[..10]
        .to_string()
}

/// Today's UTC calendar date as `YYYY-MM-DD`.
pub fn today() -> String {
    day_key(OffsetDateTime::now_utc())
}

/// A transaction that nests.
///
/// `BEGIN` cannot be issued inside an open transaction, so a domain function
/// that opens one of its own cannot be called from another that already did —
/// which is exactly what replaying a history node has to do. `SAVEPOINT`
/// starts a transaction at the top level and nests inside an existing one, so
/// every write path in `db::` uses this instead.
///
/// Rolls back on drop unless [`Tx::commit`] was called, like `rusqlite`'s own
/// `Transaction`.
pub struct Tx<'c> {
    conn: &'c Connection,
    name: String,
    done: bool,
}

/// Open a nested transaction on `conn`.
pub fn tx(conn: &Connection) -> Result<Tx<'_>> {
    // Unique names, so releasing an inner savepoint never releases an outer
    // one that happens to share its name.
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let name = format!("msk_{}", NEXT.fetch_add(1, Ordering::Relaxed));
    conn.execute_batch(&format!("SAVEPOINT {name}"))?;
    Ok(Tx {
        conn,
        name,
        done: false,
    })
}

impl Tx<'_> {
    /// Keep everything written since the savepoint was opened.
    pub fn commit(mut self) -> Result<()> {
        self.conn
            .execute_batch(&format!("RELEASE SAVEPOINT {}", self.name))?;
        self.done = true;
        Ok(())
    }
}

impl Drop for Tx<'_> {
    fn drop(&mut self) {
        if !self.done {
            let _ = self.conn.execute_batch(&format!(
                "ROLLBACK TO SAVEPOINT {0}; RELEASE SAVEPOINT {0}",
                self.name
            ));
        }
    }
}

impl std::ops::Deref for Tx<'_> {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        self.conn
    }
}
