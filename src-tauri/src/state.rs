use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;

use misket_core::db::OpenProject;
use misket_core::{AppError, Result};

/// How many candidate media files can be staged for measuring at once. An
/// import measures each file, one after another, so a handful is plenty.
const MAX_PROBES: usize = 8;

#[derive(Default)]
pub struct AppState {
    pub project: Mutex<Option<OpenProject>>,
    /// A project file the OS asked us to open (double-click, "Open with").
    pub pending_open: Mutex<Option<String>>,
    /// Files the frontend is about to import, each behind an opaque token.
    ///
    /// Importing a recording needs its duration, which only a decoder knows,
    /// so the webview has to load the file — but the file is not a document
    /// yet, and the media protocol serves documents by id. Staging it here
    /// lets the protocol answer `/probe/<token>` for exactly the files the
    /// user just picked, without letting the page name a path of its own.
    pub probes: Mutex<VecDeque<(String, PathBuf)>>,
    /// Where a media element can reach the open project's recordings: the
    /// loopback HTTP server's origin and this run's token (`crate::media`).
    /// `None` only if the listener could not be bound at all.
    pub media_server: Mutex<Option<(String, String)>>,
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

    /// Stage `path` for measuring and return its token, dropping the oldest
    /// entry once [`MAX_PROBES`] are held.
    pub fn stage_probe(&self, token: String, path: PathBuf) -> Result<()> {
        let mut probes = self
            .probes
            .lock()
            .map_err(|_| AppError::Db("probe lock poisoned".into()))?;
        probes.push_back((token, path));
        while probes.len() > MAX_PROBES {
            probes.pop_front();
        }
        Ok(())
    }

    /// The path staged under `token`, if it is still staged.
    pub fn probe_path(&self, token: &str) -> Option<PathBuf> {
        let probes = self.probes.lock().ok()?;
        probes
            .iter()
            .find(|(t, _)| t == token)
            .map(|(_, p)| p.clone())
    }
}
