//! The inference engine behind a trait, so everything around it — decoding,
//! formatting, progress, cancellation, document creation — can be built and
//! tested without a 75 MiB model file or a C++ toolchain.
//!
//! [`WhisperEngine`] is the real one, compiled only with the `whisper`
//! feature. [`StubEngine`] stands in for it in tests and in the headless
//! smoke test, where no model is installed.

use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use misket_core::{AppError, Result};
use serde::{Deserialize, Serialize};

use super::format::Segment;
use super::{cancelled, Cancel};

/// Called with the whole percent done (0–100) and how many segments have
/// been produced so far.
pub type Progress = Arc<dyn Fn(u8, u32) + Send + Sync>;

/// What to ask the model for.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOptions {
    /// An ISO-639-1 code (`en`, `tr`, `de`), or `None` to let Whisper detect
    /// it from the first thirty seconds.
    #[serde(default)]
    pub language: Option<String>,
    /// Whisper's translate task: output English whatever was spoken.
    #[serde(default)]
    pub translate: bool,
    /// Decoding threads. Defaults to [`default_threads`].
    #[serde(default)]
    pub threads: Option<u32>,
}

impl RunOptions {
    // Only the real engine asks; a build without it still wants the field.
    #[cfg_attr(not(feature = "whisper"), allow(dead_code))]
    pub fn threads(&self) -> u32 {
        self.threads
            .filter(|n| *n > 0)
            .unwrap_or_else(default_threads)
    }
}

/// One fewer than the machine has, so a long transcription leaves the rest of
/// the desktop usable. Never zero.
pub fn default_threads() -> u32 {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(2);
    cores.saturating_sub(1).max(1)
}

pub trait Engine: Send {
    fn transcribe(
        &mut self,
        audio: &[f32],
        options: &RunOptions,
        progress: Progress,
        cancel: Cancel,
    ) -> Result<Vec<Segment>>;
}

/// Load the engine for `model_path`, or explain why this build cannot.
pub fn load(model_path: &Path) -> Result<Box<dyn Engine>> {
    #[cfg(feature = "whisper")]
    {
        Ok(Box::new(WhisperEngine::load(model_path)?))
    }
    #[cfg(not(feature = "whisper"))]
    {
        let _ = model_path;
        Err(AppError::Validation(
            "this build of Misket was compiled without transcription support \
             (the `whisper` feature is off)."
                .into(),
        ))
    }
}

#[cfg(feature = "whisper")]
pub struct WhisperEngine {
    ctx: whisper_rs::WhisperContext,
}

#[cfg(feature = "whisper")]
impl WhisperEngine {
    pub fn load(model_path: &Path) -> Result<Self> {
        let path = model_path
            .to_str()
            .ok_or_else(|| AppError::Validation("the model's path is not valid UTF-8".into()))?;
        let ctx = whisper_rs::WhisperContext::new_with_params(
            path,
            whisper_rs::WhisperContextParameters::default(),
        )
        .map_err(|e| {
            AppError::Validation(format!(
                "could not load the transcription model: {e}. If you copied the file in by \
                 hand, check that it is a ggml Whisper model."
            ))
        })?;
        Ok(WhisperEngine { ctx })
    }
}

#[cfg(feature = "whisper")]
impl Engine for WhisperEngine {
    fn transcribe(
        &mut self,
        audio: &[f32],
        options: &RunOptions,
        progress: Progress,
        cancel: Cancel,
    ) -> Result<Vec<Segment>> {
        use std::sync::atomic::AtomicU32;
        use whisper_rs::{FullParams, SamplingStrategy};

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(options.threads() as i32);
        params.set_translate(options.translate);
        // whisper.cpp reads the literal "auto" as "detect from the audio".
        params.set_language(Some(options.language.as_deref().unwrap_or("auto")));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        // whisper.cpp reports the two halves of "how far along are we"
        // through separate callbacks, so they share the last value each
        // other saw rather than ever reporting a zero they did not mean.
        let percent = Arc::new(AtomicU32::new(0));
        let segments_seen = Arc::new(AtomicU32::new(0));
        {
            let progress = progress.clone();
            let percent = percent.clone();
            let segments_seen = segments_seen.clone();
            params.set_progress_callback_safe(move |pct: i32| {
                let pct = pct.clamp(0, 100) as u32;
                percent.store(pct, Ordering::Relaxed);
                progress(pct as u8, segments_seen.load(Ordering::Relaxed));
            });
        }
        {
            let progress = progress.clone();
            let percent = percent.clone();
            let segments_seen = segments_seen.clone();
            params.set_segment_callback_safe_lossy(move |data: whisper_rs::SegmentCallbackData| {
                let n = (data.segment + 1).max(0) as u32;
                segments_seen.store(n, Ordering::Relaxed);
                progress(percent.load(Ordering::Relaxed) as u8, n);
            });
        }
        {
            let cancel = cancel.clone();
            params.set_abort_callback_safe(move || cancel.load(Ordering::Relaxed));
        }

        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| AppError::Db(format!("could not start the model: {e}")))?;
        state.full(params, audio).map_err(|e| {
            if cancel.load(Ordering::Relaxed) {
                cancelled()
            } else {
                AppError::Db(format!("transcription failed: {e}"))
            }
        })?;
        if cancel.load(Ordering::Relaxed) {
            return Err(cancelled());
        }

        let mut segments = Vec::new();
        for segment in state.as_iter() {
            let text = segment.to_str_lossy().unwrap_or_default().into_owned();
            // whisper.cpp timestamps are in centiseconds.
            segments.push(Segment {
                start_ms: segment.start_timestamp() * 10,
                end_ms: segment.end_timestamp() * 10,
                text,
            });
        }
        progress(100, segments.len() as u32);
        Ok(segments)
    }
}

/// A stand-in engine that produces fixed segments over the length of the
/// audio it is handed.
///
/// Used by the unit tests, and by the headless smoke test through
/// `MISKET_E2E_WHISPER_STUB` — the same escape hatch `MISKET_E2E_UPDATE_JSON`
/// gives the updater, so the whole path from the dialog to the finished
/// transcript document can be exercised on a machine with no model on it. It
/// is never reachable unless that variable is set.
pub struct StubEngine {
    pub lines: Vec<String>,
    /// Milliseconds of wall clock to spend, so progress and cancel are
    /// observable.
    pub pause_ms: u64,
}

impl Default for StubEngine {
    fn default() -> Self {
        StubEngine {
            lines: vec![
                "This is a stand-in transcript.".into(),
                "It is produced without a model.".into(),
                "Misket only does this when MISKET_E2E_WHISPER_STUB is set.".into(),
            ],
            pause_ms: 0,
        }
    }
}

impl Engine for StubEngine {
    fn transcribe(
        &mut self,
        audio: &[f32],
        _options: &RunOptions,
        progress: Progress,
        cancel: Cancel,
    ) -> Result<Vec<Segment>> {
        let total_ms = super::audio::duration_ms(audio).max(self.lines.len() as i64 * 1000);
        let step = (total_ms / self.lines.len().max(1) as i64).max(1);
        let mut segments = Vec::new();
        for (i, line) in self.lines.iter().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                return Err(cancelled());
            }
            if self.pause_ms > 0 {
                std::thread::sleep(std::time::Duration::from_millis(self.pause_ms));
            }
            let start = step * i as i64;
            segments.push(Segment {
                start_ms: start,
                end_ms: start + step,
                text: line.clone(),
            });
            progress(
                (((i + 1) * 100) / self.lines.len().max(1)) as u8,
                (i + 1) as u32,
            );
        }
        Ok(segments)
    }
}

/// Whether this build can transcribe at all.
pub const fn available() -> bool {
    cfg!(feature = "whisper")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    fn noop_progress() -> Progress {
        Arc::new(|_, _| {})
    }

    #[test]
    fn threads_default_to_one_below_the_core_count() {
        let n = default_threads();
        assert!(n >= 1);
        assert_eq!(RunOptions::default().threads(), n);
        assert_eq!(
            RunOptions {
                threads: Some(3),
                ..RunOptions::default()
            }
            .threads(),
            3
        );
        // Zero is nonsense, not "no threads".
        assert_eq!(
            RunOptions {
                threads: Some(0),
                ..RunOptions::default()
            }
            .threads(),
            n
        );
    }

    #[test]
    fn the_stub_spreads_its_lines_over_the_audio() {
        let mut engine = StubEngine::default();
        let audio = vec![0.0f32; 16_000 * 6]; // six seconds
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let progress: Progress = {
            let seen = seen.clone();
            Arc::new(move |p, n| seen.lock().unwrap().push((p, n)))
        };
        let segments = engine
            .transcribe(
                &audio,
                &RunOptions::default(),
                progress,
                Arc::new(AtomicBool::new(false)),
            )
            .unwrap();
        assert_eq!(segments.len(), 3);
        assert_eq!(segments[0].start_ms, 0);
        assert_eq!(segments[2].start_ms, 4000);
        assert_eq!(*seen.lock().unwrap().last().unwrap(), (100, 3));
    }

    #[test]
    fn cancelling_stops_the_run_and_says_so() {
        let mut engine = StubEngine::default();
        let cancel = Arc::new(AtomicBool::new(true));
        let err = engine
            .transcribe(
                &[0.0f32; 1600],
                &RunOptions::default(),
                noop_progress(),
                cancel,
            )
            .unwrap_err();
        assert!(super::super::is_cancelled(&err), "got {err:?}");
    }

    /// `load` never panics on a path that is not a model; it explains, either
    /// that this build has no engine or that the file cannot be read.
    #[test]
    fn loading_something_that_is_not_a_model_explains_itself() {
        assert_eq!(available(), cfg!(feature = "whisper"));
        let err = match load(Path::new("/nowhere/ggml-tiny.bin")) {
            Ok(_) => panic!("a path that does not exist must not load"),
            Err(e) => e,
        };
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
        if !available() {
            assert!(format!("{err}").contains("whisper"), "got {err}");
        }
    }
}
