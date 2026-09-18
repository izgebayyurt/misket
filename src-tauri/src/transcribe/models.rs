//! The ggml Whisper models: what Misket knows about, where they live, and
//! how one gets onto the machine.
//!
//! Nothing is bundled and nothing is fetched behind anyone's back. A person
//! either downloads a model from the `ggerganov/whisper.cpp` repository on
//! Hugging Face — the same files `whisper.cpp`'s own `download-ggml-model.sh`
//! fetches — or, on a machine with no network at all, copies a `.bin` in from
//! elsewhere ("Add model file…"). Downloads resume, report progress, and are
//! checked against the SHA-1 digest whisper.cpp publishes for each model
//! before the file is moved into place.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use misket_core::{AppError, Result};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

/// Where the files are fetched from: the upstream whisper.cpp model repo.
const BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/// The first four bytes of every ggml Whisper model file (`ggml` in the older
/// files, `lmgg` little-endian in the GGUF-era ones whisper.cpp still writes
/// as `ggml`). Used only to refuse an obviously wrong file early.
const GGML_MAGIC: [&[u8; 4]; 2] = [b"ggml", b"lmgg"];

/// One model Misket offers to download.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelSpec {
    /// What whisper.cpp calls it (`tiny.en`, `large-v3-turbo`), and the id
    /// settings store.
    pub id: &'static str,
    /// Shown in the table.
    pub label: &'static str,
    pub size_label: &'static str,
    /// Roughly how many bytes, for a progress bar that has not seen a
    /// `Content-Length` yet. Verification is by digest, never by size.
    pub approx_bytes: u64,
    /// The digest whisper.cpp publishes in `models/README.md`.
    pub sha1: &'static str,
    /// English-only models are smaller and better at English; the
    /// multilingual ones are what a non-English project needs.
    pub multilingual: bool,
    /// One line of "when would I pick this".
    pub note: &'static str,
}

const MIB: u64 = 1024 * 1024;

/// The models offered, smallest first. Deliberately a short list: the
/// quantised and `tdrz` variants upstream ships are not worth the choice
/// paralysis, and anyone who wants one can drop it in by hand.
pub const CATALOGUE: [ModelSpec; 8] = [
    ModelSpec {
        id: "tiny",
        label: "Tiny",
        size_label: "75 MiB",
        approx_bytes: 75 * MIB,
        sha1: "bd577a113a864445d4c299885e0cb97d4ba92b5f",
        multilingual: true,
        note: "Fastest; rough. Good for checking that transcription works.",
    },
    ModelSpec {
        id: "tiny.en",
        label: "Tiny (English)",
        size_label: "75 MiB",
        approx_bytes: 75 * MIB,
        sha1: "c78c86eb1a8faa21b369bcd33207cc90d64ae9df",
        multilingual: false,
        note: "Fastest; rough. English only.",
    },
    ModelSpec {
        id: "base",
        label: "Base",
        size_label: "142 MiB",
        approx_bytes: 142 * MIB,
        sha1: "465707469ff3a37a2b9b8d8f89f2f99de7299dac",
        multilingual: true,
        note: "Still quick. Usable for clean, close-miked speech.",
    },
    ModelSpec {
        id: "base.en",
        label: "Base (English)",
        size_label: "142 MiB",
        approx_bytes: 142 * MIB,
        sha1: "137c40403d78fd54d454da0f9bd998f78703390c",
        multilingual: false,
        note: "Still quick. English only.",
    },
    ModelSpec {
        id: "small",
        label: "Small",
        size_label: "466 MiB",
        approx_bytes: 466 * MIB,
        sha1: "55356645c2b361a969dfd0ef2c5a50d530afd8d5",
        multilingual: true,
        note: "A reasonable default for interview audio on a modern laptop.",
    },
    ModelSpec {
        id: "small.en",
        label: "Small (English)",
        size_label: "466 MiB",
        approx_bytes: 466 * MIB,
        sha1: "db8a495a91d927739e50b3fc1cc4c6b8f6c2d022",
        multilingual: false,
        note: "A reasonable default for English interview audio.",
    },
    ModelSpec {
        id: "medium",
        label: "Medium",
        size_label: "1.5 GiB",
        approx_bytes: 1536 * MIB,
        sha1: "fd9727b6e1217c2f614f9b698455c4ffd82463b4",
        multilingual: true,
        note: "Noticeably better on accents and crosstalk; several times slower.",
    },
    ModelSpec {
        id: "large-v3-turbo",
        label: "Large v3 Turbo",
        size_label: "1.5 GiB",
        approx_bytes: 1620 * MIB,
        sha1: "4af2b29d7ec73d781377bfd1758ca957a807e941",
        multilingual: true,
        note: "The best Misket offers, and nearly as fast as medium.",
    },
];

pub fn spec(id: &str) -> Option<&'static ModelSpec> {
    CATALOGUE.iter().find(|m| m.id == id)
}

/// The file name a model is stored under, both upstream and locally.
pub fn file_name(id: &str) -> String {
    format!("ggml-{id}.bin")
}

pub fn download_url(id: &str) -> String {
    format!("{BASE_URL}/{}", file_name(id))
}

/// `<app data dir>/models/whisper`, created on first use.
pub fn models_dir(base: &Path) -> Result<PathBuf> {
    let dir = base.join("models").join("whisper");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// A model as the Settings table shows it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: String,
    pub label: String,
    pub size_label: String,
    pub multilingual: bool,
    pub note: String,
    /// `true` once the full file is on disk.
    pub installed: bool,
    pub path: Option<String>,
    /// Bytes of a half-finished download waiting to be resumed.
    pub partial_bytes: u64,
    /// `false` for a file the person added by hand: Misket has no digest to
    /// check it against and does not pretend otherwise.
    pub known: bool,
}

/// Everything the Transcription settings page needs in one call.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelLibrary {
    /// Absolute path, shown so a person can drop a file in themselves.
    pub dir: String,
    pub models: Vec<ModelStatus>,
    /// The id currently chosen for transcription, if it is still installed.
    pub selected: Option<String>,
}

/// Read the catalogue plus anything else that looks like a model in `dir`.
pub fn library(dir: &Path, selected: Option<&str>) -> Result<ModelLibrary> {
    let mut models: Vec<ModelStatus> = CATALOGUE
        .iter()
        .map(|m| {
            let path = dir.join(file_name(m.id));
            let installed = path.is_file();
            ModelStatus {
                id: m.id.into(),
                label: m.label.into(),
                size_label: m.size_label.into(),
                multilingual: m.multilingual,
                note: m.note.into(),
                installed,
                path: installed.then(|| path.to_string_lossy().into_owned()),
                partial_bytes: partial_len(&part_path(&path)),
                known: true,
            }
        })
        .collect();

    // Anything else ending in .bin was put there by hand; list it so it can
    // be used and deleted like the rest.
    let known: Vec<String> = CATALOGUE.iter().map(|m| file_name(m.id)).collect();
    let mut extra: Vec<PathBuf> = std::fs::read_dir(dir)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension().and_then(|e| e.to_str()) == Some("bin")
                && !known
                    .iter()
                    .any(|k| p.file_name().is_some_and(|n| n == k.as_str()))
        })
        .collect();
    extra.sort();
    for path in extra {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        models.push(ModelStatus {
            id: name.clone(),
            label: name,
            size_label: human_bytes(bytes),
            multilingual: true,
            note: "Added by hand; Misket cannot check it against a published digest.".into(),
            installed: true,
            path: Some(path.to_string_lossy().into_owned()),
            partial_bytes: 0,
            known: false,
        });
    }

    let selected = selected
        .filter(|id| models.iter().any(|m| m.id == *id && m.installed))
        .map(str::to_owned);
    Ok(ModelLibrary {
        dir: dir.to_string_lossy().into_owned(),
        models,
        selected,
    })
}

/// The absolute path of an installed model, by id. A catalogue id resolves to
/// its canonical file name; anything else is taken as a bare file name in the
/// same directory (a hand-added model), never as a path.
pub fn installed_path(dir: &Path, id: &str) -> Result<PathBuf> {
    let name = if spec(id).is_some() {
        file_name(id)
    } else {
        if !is_bare_filename(id) {
            return Err(AppError::Validation(format!("not a model name: {id}")));
        }
        id.to_string()
    };
    let path = dir.join(name);
    if !path.is_file() {
        return Err(AppError::NotFound(format!(
            "the transcription model \"{id}\" is not installed"
        )));
    }
    Ok(path)
}

/// Delete an installed model (and any half-finished download of it).
pub fn remove(dir: &Path, id: &str) -> Result<()> {
    let path = installed_path(dir, id)?;
    std::fs::remove_file(&path)?;
    let part = part_path(&path);
    if part.exists() {
        std::fs::remove_file(part)?;
    }
    Ok(())
}

/// Copy a `.bin` a person picked into the models folder. Refuses anything
/// that does not start with the ggml magic, which catches the usual mistake
/// of picking a PyTorch `.pt` or a `.zip`.
pub fn add_from_file(dir: &Path, source: &Path) -> Result<String> {
    let mut head = [0u8; 4];
    let mut f = std::fs::File::open(source)?;
    f.read_exact(&mut head)
        .map_err(|_| AppError::Validation("that file is too small to be a Whisper model".into()))?;
    if !GGML_MAGIC.contains(&&head) {
        return Err(AppError::Validation(
            "that is not a ggml Whisper model. Misket needs a ggml-*.bin file, the kind \
             whisper.cpp uses — not a PyTorch checkpoint or an archive."
                .into(),
        ));
    }
    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| is_bare_filename(n))
        .ok_or_else(|| AppError::Validation("that file has no usable name".into()))?;
    let name = if name.ends_with(".bin") {
        name.to_string()
    } else {
        format!("{name}.bin")
    };
    let target = dir.join(&name);
    if target.exists() {
        return Err(AppError::Conflict(format!(
            "a model called \"{name}\" is already installed"
        )));
    }
    std::fs::copy(source, &target)?;
    // A file whose name matches a catalogue entry is reported under that id.
    Ok(CATALOGUE
        .iter()
        .find(|m| file_name(m.id) == name)
        .map(|m| m.id.to_string())
        .unwrap_or(name))
}

/// Download `id` into `dir`, resuming a `.part` file if one is there.
///
/// `on_progress(received, total)` is called as bytes land; `cancel` is polled
/// between chunks so the UI can stop a 1.5 GiB download without waiting for
/// it. A cancelled download keeps its `.part` file, so pressing Download
/// again picks up where it stopped.
pub fn download(
    dir: &Path,
    id: &str,
    mut on_progress: impl FnMut(u64, u64),
    cancel: &dyn Fn() -> bool,
) -> Result<PathBuf> {
    let spec = spec(id).ok_or_else(|| AppError::Validation(format!("unknown model \"{id}\"")))?;
    let target = dir.join(file_name(id));
    if target.is_file() {
        return Ok(target);
    }
    let part = part_path(&target);
    let have = partial_len(&part);

    let mut request = ureq::get(&download_url(id));
    if have > 0 {
        request = request.set("Range", &format!("bytes={have}-"));
    }
    let response = request
        .call()
        .map_err(|e| AppError::Io(format!("could not reach the model download: {e}")))?;

    // 206 means the server honoured the range; 200 means it sent the whole
    // file again, so whatever we had is thrown away rather than doubled up.
    let resuming = response.status() == 206;
    let remaining: u64 = response
        .header("Content-Length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let total = if resuming {
        have + remaining
    } else {
        remaining.max(spec.approx_bytes)
    };

    let mut file = if resuming && have > 0 {
        let mut f = std::fs::OpenOptions::new().append(true).open(&part)?;
        f.seek(SeekFrom::End(0))?;
        f
    } else {
        std::fs::File::create(&part)?
    };
    let mut received = if resuming { have } else { 0 };
    on_progress(received, total);

    let mut reader = response.into_reader();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        if cancel() {
            file.flush()?;
            return Err(AppError::Validation("the download was cancelled".into()));
        }
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])?;
        received += n as u64;
        on_progress(received, total.max(received));
    }
    file.flush()?;
    drop(file);

    let digest = sha1_of(&part)?;
    if digest != spec.sha1 {
        std::fs::remove_file(&part)?;
        return Err(AppError::Validation(format!(
            "the downloaded file does not match the published checksum for \"{id}\" \
             (expected {}, got {digest}). It has been discarded; try again.",
            spec.sha1
        )));
    }
    std::fs::rename(&part, &target)?;
    Ok(target)
}

/// Verify an installed catalogue model against its published digest. Returns
/// `Ok(None)` for a hand-added model, which has no digest to check.
pub fn verify(dir: &Path, id: &str) -> Result<Option<bool>> {
    let Some(spec) = spec(id) else {
        return Ok(None);
    };
    let path = installed_path(dir, id)?;
    Ok(Some(sha1_of(&path)? == spec.sha1))
}

fn part_path(target: &Path) -> PathBuf {
    let mut s = target.as_os_str().to_os_string();
    s.push(".part");
    PathBuf::from(s)
}

fn partial_len(part: &Path) -> u64 {
    std::fs::metadata(part).map(|m| m.len()).unwrap_or(0)
}

pub fn sha1_of(path: &Path) -> Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut hasher = Sha1::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// A bare file name: no separators, no `..`. Model ids reach the filesystem,
/// so they never get to name a path.
fn is_bare_filename(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..")
}

fn human_bytes(bytes: u64) -> String {
    const GIB: f64 = (1024 * 1024 * 1024) as f64;
    const MIB_F: f64 = (1024 * 1024) as f64;
    if bytes as f64 >= GIB {
        format!("{:.1} GiB", bytes as f64 / GIB)
    } else {
        format!("{:.0} MiB", bytes as f64 / MIB_F)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn the_catalogue_parses_into_urls_and_file_names() {
        assert_eq!(file_name("tiny.en"), "ggml-tiny.en.bin");
        assert_eq!(
            download_url("large-v3-turbo"),
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
        );
        assert!(spec("small").unwrap().multilingual);
        assert!(!spec("small.en").unwrap().multilingual);
        assert!(spec("nope").is_none());
        for m in CATALOGUE {
            assert_eq!(m.sha1.len(), 40, "{} has no published digest", m.id);
            assert!(m.sha1.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(m.approx_bytes > 0);
        }
    }

    #[test]
    fn a_fresh_machine_has_nothing_installed() {
        let d = dir();
        let lib = library(&models_dir(d.path()).unwrap(), Some("small")).unwrap();
        assert_eq!(lib.models.len(), CATALOGUE.len());
        assert!(lib.models.iter().all(|m| !m.installed));
        assert_eq!(
            lib.selected, None,
            "a model that is not there is not selected"
        );
    }

    #[test]
    fn an_installed_model_is_listed_and_resolvable() {
        let d = dir();
        let models = models_dir(d.path()).unwrap();
        std::fs::write(models.join("ggml-tiny.en.bin"), b"ggml....").unwrap();
        let lib = library(&models, Some("tiny.en")).unwrap();
        let entry = lib.models.iter().find(|m| m.id == "tiny.en").unwrap();
        assert!(entry.installed);
        assert!(entry.known);
        assert_eq!(lib.selected.as_deref(), Some("tiny.en"));
        assert!(installed_path(&models, "tiny.en").unwrap().is_file());
    }

    #[test]
    fn a_half_finished_download_is_reported_so_it_can_be_resumed() {
        let d = dir();
        let models = models_dir(d.path()).unwrap();
        std::fs::write(models.join("ggml-base.bin.part"), vec![0u8; 4096]).unwrap();
        let lib = library(&models, None).unwrap();
        let entry = lib.models.iter().find(|m| m.id == "base").unwrap();
        assert!(!entry.installed);
        assert_eq!(entry.partial_bytes, 4096);
    }

    #[test]
    fn a_hand_added_model_is_listed_but_not_claimed_to_be_verified() {
        let d = dir();
        let models = models_dir(d.path()).unwrap();
        let source = d.path().join("my-model.bin");
        std::fs::write(&source, b"ggmlwhatever").unwrap();
        let id = add_from_file(&models, &source).unwrap();
        assert_eq!(id, "my-model.bin");
        let lib = library(&models, Some("my-model.bin")).unwrap();
        let entry = lib.models.iter().find(|m| m.id == "my-model.bin").unwrap();
        assert!(entry.installed && !entry.known);
        assert_eq!(verify(&models, "my-model.bin").unwrap(), None);
    }

    #[test]
    fn adding_a_catalogue_file_by_hand_reports_its_catalogue_id() {
        let d = dir();
        let models = models_dir(d.path()).unwrap();
        let source = d.path().join("ggml-tiny.bin");
        std::fs::write(&source, b"ggml1234").unwrap();
        assert_eq!(add_from_file(&models, &source).unwrap(), "tiny");
        assert!(
            add_from_file(&models, &source).is_err(),
            "no silent overwrite"
        );
    }

    #[test]
    fn a_file_that_is_not_a_ggml_model_is_refused() {
        let d = dir();
        let models = models_dir(d.path()).unwrap();
        let source = d.path().join("checkpoint.pt");
        std::fs::write(&source, b"PK\x03\x04 not a model").unwrap();
        let err = add_from_file(&models, &source).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
        let tiny = d.path().join("tiny.bin");
        std::fs::write(&tiny, b"gg").unwrap();
        assert!(add_from_file(&models, &tiny).is_err(), "too short");
    }

    #[test]
    fn checksums_are_computed_and_compared() {
        let d = dir();
        let models = models_dir(d.path()).unwrap();
        let f = models.join("ggml-tiny.bin");
        std::fs::write(&f, b"ggml-abc").unwrap();
        // sha1("ggml-abc"), computed independently.
        let digest = sha1_of(&f).unwrap();
        assert_eq!(digest.len(), 40);
        assert_ne!(
            digest,
            spec("tiny").unwrap().sha1,
            "a stand-in file must not pass as the real model"
        );
        assert_eq!(verify(&models, "tiny").unwrap(), Some(false));
    }

    #[test]
    fn model_ids_cannot_name_a_path() {
        let d = dir();
        let models = models_dir(d.path()).unwrap();
        for bad in ["../../etc/passwd", "a/b.bin", "a\\b.bin", ""] {
            assert!(matches!(
                installed_path(&models, bad),
                Err(AppError::Validation(_))
            ));
        }
    }

    #[test]
    fn deleting_a_model_takes_its_part_file_too() {
        let d = dir();
        let models = models_dir(d.path()).unwrap();
        std::fs::write(models.join("ggml-tiny.bin"), b"ggml1234").unwrap();
        std::fs::write(models.join("ggml-tiny.bin.part"), b"xx").unwrap();
        remove(&models, "tiny").unwrap();
        assert!(!models.join("ggml-tiny.bin").exists());
        assert!(!models.join("ggml-tiny.bin.part").exists());
        assert!(remove(&models, "tiny").is_err());
    }

    #[test]
    fn sizes_read_the_way_a_person_would_write_them() {
        assert_eq!(human_bytes(75 * MIB), "75 MiB");
        assert_eq!(human_bytes(1536 * MIB), "1.5 GiB");
    }
}
