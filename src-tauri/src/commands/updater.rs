//! Whether the Tauri updater is actually usable, and a test-only escape
//! hatch for exercising the "update available" banner without a signed
//! release.
//!
//! `tauri.conf.json`'s `plugins.updater.pubkey` ships as a placeholder until
//! a maintainer runs `pnpm tauri signer generate` and swaps in the real
//! public key (see `docs/RELEASING.md`). Checking for updates against the
//! placeholder would always find an update nobody can install (signature
//! verification fails on every download), so the frontend treats it as
//! "updater not configured" and never calls the real endpoint — see
//! [`get_updater_status`].

use serde::Serialize;
use tauri::{AppHandle, Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

/// The pubkey a fresh clone ships with. Any other value (even a wrong one)
/// is treated as "configured" — a wrong key just fails signature
/// verification loudly at download time, which is a maintainer mistake to
/// fix, not something the frontend should silently paper over.
pub const PUBKEY_PLACEHOLDER: &str = "REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterStatus {
    /// False while the pubkey placeholder is still in place.
    pub configured: bool,
}

fn configured_pubkey<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.config()
        .plugins
        .0
        .get("updater")?
        .get("pubkey")?
        .as_str()
        .map(str::to_string)
}

/// A pubkey counts as configured once it is non-empty and not the shipped
/// placeholder. A wrong-but-real-looking key still counts: that fails
/// signature verification loudly at download time, a maintainer mistake to
/// fix rather than something the frontend should silently paper over.
fn is_configured(pubkey: Option<&str>) -> bool {
    matches!(pubkey, Some(key) if !key.is_empty() && key != PUBKEY_PLACEHOLDER)
}

#[tauri::command]
pub fn get_updater_status<R: Runtime>(app: AppHandle<R>) -> UpdaterStatus {
    UpdaterStatus {
        configured: is_configured(configured_pubkey(&app).as_deref()),
    }
}

/// Metadata shape matching `@tauri-apps/plugin-updater`'s `UpdateMetadata`,
/// so the frontend can build a real `Update` instance from it (and so a
/// subsequent "Install and restart" genuinely exercises the download and
/// signature check, which is expected to fail against a test `latest.json`
/// with no matching signing key).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct E2eUpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

/// Test-only: check for an update against `MISKET_E2E_UPDATE_JSON` (a
/// `latest.json` served over `http://127.0.0.1:<port>/...`) instead of the
/// real GitHub endpoint, so the "update available" banner can be exercised
/// and screenshotted without a signed release. Absent (returns `Ok(None)`
/// immediately) unless that variable is set; wired the same way as the
/// other `MISKET_E2E_*` variables in `commands::e2e`.
#[tauri::command]
pub async fn e2e_check_update<R: Runtime>(
    webview: Webview<R>,
) -> Result<Option<E2eUpdateMetadata>, String> {
    let raw_url = std::env::var("MISKET_E2E_UPDATE_JSON").unwrap_or_default();
    if raw_url.is_empty() {
        return Ok(None);
    }
    let url = Url::parse(&raw_url).map_err(|e| e.to_string())?;
    let updater = webview
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let metadata = E2eUpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update.date.map(|d| d.to_string()),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    };
    Ok(Some(metadata))
}

#[cfg(test)]
mod tests {
    use super::{is_configured, PUBKEY_PLACEHOLDER};

    #[test]
    fn placeholder_and_absent_are_not_configured() {
        assert!(!is_configured(Some(PUBKEY_PLACEHOLDER)));
        assert!(!is_configured(Some("")));
        assert!(!is_configured(None));
    }

    #[test]
    fn anything_else_is_configured() {
        assert!(is_configured(Some("dW50cnVzdGVkIGNvbW1lbnQ6...")));
    }

    /// `get_updater_status` compares the configured pubkey to this constant
    /// by value, so if they ever drift apart a fresh clone would wrongly
    /// report the updater as "configured" until a maintainer actually runs
    /// `pnpm tauri signer generate` and replaces both.
    #[test]
    fn placeholder_matches_the_shipped_tauri_conf() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let pubkey = conf["plugins"]["updater"]["pubkey"].as_str().unwrap();
        assert_eq!(pubkey, PUBKEY_PLACEHOLDER);
    }
}
