//! Persistent app settings, stored as JSON in the app config directory
//! (same pattern as `recent.rs`).

use std::path::{Path, PathBuf};

use misket_core::models::Coder;
use misket_core::Result;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

fn default_font_size() -> f64 {
    17.0
}

fn default_line_height() -> f64 {
    1.7
}

fn default_keep_backups() -> u32 {
    20
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub theme: Theme,
    #[serde(default = "default_font_size")]
    pub editor_font_size: f64,
    #[serde(default = "default_line_height")]
    pub editor_line_height: f64,
    #[serde(default)]
    pub confirm_delete_excerpt: bool,
    /// How many timestamped backups to keep per project.
    #[serde(default = "default_keep_backups")]
    pub keep_backups: u32,
    /// Show a paragraph number in the document view's left gutter.
    #[serde(default = "default_true")]
    pub show_paragraph_numbers: bool,
    /// Lay a transcript's speaker labels out in a gutter beside the text
    /// rather than leaving them inline where the document stores them.
    #[serde(default = "default_true")]
    pub show_speaker_gutter: bool,
    /// The name recorded as the actor in a project's activity log, and the
    /// local coder's name. Empty (or absent) means "use the OS user name".
    #[serde(default)]
    pub coder_name: Option<String>,
    /// This install's coder id (`misket_core::db::coders`): a UUID generated
    /// once, the first time it is needed, and never changed. It is what tells
    /// two people's copies of a project apart when one is merged into the
    /// other. Absent in a settings file written before coder identity; the
    /// first [`coder`] call fills it in.
    #[serde(default)]
    pub coder_id: Option<String>,
    /// The colour this coder's work is drawn in. Absent means "pick one".
    #[serde(default)]
    pub coder_color: Option<String>,
    /// Colour the document view's underline lanes by who applied the code
    /// rather than by the code itself. Off by default: a codebook's colours
    /// are what most people are reading for.
    #[serde(default)]
    pub lanes_by_coder: bool,
    /// Copy audio and video files into `<project>.media/` on import instead
    /// of pointing at where they already are. Off by default: a recording is
    /// held by reference precisely so a project file stays small. The import
    /// dialog offers it per batch and remembers the answer here.
    #[serde(default)]
    pub copy_media_into_project: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            theme: Theme::default(),
            editor_font_size: default_font_size(),
            editor_line_height: default_line_height(),
            confirm_delete_excerpt: false,
            keep_backups: default_keep_backups(),
            show_paragraph_numbers: default_true(),
            show_speaker_gutter: default_true(),
            coder_name: None,
            coder_id: None,
            coder_color: None,
            lanes_by_coder: false,
            copy_media_into_project: false,
        }
    }
}

fn file(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| misket_core::AppError::Io(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("settings.json"))
}

/// Read settings from `path`, falling back to defaults if the file is
/// missing or unreadable. Factored out of `load` so it can be unit-tested
/// against a temp directory instead of a running Tauri app.
fn read(path: &Path) -> Result<AppSettings> {
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn write(path: &Path, settings: &AppSettings) -> Result<()> {
    std::fs::write(path, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}

/// The OS user name, `whoami`-style: Misket has no accounts, so this is the
/// best default for "who did this".
fn os_user_name() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// Who the activity log should credit: the name set in settings, or the OS
/// user name, or nothing at all.
pub fn actor_name(settings: &AppSettings) -> String {
    match settings.coder_name.as_deref().map(str::trim) {
        Some(name) if !name.is_empty() => name.to_string(),
        _ => os_user_name(),
    }
}

/// The default colour for a new coder, derived from the id so two installs
/// rarely land on the same one.
fn default_coder_color(id: &str) -> String {
    misket_core::db::coders::color_for(id)
}

/// Who this install is, as a project file records it: id, name and colour.
///
/// The id is generated the first time it is asked for and written straight
/// back to the settings file, so it is stable from then on — it is the whole
/// point of the thing. Returns the settings as they now stand alongside the
/// coder, because that write may have changed them.
pub fn coder(app: &AppHandle, settings: &AppSettings) -> (AppSettings, Coder) {
    let mut settings = settings.clone();
    let mut changed = false;
    let id = match settings.coder_id.as_deref().map(str::trim) {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            let id = misket_core::db::util::new_id();
            settings.coder_id = Some(id.clone());
            changed = true;
            id
        }
    };
    let color = match settings.coder_color.as_deref().map(str::trim) {
        Some(c) if !c.is_empty() => c.to_string(),
        _ => {
            let c = default_coder_color(&id);
            settings.coder_color = Some(c.clone());
            changed = true;
            c
        }
    };
    if changed {
        let _ = save(app, &settings);
    }
    let name = actor_name(&settings);
    (
        settings,
        Coder {
            id,
            name,
            color,
            created_at: String::new(),
        },
    )
}

pub fn load(app: &AppHandle) -> Result<AppSettings> {
    read(&file(app)?)
}

pub fn save(app: &AppHandle, settings: &AppSettings) -> Result<()> {
    write(&file(app)?, settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_returns_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        assert_eq!(read(&path).unwrap(), AppSettings::default());
    }

    #[test]
    fn round_trips_through_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = AppSettings {
            theme: Theme::Dark,
            editor_font_size: 20.0,
            editor_line_height: 1.9,
            confirm_delete_excerpt: true,
            keep_backups: 5,
            show_paragraph_numbers: false,
            show_speaker_gutter: false,
            coder_name: Some("Ada".into()),
            coder_id: Some("11111111-2222-3333-4444-555555555555".into()),
            coder_color: Some("#5CB85C".into()),
            lanes_by_coder: true,
            copy_media_into_project: true,
        };
        write(&path, &settings).unwrap();
        assert_eq!(read(&path).unwrap(), settings);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "not valid json").unwrap();
        assert_eq!(read(&path).unwrap(), AppSettings::default());
    }

    #[test]
    fn partial_file_fills_in_missing_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"theme":"light"}"#).unwrap();
        let settings = read(&path).unwrap();
        assert_eq!(settings.theme, Theme::Light);
        assert_eq!(settings.editor_font_size, default_font_size());
        assert_eq!(settings.editor_line_height, default_line_height());
        assert!(!settings.confirm_delete_excerpt);
        assert_eq!(settings.keep_backups, default_keep_backups());
        assert!(settings.show_paragraph_numbers);
        assert_eq!(settings.coder_name, None);
        assert_eq!(settings.coder_id, None);
        assert!(!settings.lanes_by_coder);
    }

    #[test]
    fn coder_name_is_whoever_is_at_the_keyboard() {
        // No setting: fall back to the OS user name, whatever it is.
        assert_eq!(actor_name(&AppSettings::default()), os_user_name());
        let named = AppSettings {
            coder_name: Some("  Ada Lovelace  ".into()),
            ..AppSettings::default()
        };
        assert_eq!(actor_name(&named), "Ada Lovelace");
        // A blank name is no name.
        let blank = AppSettings {
            coder_name: Some("   ".into()),
            ..AppSettings::default()
        };
        assert_eq!(actor_name(&blank), os_user_name());
    }
}
