use serde::Serialize;

/// Error type shared by the core crate and the Tauri command layer.
///
/// Serializes as `{ "code": "...", "message": "..." }` so the frontend can
/// switch on `code`.
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "code", content = "message")]
pub enum AppError {
    #[error("no project is open")]
    NoProjectOpen,
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Validation(String),
    #[error("this project was created with a newer version of Misket (schema {0})")]
    NewerSchema(i64),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    Db(String),
}

pub type Result<T> = std::result::Result<T, AppError>;

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Db(format!("json: {e}"))
    }
}

impl From<csv::Error> for AppError {
    fn from(e: csv::Error) -> Self {
        AppError::Io(format!("csv: {e}"))
    }
}
