//! Misket core: the project database and all domain logic.
//!
//! This crate has no UI or Tauri dependencies so it can be unit-tested with
//! an in-memory SQLite connection. The desktop app (`src-tauri`) wraps these
//! functions in Tauri commands.

pub mod db;
pub mod error;
pub mod models;
pub mod sample;
pub mod text;

pub use error::{AppError, Result};
