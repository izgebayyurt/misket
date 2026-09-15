//! Forward-only schema migrations keyed by `PRAGMA user_version`.

use rusqlite::Connection;

use crate::error::Result;

const MIGRATIONS: &[(i64, &str)] = &[(1, include_str!("migrations/0001_init.sql"))];

pub fn latest_version() -> i64 {
    MIGRATIONS.last().map(|(v, _)| *v).unwrap_or(0)
}

pub fn current_version(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

/// Apply every migration newer than the file's version, in one transaction.
pub fn migrate(conn: &Connection) -> Result<()> {
    let current = current_version(conn)?;
    let pending: Vec<_> = MIGRATIONS.iter().filter(|(v, _)| *v > current).collect();
    if pending.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    for (version, sql) in pending {
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {version}"))?;
        tx.execute(
            "INSERT INTO project_meta(key, value) VALUES ('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [version.to_string()],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_is_idempotent_and_records_version() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), latest_version());
        let v: String = conn
            .query_row(
                "SELECT value FROM project_meta WHERE key = 'schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, latest_version().to_string());
    }
}
