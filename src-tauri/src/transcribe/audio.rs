//! Turning a recording on disk into what Whisper wants: 16 kHz mono `f32`.
//!
//! Symphonia decodes the audio formats Misket imports (mp3, m4a/aac/alac,
//! ogg/vorbis, flac, wav) and the two video containers it can read directly
//! (mp4/m4v/mov, mkv/webm). A container it cannot open — or one whose audio
//! track uses a codec that is not compiled in — falls back to `ffmpeg` on
//! `PATH`, which is why the docs say video transcription may need ffmpeg
//! installed while audio never does.
//!
//! Resampling is a plain windowed-sinc convolution rather than a dependency:
//! it is forty lines, it is testable, and the rate ratios involved here
//! (8/44.1/48 kHz down or up to 16 kHz) are exactly what a low-pass sinc is
//! for. Linear interpolation would alias 44.1 kHz speech badly enough to cost
//! accuracy, which is the whole point of the exercise.

use std::path::Path;
use std::process::Command;

use misket_core::{AppError, Result};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// The sample rate every Whisper model is trained at.
pub const TARGET_RATE: u32 = 16_000;

/// Half-width of the resampling kernel, in output-side taps. 16 is the usual
/// quality/cost compromise for speech; a two-hour 48 kHz recording still
/// resamples in a few seconds, which is nothing beside the inference.
const TAPS: i64 = 16;

/// Decode `path` to 16 kHz mono `f32` samples in `[-1, 1]`.
pub fn decode_to_mono_16k(path: &Path) -> Result<Vec<f32>> {
    match decode_with_symphonia(path) {
        Ok((samples, rate)) => Ok(resample(&samples, rate, TARGET_RATE)),
        Err(e) => {
            if !ffmpeg_available() {
                return Err(AppError::Validation(format!(
                    "could not decode this recording ({e}). Video files often carry an audio \
                     codec Misket does not decode on its own; installing ffmpeg and putting it \
                     on your PATH lets Misket extract the audio track first."
                )));
            }
            let samples = decode_with_ffmpeg(path)?;
            Ok(samples)
        }
    }
}

/// Whether an `ffmpeg` we can call is on `PATH`.
pub fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Decode with Symphonia, mixing every channel down to mono. Returns the
/// samples and the rate they are at.
fn decode_with_symphonia(path: &Path) -> Result<(Vec<f32>, u32)> {
    let file = std::fs::File::open(path)?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions {
                enable_gapless: true,
                ..Default::default()
            },
            &MetadataOptions::default(),
        )
        .map_err(|e| AppError::Validation(format!("unreadable container: {e}")))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| AppError::Validation("this file has no audio track".into()))?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| AppError::Validation(format!("unsupported audio codec: {e}")))?;

    let mut rate = track.codec_params.sample_rate.unwrap_or(0);
    let mut mono: Vec<f32> = Vec::new();
    let mut buf: Option<SampleBuffer<f32>> = None;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            // Symphonia signals "no more packets" with an IO error of kind
            // UnexpectedEof; anything else is a real read failure.
            Err(symphonia::core::errors::Error::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(e) => return Err(AppError::Validation(format!("could not read audio: {e}"))),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            // A damaged or skipped packet is not worth failing the whole
            // transcription over; Symphonia asks callers to keep going.
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(e) => return Err(AppError::Validation(format!("could not decode audio: {e}"))),
        };
        let spec = *decoded.spec();
        if rate == 0 {
            rate = spec.rate;
        }
        let capacity = decoded.capacity() as u64;
        let sample_buf = buf.get_or_insert_with(|| SampleBuffer::<f32>::new(capacity, spec));
        sample_buf.copy_interleaved_ref(decoded);
        let channels = spec.channels.count().max(1);
        mono.extend(
            sample_buf
                .samples()
                .chunks_exact(channels)
                .map(|frame| frame.iter().sum::<f32>() / channels as f32),
        );
    }
    if rate == 0 {
        return Err(AppError::Validation(
            "this recording does not declare a sample rate".into(),
        ));
    }
    if mono.is_empty() {
        return Err(AppError::Validation(
            "this recording decoded to no audio at all".into(),
        ));
    }
    Ok((mono, rate))
}

/// Ask `ffmpeg` for 16 kHz mono 32-bit float PCM on stdout and read it back.
/// Used only when Symphonia cannot open the file at all.
fn decode_with_ffmpeg(path: &Path) -> Result<Vec<f32>> {
    let out = Command::new("ffmpeg")
        .args(["-nostdin", "-v", "error", "-i"])
        .arg(path)
        .args([
            "-vn",
            "-map",
            "a:0",
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ac",
            "1",
            "-ar",
        ])
        .arg(TARGET_RATE.to_string())
        .arg("-")
        .output()
        .map_err(|e| AppError::Io(format!("could not run ffmpeg: {e}")))?;
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::Validation(format!(
            "ffmpeg could not extract audio from this file: {}",
            why.trim()
        )));
    }
    Ok(bytes_to_f32le(&out.stdout))
}

/// Little-endian `f32` PCM as ffmpeg writes it. A trailing partial sample
/// (a truncated pipe) is dropped.
fn bytes_to_f32le(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

/// Resample `input` from `from` to `to` with a Blackman-windowed sinc kernel.
///
/// Equal rates are returned untouched, so the common case (a wav already at
/// 16 kHz) costs nothing.
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() || from == 0 || to == 0 {
        return input.to_vec();
    }
    let ratio = to as f64 / from as f64;
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    // Below Nyquist of the *lower* rate, with a little margin so the
    // transition band does not eat the top of the speech range.
    let cutoff = 0.5 * ratio.min(1.0) * 0.95;
    // Downsampling needs a wider kernel in input samples to hold the same
    // number of output-side taps.
    let half = if ratio < 1.0 {
        (TAPS as f64 / ratio).ceil() as i64
    } else {
        TAPS
    };

    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let center = i as f64 / ratio;
        let base = center.floor() as i64;
        let mut acc = 0.0f64;
        let mut norm = 0.0f64;
        for k in (base - half)..=(base + half) {
            let t = center - k as f64;
            let w = blackman(t, half as f64);
            if w == 0.0 {
                continue;
            }
            let tap = 2.0 * cutoff * sinc(2.0 * cutoff * t) * w;
            norm += tap;
            let s = if k < 0 {
                input[0]
            } else if k as usize >= input.len() {
                input[input.len() - 1]
            } else {
                input[k as usize]
            } as f64;
            acc += tap * s;
        }
        out.push(if norm.abs() > 1e-12 {
            (acc / norm) as f32
        } else {
            0.0
        });
    }
    out
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-9 {
        1.0
    } else {
        (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x)
    }
}

/// Blackman window over `[-half, half]`, zero outside it.
fn blackman(t: f64, half: f64) -> f64 {
    if t.abs() > half {
        return 0.0;
    }
    let x = (t + half) / (2.0 * half);
    0.42 - 0.5 * (2.0 * std::f64::consts::PI * x).cos()
        + 0.08 * (4.0 * std::f64::consts::PI * x).cos()
}

/// How long `samples` at [`TARGET_RATE`] run for, in milliseconds.
pub fn duration_ms(samples: &[f32]) -> i64 {
    (samples.len() as i64) * 1000 / TARGET_RATE as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures")
            .join(name)
    }

    #[test]
    fn decodes_the_sample_wav_to_16k_mono() {
        // fixtures/sample.wav is 3 seconds of 8 kHz mono PCM.
        let samples = decode_to_mono_16k(&fixture("sample.wav")).unwrap();
        assert_eq!(samples.len(), 48_000, "3 s at 16 kHz is 48000 samples");
        assert_eq!(duration_ms(&samples), 3000);
        assert!(
            samples.iter().all(|s| s.is_finite() && s.abs() <= 1.5),
            "samples must stay in a sane range"
        );
    }

    #[test]
    fn a_file_that_is_not_audio_is_rejected() {
        let err = decode_to_mono_16k(&fixture("sample.txt")).unwrap_err();
        // Either Symphonia rejects it or (with ffmpeg on PATH) ffmpeg does;
        // both must come back as a Validation error the dialog can show.
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
    }

    #[test]
    fn resampling_keeps_length_and_shape() {
        // A 440 Hz sine at 8 kHz, upsampled to 16 kHz, must stay a 440 Hz
        // sine: same peak amplitude, twice as many samples.
        let input: Vec<f32> = (0..8000)
            .map(|i| (2.0 * std::f64::consts::PI * 440.0 * i as f64 / 8000.0).sin() as f32)
            .collect();
        let out = resample(&input, 8000, 16_000);
        assert_eq!(out.len(), 16_000);
        let peak = out[2000..14_000].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((peak - 1.0).abs() < 0.05, "peak was {peak}");
    }

    #[test]
    fn resampling_down_removes_nothing_it_should_keep() {
        let input: Vec<f32> = (0..44_100)
            .map(|i| (2.0 * std::f64::consts::PI * 300.0 * i as f64 / 44_100.0).sin() as f32)
            .collect();
        let out = resample(&input, 44_100, 16_000);
        assert_eq!(out.len(), 16_000);
        let peak = out[2000..14_000].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((peak - 1.0).abs() < 0.05, "peak was {peak}");
    }

    #[test]
    fn resampling_at_the_same_rate_is_a_copy() {
        let input = vec![0.1, -0.2, 0.3];
        assert_eq!(resample(&input, 16_000, 16_000), input);
        assert!(resample(&[], 8000, 16_000).is_empty());
    }

    #[test]
    fn reads_ffmpeg_style_float_pcm() {
        let bytes: Vec<u8> = [0.5f32, -0.25]
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .chain([0u8, 1u8]) // a truncated trailing sample
            .collect();
        assert_eq!(bytes_to_f32le(&bytes), vec![0.5, -0.25]);
    }
}
