//! Detection of a project living inside a folder a cloud sync client manages
//! (Dropbox, OneDrive, Google Drive, iCloud Drive, Box, Nextcloud/ownCloud,
//! Syncthing, MEGA, pCloud, ...).
//!
//! Sync clients rewrite files out from under an application, and a few of
//! them (notably OneDrive and Dropbox, per their own support articles) are
//! documented causes of SQLite corruption when the file is open while it
//! syncs. Misket never refuses to open a project here — it only warns, once,
//! and lets the person decide.

use std::path::{Component, Path};

/// The sync client (or protocol) whose folder the project appears to live in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncProvider {
    pub name: String,
}

impl SyncProvider {
    fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
        }
    }
}

/// Path components (compared case-insensitively) that name a well-known sync
/// client's folder outright.
const NAMED_FOLDERS: &[(&str, &str)] = &[
    ("dropbox", "Dropbox"),
    ("google drive", "Google Drive"),
    ("googledrive", "Google Drive"),
    ("my drive", "Google Drive"),
    ("icloud drive", "iCloud Drive"),
    ("box", "Box"),
    ("nextcloud", "Nextcloud"),
    ("owncloud", "ownCloud"),
    ("syncthing", "Syncthing"),
    ("mega", "MEGA"),
    ("pcloud", "pCloud"),
];

fn provider_from_component(name: &str) -> Option<SyncProvider> {
    let lower = name.to_ascii_lowercase();
    // macOS's real on-disk path for iCloud Drive is
    // `.../Library/Mobile Documents/com~apple~CloudDocs/...`; that last
    // component is distinctive enough to check on its own.
    if lower == "com~apple~clouddocs" {
        return Some(SyncProvider::new("iCloud Drive"));
    }
    // The desktop client often suffixes this with an organization name, e.g.
    // "OneDrive - Acme Corp".
    if lower.starts_with("onedrive") {
        return Some(SyncProvider::new("OneDrive"));
    }
    NAMED_FOLDERS
        .iter()
        .find(|(needle, _)| lower == *needle)
        .map(|(_, label)| SyncProvider::new(label))
}

/// Marker files/folders a sync client drops into every folder it manages,
/// for clients that (unlike the ones above) don't always use a distinctive
/// folder name.
fn provider_from_markers(dir: &Path) -> Option<SyncProvider> {
    if dir.join(".dropbox").exists() {
        return Some(SyncProvider::new("Dropbox"));
    }
    if dir.join(".icloud").exists() {
        return Some(SyncProvider::new("iCloud Drive"));
    }
    if dir.join(".sync").exists() {
        return Some(SyncProvider::new("Syncthing"));
    }
    if let Ok(contents) = std::fs::read(dir.join("desktop.ini")) {
        let text = String::from_utf8_lossy(&contents).to_ascii_lowercase();
        if text.contains("onedrive") {
            return Some(SyncProvider::new("OneDrive"));
        }
    }
    None
}

/// Is `path` (a project file; it need not exist yet) inside a folder a sync
/// client manages?
///
/// Checks every path component's name against well-known sync-folder names
/// first (root to leaf, so the outermost match wins when several folders in
/// the path qualify), then falls back to marker files/folders sync clients
/// drop into every directory they manage, checked on every ancestor
/// directory of the project file.
pub fn detect_sync_folder(path: &Path) -> Option<SyncProvider> {
    for component in path.components() {
        if let Component::Normal(os) = component {
            if let Some(name) = os.to_str() {
                if let Some(provider) = provider_from_component(name) {
                    return Some(provider);
                }
            }
        }
    }
    let mut dir = path.parent();
    while let Some(d) = dir {
        if let Some(provider) = provider_from_markers(d) {
            return Some(provider);
        }
        dir = d.parent();
    }
    None
}

/// The full warning shown once per project when [`detect_sync_folder`] finds
/// a match, naming the provider and the backups folder next to the project.
pub fn warning_message(provider: &SyncProvider, project_path: &Path) -> String {
    let stem = project_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("project");
    format!(
        "This project is inside {name}. Sync clients can corrupt an open database. Keep it here \
         only if you close Misket before the folder syncs to another machine, or move it to a \
         local folder. Backups are in {stem}.backups next to the file.",
        name = provider.name
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name(path: &str) -> Option<String> {
        detect_sync_folder(Path::new(path)).map(|p| p.name)
    }

    #[test]
    fn detects_dropbox_by_folder_name() {
        assert_eq!(
            name("/home/alice/Dropbox/Study/interviews.misket"),
            Some("Dropbox".into())
        );
        // Case-insensitive.
        assert_eq!(
            name("/home/alice/dropbox/Study/interviews.misket"),
            Some("Dropbox".into())
        );
    }

    #[test]
    fn detects_onedrive_with_an_organization_suffix() {
        assert_eq!(
            name("C:/Users/alice/OneDrive - Acme Corp/Study/interviews.misket"),
            Some("OneDrive".into())
        );
        assert_eq!(
            name("/home/alice/OneDrive/interviews.misket"),
            Some("OneDrive".into())
        );
    }

    #[test]
    fn detects_google_drive_and_my_drive() {
        assert_eq!(
            name("/home/alice/Google Drive/My Drive/interviews.misket"),
            Some("Google Drive".into())
        );
        assert_eq!(
            name("/home/alice/GoogleDrive/interviews.misket"),
            Some("Google Drive".into())
        );
    }

    #[test]
    fn detects_icloud_drive_by_its_real_macos_path() {
        assert_eq!(
            name("/Users/alice/Library/Mobile Documents/com~apple~CloudDocs/study.misket"),
            Some("iCloud Drive".into())
        );
        assert_eq!(
            name("/Users/alice/iCloud Drive/study.misket"),
            Some("iCloud Drive".into())
        );
    }

    #[test]
    fn detects_the_remaining_named_providers() {
        for (folder, provider) in [
            ("Box", "Box"),
            ("Nextcloud", "Nextcloud"),
            ("ownCloud", "ownCloud"),
            ("Syncthing", "Syncthing"),
            ("MEGA", "MEGA"),
            ("pCloud", "pCloud"),
        ] {
            assert_eq!(
                name(&format!("/home/alice/{folder}/study.misket")),
                Some(provider.into()),
                "{folder}"
            );
        }
    }

    #[test]
    fn a_plain_local_path_is_not_flagged() {
        assert_eq!(name("/home/alice/Documents/study.misket"), None);
        assert_eq!(name("/home/alice/Dropbox-notes/study.misket"), None);
        assert_eq!(name("C:/Users/alice/Boxing/study.misket"), None);
    }

    #[test]
    fn detects_dropbox_via_a_marker_file_in_an_ancestor() {
        let dir = tempfile::tempdir().unwrap();
        let synced = dir.path().join("Personal Files");
        std::fs::create_dir_all(&synced).unwrap();
        std::fs::write(synced.join(".dropbox"), b"").unwrap();
        let project = synced.join("nested").join("study.misket");
        assert_eq!(
            detect_sync_folder(&project).map(|p| p.name),
            Some("Dropbox".into())
        );
    }

    #[test]
    fn detects_icloud_via_a_marker_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".icloud"), b"").unwrap();
        let project = dir.path().join("study.misket");
        assert_eq!(
            detect_sync_folder(&project).map(|p| p.name),
            Some("iCloud Drive".into())
        );
    }

    #[test]
    fn detects_syncthing_via_a_marker_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".sync")).unwrap();
        let project = dir.path().join("study.misket");
        assert_eq!(
            detect_sync_folder(&project).map(|p| p.name),
            Some("Syncthing".into())
        );
    }

    #[test]
    fn detects_onedrive_via_a_desktop_ini_marker() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("desktop.ini"),
            b"[.ShellClassInfo]\nIconResource=OneDrive.ico\n",
        )
        .unwrap();
        let project = dir.path().join("study.misket");
        assert_eq!(
            detect_sync_folder(&project).map(|p| p.name),
            Some("OneDrive".into())
        );
    }

    #[test]
    fn a_plain_local_folder_has_no_markers() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("study.misket");
        assert_eq!(detect_sync_folder(&project), None);
    }

    #[test]
    fn warning_message_names_the_provider_and_the_backups_folder() {
        let msg = warning_message(
            &SyncProvider::new("Dropbox"),
            Path::new("/home/alice/Dropbox/study.misket"),
        );
        assert!(msg.contains("inside Dropbox"));
        assert!(msg.contains("study.backups"));
    }
}
