use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Mutex;

use misket_core::db::OpenProject;
use misket_core::{AppError, Result};

use crate::transcribe::Cancel;

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
    /// Cancel flags for transcriptions in flight, keyed by the recording's
    /// document id — one run per recording at a time (`crate::transcribe`).
    pub transcriptions: Mutex<HashMap<String, Cancel>>,
    /// Cancel flags for model downloads in flight, keyed by model id.
    pub model_downloads: Mutex<HashMap<String, Cancel>>,
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

    /// Claim the right to run `key`, handing back a fresh cancel flag.
    /// `Conflict` if something is already running under that key, which is
    /// what stops a double-click starting two transcriptions of one file.
    pub fn start_job(&self, map: &Mutex<HashMap<String, Cancel>>, key: &str) -> Result<Cancel> {
        let mut jobs = map
            .lock()
            .map_err(|_| AppError::Db("job lock poisoned".into()))?;
        if jobs.contains_key(key) {
            return Err(AppError::Conflict("that is already running".into()));
        }
        let flag = Cancel::default();
        jobs.insert(key.to_string(), flag.clone());
        Ok(flag)
    }

    /// Set the cancel flag for `key`, if it is running.
    pub fn cancel_job(&self, map: &Mutex<HashMap<String, Cancel>>, key: &str) {
        if let Ok(jobs) = map.lock() {
            if let Some(flag) = jobs.get(key) {
                flag.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }

    /// Forget `key` once its job has finished, however it finished.
    pub fn finish_job(&self, map: &Mutex<HashMap<String, Cancel>>, key: &str) {
        if let Ok(mut jobs) = map.lock() {
            jobs.remove(key);
        }
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
