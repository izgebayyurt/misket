use std::sync::Mutex;

use misket_core::db::OpenProject;
use misket_core::{AppError, Result};

#[derive(Default)]
pub struct AppState {
    pub project: Mutex<Option<OpenProject>>,
    /// A project file the OS asked us to open (double-click, "Open with").
    pub pending_open: Mutex<Option<String>>,
}

impl AppState {
    /// Run `f` against the open project's connection, holding the lock for the
    /// duration of the call. Every call is a few milliseconds at most.
    pub fn with_project<T>(&self, f: impl FnOnce(&OpenProject) -> Result<T>) -> Result<T> {
        let guard = self
            .project
            .lock()
            .map_err(|_| AppError::Db("project lock poisoned".into()))?;
        match guard.as_ref() {
            Some(p) => f(p),
            None => Err(AppError::NoProjectOpen),
        }
    }
}
