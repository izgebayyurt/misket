//! The assisted-coding commands.
//!
//! Each one is a single request to whichever provider the person configured,
//! and each one refuses to run unless the matching toggle in Settings →
//! Assistance is on. Nothing here writes to the project: the answer comes
//! back as text, the frontend turns it into a suggestion, and the person
//! accepts it through the ordinary commands.

use misket_core::{AppError, Result};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::assist::{
    self, AssistLogEntry, AssistState, ChatRequest, Feature, Provider, ANTHROPIC_MODELS,
};

/// The event a streamed reply arrives on, one piece of text at a time:
/// `{ requestId, text }`. The command's own return value is the whole thing,
/// so a listener that misses a frame is not left with a hole.
pub const DELTA_EVENT: &str = "misket://assist-delta";

/// The largest prompt that will be sent, in bytes. The prompt builders cap
/// what they put in; this is the backstop, so a bug upstream cannot turn into
/// a surprise bill.
pub const MAX_PROMPT_BYTES: usize = 64 * 1024;

/// What the settings pane needs to know without being told any secrets.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistStatus {
    /// Is there a key at all? Never the key itself.
    pub has_key: bool,
    /// The key came from `MISKET_ASSIST_API_KEY`, not the credential store,
    /// so the pane can say so rather than look broken.
    pub key_from_env: bool,
    /// Could the OS credential store be reached? False means a key can still
    /// be typed in, it just will not survive a restart.
    pub keychain_available: bool,
    /// The short list of models offered for the Anthropic provider.
    pub anthropic_models: Vec<String>,
    /// The "Local (Ollama)" preset's base URL.
    pub ollama_base_url: String,
    /// Empty when a request could be made right now; otherwise why not.
    pub blocked: Option<String>,
}

/// One finished answer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistReply {
    pub text: String,
    /// What to record on anything the person accepts out of this.
    pub provider: String,
    pub model: String,
}

/// The assistance section of the saved settings, or all-off if they cannot be
/// read at all.
fn settings_of(app: &AppHandle) -> assist::AssistSettings {
    crate::settings::load(app).unwrap_or_default().assist
}

/// Is assistance configured well enough to make a request? Returns the reason
/// it is not, for the settings pane and for a toast.
fn blocked_reason(s: &assist::AssistSettings, has_key: bool) -> Option<String> {
    if s.model.trim().is_empty() {
        return Some("no model is set".into());
    }
    match s.provider {
        Provider::Anthropic if !has_key => Some("no API key is set".into()),
        Provider::OpenAiCompatible if s.base_url.trim().is_empty() => {
            Some("no base URL is set".into())
        }
        _ => None,
    }
}

#[tauri::command]
pub fn assist_status(app: AppHandle, state: State<'_, AssistState>) -> Result<AssistStatus> {
    let s = settings_of(&app);
    let stored = state.store.get().unwrap_or(None);
    let key = assist::api_key(state.store.as_ref()).unwrap_or(None);
    // The key came from the environment when there is one and it is not the
    // one the store holds.
    let key_from_env = key.is_some() && stored.as_deref() != key.as_deref();
    Ok(AssistStatus {
        has_key: key.is_some(),
        key_from_env,
        keychain_available: state.store.persistent(),
        anthropic_models: ANTHROPIC_MODELS.iter().map(|m| m.to_string()).collect(),
        ollama_base_url: assist::OLLAMA_BASE.to_string(),
        blocked: blocked_reason(&s, key.is_some()),
    })
}

#[tauri::command]
pub fn assist_set_api_key(state: State<'_, AssistState>, key: String) -> Result<()> {
    let key = key.trim();
    if key.is_empty() {
        return state.store.clear();
    }
    state.store.set(key)
}

#[tauri::command]
pub fn assist_clear_api_key(state: State<'_, AssistState>) -> Result<()> {
    state.store.clear()
}

#[tauri::command]
pub fn assist_requests(state: State<'_, AssistState>) -> Result<Vec<AssistLogEntry>> {
    Ok(state.entries())
}

#[tauri::command]
pub fn assist_clear_requests(state: State<'_, AssistState>) -> Result<()> {
    state.clear_log();
    Ok(())
}

#[tauri::command]
pub fn assist_cancel(state: State<'_, AssistState>, request_id: String) -> Result<()> {
    state.cancel(&request_id);
    Ok(())
}

/// Ask the configured provider one question.
///
/// `feature` picks which toggle has to be on. `request_id`, when given, makes
/// the answer stream: deltas arrive as [`DELTA_EVENT`] events, and
/// `assist_cancel` with the same id stops it.
#[tauri::command]
pub async fn assist_complete(
    app: AppHandle,
    state: State<'_, AssistState>,
    feature: Feature,
    system: String,
    prompt: String,
    request_id: Option<String>,
) -> Result<AssistReply> {
    let settings = settings_of(&app);
    if !feature.enabled_in(&settings) {
        return Err(AppError::Validation(format!(
            "{} is switched off in Settings → Assistance",
            feature.as_str()
        )));
    }
    if system.len() + prompt.len() > MAX_PROMPT_BYTES {
        return Err(AppError::Validation(
            "that is too much text to send in one request".into(),
        ));
    }
    let req = ChatRequest {
        model: settings.model.trim().to_string(),
        system,
        user: prompt,
        max_tokens: settings.max_output_tokens.clamp(64, 8192),
        stream: request_id.is_some(),
    };
    run(&app, &state, &settings, feature, req, request_id).await
}

/// One tiny request, to prove the settings work. Answers with the reply so
/// the person can see the model actually said something.
#[tauri::command]
pub async fn assist_test_connection(
    app: AppHandle,
    state: State<'_, AssistState>,
) -> Result<AssistReply> {
    let settings = settings_of(&app);
    let req = ChatRequest {
        model: settings.model.trim().to_string(),
        system: "You are being checked by a connection test. Reply with exactly: ready".into(),
        user: "Reply with exactly: ready".into(),
        max_tokens: 64,
        stream: false,
    };
    run(&app, &state, &settings, Feature::TestConnection, req, None).await
}

/// Everything one request does: guard, send, read, log.
async fn run(
    app: &AppHandle,
    state: &AssistState,
    settings: &assist::AssistSettings,
    feature: Feature,
    req: ChatRequest,
    request_id: Option<String>,
) -> Result<AssistReply> {
    let key = assist::api_key(state.store.as_ref())?;
    if let Some(reason) = blocked_reason(settings, key.is_some()) {
        return Err(AppError::Validation(format!(
            "assistance is not set up: {reason}"
        )));
    }
    let _in_flight = state.begin_request()?;

    let provider = settings.provider;
    let url = assist::endpoint(provider, &settings.base_url)?;
    let body = match provider {
        Provider::Anthropic => assist::anthropic_body(&req),
        Provider::OpenAiCompatible => assist::openai_body(&req),
    };
    let request_bytes = req.system.len() + req.user.len();
    let started = AssistLogEntry {
        at: assist::now(),
        feature: feature.as_str().to_string(),
        provider: provider.as_str().to_string(),
        model: req.model.clone(),
        request_bytes,
        response_bytes: 0,
        outcome: String::new(),
    };

    let finish = |outcome: &str, response_bytes: usize| {
        state.log(AssistLogEntry {
            outcome: outcome.to_string(),
            response_bytes,
            ..started.clone()
        });
    };

    let result = send(
        app,
        state,
        provider,
        &url,
        &body,
        key.as_deref(),
        &request_id,
    )
    .await;
    if let Some(id) = &request_id {
        state.finish(id);
    }
    match result {
        Ok(text) => {
            finish("ok", text.len());
            // Names and sizes only: never the prompt, never the reply, never
            // the key (see `assist::redact`).
            tracing::info!(
                feature = feature.as_str(),
                provider = provider.as_str(),
                model = %req.model,
                request_bytes,
                response_bytes = text.len(),
                "assist request"
            );
            Ok(AssistReply {
                text,
                provider: provider.as_str().to_string(),
                model: req.model,
            })
        }
        Err(e) => {
            let outcome = match &e {
                AppError::Conflict(m) if m.contains("cancelled") => "cancelled".to_string(),
                other => assist::redact(&other.to_string(), key.as_deref()),
            };
            finish(&outcome, 0);
            tracing::warn!(
                feature = feature.as_str(),
                provider = provider.as_str(),
                model = %req.model,
                request_bytes,
                outcome = %outcome,
                "assist request failed"
            );
            Err(e)
        }
    }
}

/// The HTTP part, streamed or not.
async fn send(
    app: &AppHandle,
    state: &AssistState,
    provider: Provider,
    url: &str,
    body: &serde_json::Value,
    key: Option<&str>,
    request_id: &Option<String>,
) -> Result<String> {
    let mut request = state.client()?.post(url).json(body);
    for (name, value) in assist::headers(provider, key) {
        request = request.header(name, value);
    }
    let response = request.send().await.map_err(|e| {
        AppError::Io(assist::redact(
            &format!("could not reach the provider: {e}"),
            key,
        ))
    })?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(assist::http_error(status.as_u16(), &text, key));
    }

    let Some(id) = request_id.clone() else {
        let value: serde_json::Value = response
            .json()
            .await
            .map_err(|e| AppError::Validation(format!("could not read the reply: {e}")))?;
        return assist::response_text(provider, &value);
    };

    // Streamed: server-sent events, one `data:` payload per frame.
    let mut response = response;
    let mut buffer = String::new();
    let mut text = String::new();
    loop {
        if state.is_cancelled(&id) {
            return Err(AppError::Conflict("the request was cancelled".into()));
        }
        let chunk = response
            .chunk()
            .await
            .map_err(|e| AppError::Io(assist::redact(&format!("the stream broke: {e}"), key)))?;
        let Some(chunk) = chunk else { break };
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(newline) = buffer.find('\n') {
            let line = buffer[..newline].trim().to_string();
            buffer.drain(..newline + 1);
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            if let Some(delta) = assist::stream_delta(provider, data) {
                text.push_str(&delta);
                let _ = app.emit(
                    DELTA_EVENT,
                    serde_json::json!({ "requestId": id, "text": delta }),
                );
            }
        }
    }
    if text.trim().is_empty() {
        return Err(AppError::Validation("the provider returned no text".into()));
    }
    Ok(text)
}
