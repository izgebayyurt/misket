//! Offline transcription of a recording with Whisper (roadmap 26).
//!
//! Nothing here talks to a service. A person downloads a ggml model once
//! ([`models`]), Misket decodes the recording itself ([`audio`]), runs it
//! through whisper.cpp ([`engine`]) and writes the segments out as an
//! ordinary text document ([`format`]). The only network call in the whole
//! feature is the model download, and it only happens when someone presses
//! Download.
//!
//! The inference engine sits behind the `whisper` Cargo feature, on by
//! default. With it off, the crate still compiles and every test but the ones
//! that need whisper.cpp still runs: decoding, formatting, the model registry
//! and the command layer are all feature-independent, and [`engine::load`]
//! returns an error that says so.

pub mod audio;
pub mod engine;
pub mod format;
pub mod models;

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use misket_core::{AppError, Result};
use serde::{Deserialize, Serialize};

pub use engine::{Engine, Progress, RunOptions};
pub use format::{Layout, TranscriptionResult};
pub use misket_core::text::align::Anchor;

/// Set from the UI to stop a run; polled by the engine and the downloader.
pub type Cancel = Arc<AtomicBool>;

/// The message a cancelled run carries, so the UI can tell "you stopped it"
/// apart from "it went wrong" without a new `AppError` variant.
const CANCELLED: &str = "transcription cancelled";

pub fn cancelled() -> AppError {
    AppError::Validation(CANCELLED.into())
}

pub fn is_cancelled(e: &AppError) -> bool {
    matches!(e, AppError::Validation(m) if m == CANCELLED)
}

/// A language the dialog can offer. Whisper knows ninety-nine; this is the
/// set worth putting in a menu, and "auto" covers the rest — a person whose
/// language is missing simply lets Whisper detect it.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Language {
    pub code: &'static str,
    pub name: &'static str,
}

macro_rules! languages {
    ($(($code:literal, $name:literal)),* $(,)?) => {
        pub const LANGUAGES: &[Language] = &[$(Language { code: $code, name: $name }),*];
    };
}

languages![
    ("ar", "Arabic"),
    ("bn", "Bengali"),
    ("zh", "Chinese"),
    ("cs", "Czech"),
    ("nl", "Dutch"),
    ("en", "English"),
    ("fi", "Finnish"),
    ("fr", "French"),
    ("de", "German"),
    ("el", "Greek"),
    ("he", "Hebrew"),
    ("hi", "Hindi"),
    ("hu", "Hungarian"),
    ("id", "Indonesian"),
    ("it", "Italian"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("ms", "Malay"),
    ("no", "Norwegian"),
    ("fa", "Persian"),
    ("pl", "Polish"),
    ("pt", "Portuguese"),
    ("ro", "Romanian"),
    ("ru", "Russian"),
    ("es", "Spanish"),
    ("sv", "Swedish"),
    ("th", "Thai"),
    ("tr", "Turkish"),
    ("uk", "Ukrainian"),
    ("ur", "Urdu"),
    ("vi", "Vietnamese"),
];

/// What this build can do, so the dialog can say why it cannot do something.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Support {
    /// False in a build compiled without the `whisper` feature.
    pub available: bool,
    /// Whether an `ffmpeg` is on `PATH`. Audio never needs it; some video
    /// containers do.
    pub ffmpeg: bool,
    pub default_threads: u32,
    pub languages: Vec<Language>,
    /// The whisper.cpp build this was linked against, when there is one.
    pub engine_version: Option<String>,
}

pub fn support() -> Support {
    Support {
        available: engine::available(),
        ffmpeg: audio::ffmpeg_available(),
        default_threads: engine::default_threads(),
        languages: LANGUAGES.to_vec(),
        engine_version: engine_version(),
    }
}

#[cfg(feature = "whisper")]
fn engine_version() -> Option<String> {
    Some(whisper_rs::get_whisper_version().to_string())
}

#[cfg(not(feature = "whisper"))]
fn engine_version() -> Option<String> {
    None
}

/// Everything a transcription run needs, as the dialog sends it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    /// The recording to transcribe.
    pub document_id: String,
    /// A model id from [`models::CATALOGUE`], or the file name of one added
    /// by hand. Absent means "whatever Settings has chosen".
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub translate: bool,
    #[serde(default)]
    pub threads: Option<u32>,
    #[serde(default)]
    pub layout: Layout,
}

impl TranscribeRequest {
    pub fn run_options(&self) -> RunOptions {
        RunOptions {
            // "auto" from the picker is the same as not choosing.
            language: self
                .language
                .as_deref()
                .map(str::trim)
                .filter(|l| !l.is_empty() && *l != "auto")
                .map(str::to_owned),
            translate: self.translate,
            threads: self.threads,
        }
    }
}

/// Decode `path`, run it through `engine`, and render the result.
///
/// Progress is reported over the whole job, not just inference: decoding a
/// long recording takes real time, and a bar that sits at zero through it
/// looks broken. Decoding is given the first [`DECODE_SHARE`] percent.
pub fn run(
    path: &Path,
    engine: &mut dyn Engine,
    options: &RunOptions,
    layout: Layout,
    progress: Progress,
    cancel: Cancel,
) -> Result<TranscriptionResult> {
    use std::sync::atomic::Ordering;

    if cancel.load(Ordering::Relaxed) {
        return Err(cancelled());
    }
    progress(0, 0);
    let samples = audio::decode_to_mono_16k(path)?;
    if cancel.load(Ordering::Relaxed) {
        return Err(cancelled());
    }
    progress(DECODE_SHARE, 0);

    let scaled: Progress = {
        let progress = progress.clone();
        Arc::new(move |pct, segments| {
            let overall = DECODE_SHARE as u32 + (pct as u32 * (100 - DECODE_SHARE as u32)) / 100;
            progress(overall.min(100) as u8, segments);
        })
    };
    let segments = engine.transcribe(&samples, options, scaled, cancel.clone())?;
    if cancel.load(Ordering::Relaxed) {
        return Err(cancelled());
    }
    progress(100, segments.len() as u32);
    Ok(format::render(&segments, layout))
}

/// How much of the progress bar decoding gets.
const DECODE_SHARE: u8 = 3;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;
    use std::sync::Mutex;

    fn fixture(name: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures")
            .join(name)
    }

    #[test]
    fn cancelled_errors_are_recognisable() {
        assert!(is_cancelled(&cancelled()));
        assert!(!is_cancelled(&AppError::Validation(
            "something else".into()
        )));
        assert!(!is_cancelled(&AppError::Db(CANCELLED.into())));
    }

    #[test]
    fn auto_is_the_same_as_no_language() {
        let base = TranscribeRequest {
            document_id: "d".into(),
            model: None,
            language: Some("auto".into()),
            translate: false,
            threads: None,
            layout: Layout::default(),
        };
        assert_eq!(base.run_options().language, None);
        assert_eq!(
            TranscribeRequest {
                language: Some("  ".into()),
                ..base.clone()
            }
            .run_options()
            .language,
            None
        );
        assert_eq!(
            TranscribeRequest {
                language: Some("tr".into()),
                ..base
            }
            .run_options()
            .language
            .as_deref(),
            Some("tr")
        );
    }

    #[test]
    fn the_language_list_is_sane() {
        assert!(LANGUAGES.iter().any(|l| l.code == "en"));
        assert!(LANGUAGES.iter().any(|l| l.code == "tr"));
        assert!(LANGUAGES.iter().all(|l| l.code.len() == 2));
        let mut codes: Vec<_> = LANGUAGES.iter().map(|l| l.code).collect();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), LANGUAGES.len(), "duplicate language codes");
    }

    #[test]
    fn support_describes_this_build() {
        let s = support();
        assert_eq!(s.available, cfg!(feature = "whisper"));
        assert_eq!(s.engine_version.is_some(), cfg!(feature = "whisper"));
        assert!(s.default_threads >= 1);
        assert!(!s.languages.is_empty());
    }

    /// The whole pipeline over the real fixture, with the engine stubbed:
    /// decode, resample, transcribe, render, anchors.
    #[test]
    fn a_full_run_produces_timestamped_paragraphs_and_anchors() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let progress: Progress = {
            let seen = seen.clone();
            Arc::new(move |p, n| seen.lock().unwrap().push((p, n)))
        };
        let out = run(
            &fixture("sample.wav"),
            &mut engine::StubEngine::default(),
            &RunOptions::default(),
            Layout::default(),
            progress,
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert!(out.text.starts_with("[00:00] "), "got {:?}", out.text);
        assert_eq!(out.text.lines().filter(|l| !l.is_empty()).count(), 3);
        assert_eq!(out.anchors.len(), 3);
        assert_eq!(out.anchors[0], Anchor::new(0, 0));
        assert!(out.anchors[2].ms > out.anchors[1].ms);
        assert_eq!(out.speakers, None);

        let seen = seen.lock().unwrap();
        assert_eq!(seen.first().unwrap().0, 0);
        assert_eq!(seen.last().unwrap(), &(100, 3));
        assert!(
            seen.windows(2).all(|w| w[0].0 <= w[1].0),
            "progress must never go backwards: {seen:?}"
        );
    }

    #[test]
    fn a_cancelled_run_stops_before_it_writes_anything() {
        let cancel = Arc::new(AtomicBool::new(true));
        let err = run(
            &fixture("sample.wav"),
            &mut engine::StubEngine::default(),
            &RunOptions::default(),
            Layout::default(),
            Arc::new(|_, _| {}),
            cancel.clone(),
        )
        .unwrap_err();
        assert!(is_cancelled(&err), "got {err:?}");

        // Cancelled after decoding rather than before it: still cancelled.
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let progress: Progress = Arc::new(move |_, _| flag.store(true, Ordering::Relaxed));
        let err = run(
            &fixture("sample.wav"),
            &mut engine::StubEngine::default(),
            &RunOptions::default(),
            Layout::default(),
            progress,
            cancel,
        )
        .unwrap_err();
        assert!(is_cancelled(&err), "got {err:?}");
    }

    /// The one test that needs a real model. Point `MISKET_WHISPER_MODEL` at
    /// a `ggml-*.bin` (`ggml-tiny.en.bin` is 75 MiB and plenty) to run it:
    ///
    /// ```sh
    /// MISKET_WHISPER_MODEL=~/models/ggml-tiny.en.bin cargo test -p misket
    /// ```
    ///
    /// Without it the test prints a note and passes, because CI has no model
    /// and downloading one per run would be 75 MiB of someone else's
    /// bandwidth for every push.
    #[cfg(feature = "whisper")]
    #[test]
    fn real_inference_over_the_fixture_when_a_model_is_provided() {
        let Some(model) = std::env::var("MISKET_WHISPER_MODEL")
            .ok()
            .filter(|p| !p.is_empty())
        else {
            eprintln!(
                "skipped: set MISKET_WHISPER_MODEL to a ggml-*.bin to run inference for real"
            );
            return;
        };
        let model = std::path::PathBuf::from(model);
        assert!(
            model.is_file(),
            "MISKET_WHISPER_MODEL is not a file: {model:?}"
        );

        let started = std::time::Instant::now();
        let mut engine = engine::WhisperEngine::load(&model).unwrap();
        let out = run(
            &fixture("sample.wav"),
            &mut engine,
            &RunOptions::default(),
            Layout::default(),
            Arc::new(|_, _| {}),
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        eprintln!(
            "transcribed fixtures/sample.wav ({} paragraphs) in {:?}",
            out.anchors.len(),
            started.elapsed()
        );
        // What it heard depends on the model; that it produced a
        // timestamped, anchored document does not.
        assert!(!out.text.is_empty());
        assert!(out.text.starts_with("[00:00] "), "got {:?}", out.text);
        assert_eq!(out.anchors.first().map(|a| a.pos), Some(0));
        let chars: Vec<char> = out.text.chars().collect();
        for a in &out.anchors {
            assert_eq!(chars[a.pos as usize], '[');
        }
    }

    #[test]
    fn a_recording_that_cannot_be_decoded_never_reaches_the_model() {
        let err = run(
            &fixture("sample.txt"),
            &mut engine::StubEngine::default(),
            &RunOptions::default(),
            Layout::default(),
            Arc::new(|_, _| {}),
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
        assert!(!is_cancelled(&err));
    }
}
