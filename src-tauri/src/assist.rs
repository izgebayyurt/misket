//! Assistance: the one place in Misket that talks to a model.
//!
//! Everything here is off unless somebody turned it on. There is no default
//! provider, no bundled key and no request made on the app's own initiative:
//! a feature toggle has to be on *and* a provider configured before a single
//! byte leaves the machine, and even then the result is a suggestion nobody
//! has accepted yet. Accepting one goes through the ordinary commands
//! (`apply_codes`, `create_memo`, `update_code`), so undo, coders and weights
//! all behave exactly as they do for work typed by hand — the only difference
//! is the `assisted` note the history entry carries
//! (`misket_core::db::activity::set_assisted`).
//!
//! Two provider shapes cover everything people asked for:
//!
//! - **Anthropic**, the Messages API (`POST /v1/messages`), which is its own
//!   request and response shape.
//! - **OpenAI-compatible**, `POST {base}/chat/completions`, which is what
//!   Ollama, LM Studio, llama.cpp, vLLM, OpenRouter and OpenAI itself all
//!   speak. A local model is just this with `http://localhost:11434/v1` and
//!   no key.
//!
//! The API key never touches `settings.json`. It lives in the OS credential
//! store (Keychain, Windows Credential Manager, Secret Service) behind
//! [`SecretStore`], so the trait can be swapped for an in-memory one in
//! tests, and it is scrubbed out of anything that gets logged or shown
//! ([`redact`]).

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use misket_core::{AppError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// ------------------------------------------------------------------ settings

/// Which shape of HTTP API the configured provider speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    #[default]
    Anthropic,
    /// Anything that speaks `POST {base}/chat/completions`, local or hosted.
    OpenAiCompatible,
}

impl Provider {
    /// The name written into the history entry and the request log.
    pub fn as_str(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::OpenAiCompatible => "openai-compatible",
        }
    }
}

/// The Anthropic API version header. Pinned: the wire shape below is the one
/// this version documents.
pub const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Where Anthropic's Messages API lives when no base URL is configured.
pub const ANTHROPIC_BASE: &str = "https://api.anthropic.com";
/// The default model: the current Sonnet-class model, which is the sensible
/// middle for short, cheap, frequent calls like these.
pub const DEFAULT_MODEL: &str = "claude-sonnet-5";
/// The short list the settings pane offers for Anthropic. Any other model id
/// can still be typed in; this is a convenience, not a whitelist.
pub const ANTHROPIC_MODELS: &[&str] = &["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"];
/// The "Local (Ollama)" preset. Needs no key and never leaves the machine.
pub const OLLAMA_BASE: &str = "http://localhost:11434/v1";

fn default_model() -> String {
    DEFAULT_MODEL.to_string()
}

fn default_max_output_tokens() -> u32 {
    1200
}

/// Which of the three assisted features are switched on, and where to ask.
///
/// Every toggle is `false` by default and `#[serde(default)]` everywhere, so
/// a settings file written before this feature existed — or one with the
/// section deleted — reads back as "assistance off, nothing configured".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistSettings {
    #[serde(default)]
    pub provider: Provider,
    /// Empty means "the provider's own default" — Anthropic's API for
    /// Anthropic, nothing at all for an OpenAI-compatible provider, which has
    /// no default worth guessing.
    #[serde(default)]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
    /// Suggest codes for a selected passage.
    #[serde(default)]
    pub suggest_codes: bool,
    /// Draft a memo from the excerpts under one code.
    #[serde(default)]
    pub summarise_code: bool,
    /// Draft a definition for a code from its excerpts.
    #[serde(default)]
    pub suggest_definition: bool,
    /// The ceiling on one reply. Small on purpose: these are drafts.
    #[serde(default = "default_max_output_tokens")]
    pub max_output_tokens: u32,
}

impl Default for AssistSettings {
    fn default() -> Self {
        AssistSettings {
            provider: Provider::default(),
            base_url: String::new(),
            model: default_model(),
            suggest_codes: false,
            summarise_code: false,
            suggest_definition: false,
            max_output_tokens: default_max_output_tokens(),
        }
    }
}

/// The three assisted features, named so a command can check the right
/// toggle rather than trusting the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Feature {
    SuggestCodes,
    SummariseCode,
    SuggestDefinition,
    /// The settings pane's "Test connection" button. Not a feature toggle:
    /// it is the person asking for one request, on purpose.
    TestConnection,
}

impl Feature {
    pub fn as_str(self) -> &'static str {
        match self {
            Feature::SuggestCodes => "suggestCodes",
            Feature::SummariseCode => "summariseCode",
            Feature::SuggestDefinition => "suggestDefinition",
            Feature::TestConnection => "testConnection",
        }
    }

    /// Is this feature switched on? "Test connection" always is — pressing
    /// the button is the consent.
    pub fn enabled_in(self, s: &AssistSettings) -> bool {
        match self {
            Feature::SuggestCodes => s.suggest_codes,
            Feature::SummariseCode => s.summarise_code,
            Feature::SuggestDefinition => s.suggest_definition,
            Feature::TestConnection => true,
        }
    }
}

// ------------------------------------------------------------------- secrets

/// The service and account the key is filed under in the OS credential store.
pub const KEYRING_SERVICE: &str = "dev.misket.assist";
pub const KEYRING_ACCOUNT: &str = "api-key";
/// An escape hatch for people who manage their own secrets (and for headless
/// test runs, where there is no credential store at all). Read-only: setting
/// a key from the settings pane always writes to the credential store.
pub const KEY_ENV: &str = "MISKET_ASSIST_API_KEY";

/// Where the API key is kept. A trait so the tests can use a store that is
/// not the machine's real keychain.
pub trait SecretStore: Send + Sync {
    fn get(&self) -> Result<Option<String>>;
    fn set(&self, secret: &str) -> Result<()>;
    fn clear(&self) -> Result<()>;
    /// Does a key set here survive a restart? False for the in-memory
    /// fallback, so the settings pane can say so instead of looking broken.
    fn persistent(&self) -> bool;
}

/// The OS credential store, through the `keyring` crate.
#[derive(Debug, Default)]
pub struct KeyringStore;

impl KeyringStore {
    fn entry(&self) -> Result<keyring::Entry> {
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .map_err(|e| AppError::Io(format!("credential store: {e}")))
    }
}

impl SecretStore for KeyringStore {
    fn get(&self) -> Result<Option<String>> {
        match self.entry()?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Io(format!("credential store: {e}"))),
        }
    }

    fn set(&self, secret: &str) -> Result<()> {
        self.entry()?
            .set_password(secret)
            .map_err(|e| AppError::Io(format!("credential store: {e}")))
    }

    fn clear(&self) -> Result<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Io(format!("credential store: {e}"))),
        }
    }

    fn persistent(&self) -> bool {
        true
    }
}

/// An in-memory store, for tests and for a machine with no usable credential
/// store (a headless Linux box with no Secret Service running, say): the key
/// then lives only as long as the app does, which is the safe failure.
#[derive(Debug, Default)]
pub struct MemoryStore(Mutex<Option<String>>);

impl SecretStore for MemoryStore {
    fn get(&self) -> Result<Option<String>> {
        Ok(self.0.lock().map(|g| g.clone()).unwrap_or_default())
    }

    fn set(&self, secret: &str) -> Result<()> {
        if let Ok(mut g) = self.0.lock() {
            *g = Some(secret.to_string());
        }
        Ok(())
    }

    fn clear(&self) -> Result<()> {
        if let Ok(mut g) = self.0.lock() {
            *g = None;
        }
        Ok(())
    }

    fn persistent(&self) -> bool {
        false
    }
}

/// The best store this machine has: the OS credential store when it answers,
/// and memory when it does not (a Linux box with no Secret Service running,
/// for instance). Degrading to memory is the safe failure — the key still
/// never reaches disk, it just has to be typed again next time.
pub fn best_store() -> Box<dyn SecretStore> {
    let keyring = KeyringStore;
    match keyring.get() {
        Ok(_) => Box::new(keyring),
        Err(_) => Box::new(MemoryStore::default()),
    }
}

/// The key to send, if there is one: the environment override first, then the
/// credential store. An empty string counts as "no key" so a cleared field
/// cannot be sent as a credential.
pub fn api_key(store: &dyn SecretStore) -> Result<Option<String>> {
    if let Ok(from_env) = std::env::var(KEY_ENV) {
        let trimmed = from_env.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed));
        }
    }
    Ok(store
        .get()?
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty()))
}

/// The note a command carries when the person accepted a suggestion: which
/// provider and model drafted it. The *actor* is unchanged — the person
/// clicked — so this is the only thing that marks the entry as assisted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistedRef {
    pub provider: String,
    pub model: String,
}

/// Run `f` with this project's connection marked as assisted, and clear the
/// mark afterwards whatever happens.
///
/// The mark is per-connection `TEMP` state, so the window is exactly this
/// call: nothing written before or after it is tagged, and the project file
/// itself never carries the mark, only the history entries that were written
/// inside it.
pub fn with_assist<T>(
    project: &misket_core::db::OpenProject,
    by: Option<&AssistedRef>,
    f: impl FnOnce() -> Result<T>,
) -> Result<T> {
    use misket_core::db::activity;
    let Some(by) = by else { return f() };
    let mark = activity::AssistedBy {
        provider: by.provider.trim().to_string(),
        model: by.model.trim().to_string(),
    };
    activity::set_assisted(&project.conn, Some(&mark))?;
    let out = f();
    let _ = activity::set_assisted(&project.conn, None);
    out
}

// ----------------------------------------------------------------- redaction

/// `text` with the key — and anything else shaped like one — taken out.
///
/// Provider errors quote the request back at you often enough that this has
/// to happen on the way *in* to a log or a toast, not on the way out.
pub fn redact(text: &str, key: Option<&str>) -> String {
    let mut out = text.to_string();
    if let Some(key) = key {
        let key = key.trim();
        if key.len() >= 8 {
            out = out.replace(key, "***");
        }
    }
    // Long `sk-`-style tokens, whether or not they are the configured key.
    let mut result = String::with_capacity(out.len());
    let mut rest = out.as_str();
    while let Some(at) = rest.find("sk-") {
        result.push_str(&rest[..at]);
        let tail = &rest[at..];
        let end = tail
            .char_indices()
            .find(|(i, c)| *i > 0 && !(c.is_ascii_alphanumeric() || *c == '-' || *c == '_'))
            .map(|(i, _)| i)
            .unwrap_or(tail.len());
        if end >= 12 {
            result.push_str("***");
        } else {
            result.push_str(&tail[..end]);
        }
        rest = &tail[end..];
    }
    result.push_str(rest);
    result
}

// ----------------------------------------------------------- request shaping

/// One turn: a system prompt, a user prompt, and a ceiling. Everything the
/// three features need; the prompts themselves are built in
/// `src/core/assist/prompts.ts`, where they can be read in one file.
#[derive(Debug, Clone, PartialEq)]
pub struct ChatRequest {
    pub model: String,
    pub system: String,
    pub user: String,
    pub max_tokens: u32,
    pub stream: bool,
}

/// The Anthropic Messages API body.
pub fn anthropic_body(r: &ChatRequest) -> Value {
    let mut body = json!({
        "model": r.model,
        "max_tokens": r.max_tokens,
        "system": r.system,
        "messages": [{ "role": "user", "content": r.user }],
    });
    if r.stream {
        body["stream"] = Value::Bool(true);
    }
    body
}

/// The OpenAI chat-completions body, which is what a local model speaks too.
pub fn openai_body(r: &ChatRequest) -> Value {
    let mut body = json!({
        "model": r.model,
        "max_tokens": r.max_tokens,
        "messages": [
            { "role": "system", "content": r.system },
            { "role": "user", "content": r.user },
        ],
    });
    if r.stream {
        body["stream"] = Value::Bool(true);
    }
    body
}

/// The URL one request goes to, from the provider and the configured base.
///
/// A base URL that already names the endpoint is left alone, so pasting the
/// full URL out of a provider's own documentation works.
pub fn endpoint(provider: Provider, base_url: &str) -> Result<String> {
    let base = base_url.trim().trim_end_matches('/');
    match provider {
        Provider::Anthropic => {
            let base = if base.is_empty() {
                ANTHROPIC_BASE
            } else {
                base
            };
            Ok(if base.ends_with("/messages") {
                base.to_string()
            } else {
                format!("{base}/v1/messages")
            })
        }
        Provider::OpenAiCompatible => {
            if base.is_empty() {
                return Err(AppError::Validation(
                    "assistance needs a base URL for an OpenAI-compatible provider".into(),
                ));
            }
            Ok(if base.ends_with("/chat/completions") {
                base.to_string()
            } else {
                format!("{base}/chat/completions")
            })
        }
    }
}

/// The headers one request carries, as name/value pairs.
pub fn headers(provider: Provider, key: Option<&str>) -> Vec<(&'static str, String)> {
    let mut out = vec![("content-type", "application/json".to_string())];
    match provider {
        Provider::Anthropic => {
            out.push(("anthropic-version", ANTHROPIC_VERSION.to_string()));
            if let Some(key) = key {
                out.push(("x-api-key", key.to_string()));
            }
        }
        Provider::OpenAiCompatible => {
            if let Some(key) = key {
                out.push(("authorization", format!("Bearer {key}")));
            }
        }
    }
    out
}

// ---------------------------------------------------------- response reading

fn no_text() -> AppError {
    AppError::Validation("the provider returned no text".into())
}

/// The text of an Anthropic response: every `text` block, joined.
pub fn anthropic_text(v: &Value) -> Result<String> {
    if let Some(message) = v.get("error").and_then(|e| e.get("message")) {
        return Err(AppError::Io(format!(
            "provider error: {}",
            message.as_str().unwrap_or("unknown")
        )));
    }
    let blocks = v
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(no_text)?;
    let text: String = blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    if text.trim().is_empty() {
        return Err(no_text());
    }
    Ok(text)
}

/// The text of an OpenAI-compatible response.
///
/// `content` is a string in the original API and an array of parts in some
/// implementations; both are read.
pub fn openai_text(v: &Value) -> Result<String> {
    if let Some(message) = v.get("error").and_then(|e| e.get("message")) {
        return Err(AppError::Io(format!(
            "provider error: {}",
            message.as_str().unwrap_or("unknown")
        )));
    }
    let content = v
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .ok_or_else(no_text)?;
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => return Err(no_text()),
    };
    if text.trim().is_empty() {
        return Err(no_text());
    }
    Ok(text)
}

/// The text of a response, whichever provider it came from.
pub fn response_text(provider: Provider, v: &Value) -> Result<String> {
    match provider {
        Provider::Anthropic => anthropic_text(v),
        Provider::OpenAiCompatible => openai_text(v),
    }
}

/// The piece of text in one `data:` line of a stream, if it carries any.
///
/// Both providers send server-sent events; this reads the payload of one
/// `data:` line and returns whatever text it adds. Anything unrecognised —
/// keep-alives, `[DONE]`, event types this does not care about, malformed
/// JSON — is `None` rather than an error, because a stream that stumbles on
/// one frame should still deliver the rest.
pub fn stream_delta(provider: Provider, data: &str) -> Option<String> {
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    let v: Value = serde_json::from_str(data).ok()?;
    let text = match provider {
        Provider::Anthropic => {
            if v.get("type").and_then(Value::as_str)? != "content_block_delta" {
                return None;
            }
            v.get("delta")?.get("text")?.as_str()?
        }
        Provider::OpenAiCompatible => v
            .get("choices")?
            .as_array()?
            .first()?
            .get("delta")?
            .get("content")?
            .as_str()?,
    };
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

/// Does this `data:` line say the stream is over?
///
/// Both providers mark the end explicitly, and reading the mark is what lets
/// a reply finish promptly even when the provider leaves the connection open
/// afterwards — without it, the only end-of-body signal is the socket
/// closing, and a provider that keeps it alive would leave the request
/// hanging until the read timeout.
pub fn stream_is_done(provider: Provider, data: &str) -> bool {
    let data = data.trim();
    match provider {
        Provider::OpenAiCompatible => data == "[DONE]",
        Provider::Anthropic => serde_json::from_str::<Value>(data)
            .ok()
            .and_then(|v| {
                v.get("type")
                    .and_then(Value::as_str)
                    .map(|t| t == "message_stop")
            })
            .unwrap_or(false),
    }
}

/// An error from a non-2xx response, with the key scrubbed and the body cut
/// down to something a toast can hold.
pub fn http_error(status: u16, body: &str, key: Option<&str>) -> AppError {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message"))
                .or_else(|| v.get("message"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.trim().to_string());
    let detail = redact(&detail, key);
    let detail: String = detail.chars().take(300).collect();
    match status {
        401 | 403 => AppError::Validation(format!("the provider rejected the API key ({status})")),
        429 => {
            AppError::Conflict("the provider is rate-limiting this key; try again shortly".into())
        }
        _ if detail.is_empty() => AppError::Io(format!("the provider returned HTTP {status}")),
        _ => AppError::Io(format!("provider error {status}: {detail}")),
    }
}

// ----------------------------------------------------------- the request log

/// One line of "what was sent": when, to whom, how big. Never the content —
/// the point of the list is that it can be shown to a colleague or an ethics
/// board without showing them the data.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssistLogEntry {
    /// RFC 3339 UTC.
    pub at: String,
    pub feature: String,
    pub provider: String,
    pub model: String,
    /// How many bytes of prompt went out.
    pub request_bytes: usize,
    /// How many bytes of text came back. 0 when the request failed.
    pub response_bytes: usize,
    /// `ok`, `cancelled`, or a short reason.
    pub outcome: String,
}

/// How many lines the list keeps. It is a session log, not an archive.
pub const LOG_CAPACITY: usize = 200;

/// The shortest gap between two requests: enough to swallow a double-click or
/// a component that fires twice, short enough that pressing one button and
/// then deliberately pressing another is never refused.
pub const MIN_REQUEST_GAP: Duration = Duration::from_millis(400);

/// Everything assistance needs that outlives one command.
pub struct AssistState {
    pub store: Box<dyn SecretStore>,
    log: Mutex<VecDeque<AssistLogEntry>>,
    last_request: Mutex<Option<Instant>>,
    in_flight: std::sync::atomic::AtomicBool,
    cancelled: Mutex<Vec<String>>,
    client: std::sync::OnceLock<reqwest::Client>,
}

impl Default for AssistState {
    fn default() -> Self {
        AssistState {
            store: best_store(),
            log: Mutex::new(VecDeque::new()),
            last_request: Mutex::new(None),
            in_flight: std::sync::atomic::AtomicBool::new(false),
            cancelled: Mutex::new(Vec::new()),
            client: std::sync::OnceLock::new(),
        }
    }
}

impl AssistState {
    /// A state whose key lives only in memory, for tests.
    #[cfg(test)]
    pub fn in_memory() -> Self {
        AssistState {
            store: Box::new(MemoryStore::default()),
            ..Default::default()
        }
    }

    /// The shared HTTP client. No overall timeout, because a streamed reply
    /// legitimately takes a while; a stalled connection is caught by the read
    /// timeout instead. Proxy settings come from the environment, as they do
    /// for every other tool on the machine.
    pub fn client(&self) -> Result<&reqwest::Client> {
        if let Some(client) = self.client.get() {
            return Ok(client);
        }
        let built = reqwest::Client::builder()
            .user_agent(concat!("Misket/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(90))
            .build()
            .map_err(|e| AppError::Io(format!("http client: {e}")))?;
        let _ = self.client.set(built);
        self.client
            .get()
            .ok_or_else(|| AppError::Io("http client".into()))
    }

    /// Claim the right to make one request, or say why not.
    ///
    /// Two guards, and they are different things. One request may be in the
    /// air at a time, because these features are one-person-one-click and a
    /// second concurrent call is a bug or an impatient double-press. And two
    /// requests may not start within [`MIN_REQUEST_GAP`] of each other, which
    /// catches the double-press the first guard misses (the first having
    /// already finished). Neither is a quota: the provider's own rate limit
    /// is the provider's business, and its 429 is surfaced as one.
    ///
    /// The returned guard releases the claim when it is dropped, so a request
    /// that fails, is cancelled, or panics does not wedge the feature.
    pub fn begin_request(&self) -> Result<InFlight<'_>> {
        use std::sync::atomic::Ordering;
        if self.in_flight.swap(true, Ordering::SeqCst) {
            return Err(AppError::Conflict(
                "one request at a time — wait for the last one to finish".into(),
            ));
        }
        let guard = InFlight(&self.in_flight);
        let mut last = self
            .last_request
            .lock()
            .map_err(|_| AppError::Db("assist lock poisoned".into()))?;
        if let Some(at) = *last {
            if at.elapsed() < MIN_REQUEST_GAP {
                return Err(AppError::Conflict(
                    "that was a moment too quick after the last request".into(),
                ));
            }
        }
        *last = Some(Instant::now());
        drop(last);
        Ok(guard)
    }

    pub fn log(&self, entry: AssistLogEntry) {
        if let Ok(mut log) = self.log.lock() {
            log.push_front(entry);
            while log.len() > LOG_CAPACITY {
                log.pop_back();
            }
        }
    }

    /// The log, newest first.
    pub fn entries(&self) -> Vec<AssistLogEntry> {
        self.log
            .lock()
            .map(|l| l.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn clear_log(&self) {
        if let Ok(mut log) = self.log.lock() {
            log.clear();
        }
    }

    /// Ask a running request to stop.
    pub fn cancel(&self, request_id: &str) {
        if let Ok(mut c) = self.cancelled.lock() {
            if !c.iter().any(|id| id == request_id) {
                c.push(request_id.to_string());
            }
            // The list only ever holds requests nobody has collected yet.
            while c.len() > 32 {
                c.remove(0);
            }
        }
    }

    /// Has this request been cancelled? Leaves the flag in place; the request
    /// clears it with [`AssistState::finish`] when it stops.
    pub fn is_cancelled(&self, request_id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|c| c.iter().any(|id| id == request_id))
            .unwrap_or(false)
    }

    pub fn finish(&self, request_id: &str) {
        if let Ok(mut c) = self.cancelled.lock() {
            c.retain(|id| id != request_id);
        }
    }
}

/// The claim [`AssistState::begin_request`] hands out. Dropping it releases
/// the "one at a time" flag, whatever became of the request.
pub struct InFlight<'a>(&'a std::sync::atomic::AtomicBool);

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Now, as the log writes it.
pub fn now() -> String {
    misket_core::db::util::now()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req() -> ChatRequest {
        ChatRequest {
            model: "claude-sonnet-5".into(),
            system: "You help a qualitative researcher.".into(),
            user: "Passage: I waited four hours.".into(),
            max_tokens: 1200,
            stream: false,
        }
    }

    // -- request bodies: golden JSON, so a change to the wire shape is a
    // -- change somebody has to make on purpose.

    #[test]
    fn anthropic_body_is_the_messages_api_shape() {
        assert_eq!(
            anthropic_body(&req()),
            json!({
                "model": "claude-sonnet-5",
                "max_tokens": 1200,
                "system": "You help a qualitative researcher.",
                "messages": [{ "role": "user", "content": "Passage: I waited four hours." }]
            })
        );
    }

    #[test]
    fn anthropic_body_asks_to_stream_only_when_told_to() {
        let streamed = anthropic_body(&ChatRequest {
            stream: true,
            ..req()
        });
        assert_eq!(streamed["stream"], json!(true));
        assert!(anthropic_body(&req()).get("stream").is_none());
    }

    #[test]
    fn openai_body_puts_the_system_prompt_in_the_messages() {
        assert_eq!(
            openai_body(&req()),
            json!({
                "model": "claude-sonnet-5",
                "max_tokens": 1200,
                "messages": [
                    { "role": "system", "content": "You help a qualitative researcher." },
                    { "role": "user", "content": "Passage: I waited four hours." }
                ]
            })
        );
    }

    #[test]
    fn openai_body_asks_to_stream_only_when_told_to() {
        let streamed = openai_body(&ChatRequest {
            stream: true,
            ..req()
        });
        assert_eq!(streamed["stream"], json!(true));
        assert!(openai_body(&req()).get("stream").is_none());
    }

    // -- endpoints and headers

    #[test]
    fn anthropic_defaults_to_its_own_api() {
        assert_eq!(
            endpoint(Provider::Anthropic, "").unwrap(),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            endpoint(Provider::Anthropic, "http://localhost:8080/").unwrap(),
            "http://localhost:8080/v1/messages"
        );
        // A full URL pasted out of the docs is left alone.
        assert_eq!(
            endpoint(Provider::Anthropic, "http://localhost:8080/v1/messages").unwrap(),
            "http://localhost:8080/v1/messages"
        );
    }

    #[test]
    fn an_openai_compatible_provider_must_say_where_it_is() {
        assert!(endpoint(Provider::OpenAiCompatible, "  ").is_err());
        assert_eq!(
            endpoint(Provider::OpenAiCompatible, OLLAMA_BASE).unwrap(),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            endpoint(Provider::OpenAiCompatible, "http://x/v1/chat/completions").unwrap(),
            "http://x/v1/chat/completions"
        );
    }

    #[test]
    fn headers_carry_the_key_the_way_each_provider_wants_it() {
        assert_eq!(
            headers(Provider::Anthropic, Some("sk-ant-secret-value")),
            vec![
                ("content-type", "application/json".to_string()),
                ("anthropic-version", ANTHROPIC_VERSION.to_string()),
                ("x-api-key", "sk-ant-secret-value".to_string()),
            ]
        );
        assert_eq!(
            headers(Provider::OpenAiCompatible, Some("abc")),
            vec![
                ("content-type", "application/json".to_string()),
                ("authorization", "Bearer abc".to_string()),
            ]
        );
        // A local model needs no key, and none is invented.
        assert_eq!(headers(Provider::OpenAiCompatible, None).len(), 1);
    }

    // -- response parsing, including what a model should not be able to do

    #[test]
    fn anthropic_text_joins_the_text_blocks() {
        let v = json!({"content": [
            {"type": "text", "text": "Hello "},
            {"type": "thinking", "thinking": "ignored"},
            {"type": "text", "text": "world"}
        ]});
        assert_eq!(anthropic_text(&v).unwrap(), "Hello world");
    }

    #[test]
    fn openai_text_reads_a_string_or_an_array_of_parts() {
        let s = json!({"choices": [{"message": {"content": "Hello"}}]});
        assert_eq!(openai_text(&s).unwrap(), "Hello");
        let parts = json!({"choices": [{"message": {"content": [
            {"type": "text", "text": "Hel"}, {"type": "text", "text": "lo"}
        ]}}]});
        assert_eq!(openai_text(&parts).unwrap(), "Hello");
    }

    #[test]
    fn malformed_responses_are_errors_not_panics() {
        for v in [
            json!({}),
            json!({"content": "not an array"}),
            json!({"content": []}),
            json!({"content": [{"type": "text", "text": "   "}]}),
            json!([1, 2, 3]),
            json!(null),
        ] {
            assert!(anthropic_text(&v).is_err(), "{v}");
        }
        for v in [
            json!({}),
            json!({"choices": []}),
            json!({"choices": [{}]}),
            json!({"choices": [{"message": {"content": 42}}]}),
            json!({"choices": [{"message": {"content": ""}}]}),
        ] {
            assert!(openai_text(&v).is_err(), "{v}");
        }
    }

    #[test]
    fn an_error_envelope_reads_as_an_error() {
        let v = json!({"error": {"type": "invalid_request_error", "message": "bad model"}});
        assert!(anthropic_text(&v)
            .unwrap_err()
            .to_string()
            .contains("bad model"));
        assert!(openai_text(&v)
            .unwrap_err()
            .to_string()
            .contains("bad model"));
    }

    #[test]
    fn the_end_of_a_stream_is_read_from_the_stream_itself() {
        assert!(stream_is_done(
            Provider::Anthropic,
            r#"{"type":"message_stop"}"#
        ));
        assert!(stream_is_done(Provider::OpenAiCompatible, "[DONE]"));
        // Each provider's marker means nothing to the other, and an ordinary
        // frame is not the end.
        assert!(!stream_is_done(Provider::Anthropic, "[DONE]"));
        assert!(!stream_is_done(
            Provider::OpenAiCompatible,
            r#"{"type":"message_stop"}"#
        ));
        assert!(!stream_is_done(
            Provider::Anthropic,
            r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}"#
        ));
        assert!(!stream_is_done(Provider::Anthropic, "not json"));
    }

    #[test]
    fn stream_deltas_are_read_and_noise_is_ignored() {
        assert_eq!(
            stream_delta(
                Provider::Anthropic,
                r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}"#
            ),
            Some("Hi".into())
        );
        assert_eq!(
            stream_delta(
                Provider::OpenAiCompatible,
                r#"{"choices":[{"delta":{"content":"Hi"}}]}"#
            ),
            Some("Hi".into())
        );
        for noise in [
            "",
            "[DONE]",
            "not json",
            r#"{"type":"message_start","message":{}}"#,
            r#"{"type":"content_block_delta","delta":{"type":"text_delta"}}"#,
            r#"{"choices":[]}"#,
            r#"{"choices":[{"delta":{}}]}"#,
            r#"{"choices":[{"delta":{"content":""}}]}"#,
        ] {
            assert_eq!(stream_delta(Provider::Anthropic, noise), None, "{noise}");
            assert_eq!(
                stream_delta(Provider::OpenAiCompatible, noise),
                None,
                "{noise}"
            );
        }
    }

    // -- the key never gets out

    #[test]
    fn redaction_removes_the_configured_key() {
        let key = "sk-ant-api03-averylongsecret";
        let msg = format!("request failed: x-api-key {key} was rejected");
        let out = redact(&msg, Some(key));
        assert!(!out.contains(key), "{out}");
        assert!(out.contains("***"));
    }

    #[test]
    fn redaction_removes_a_key_shaped_token_it_was_not_told_about() {
        let out = redact("using sk-proj-abcdefghijklmnop for this", None);
        assert!(!out.contains("abcdefghijklmnop"), "{out}");
    }

    #[test]
    fn redaction_leaves_ordinary_prose_alone() {
        assert_eq!(
            redact("no secrets here", Some("sk-whatever")),
            "no secrets here"
        );
        // A short "sk-" is a word, not a token.
        assert_eq!(redact("sk-1 is fine", None), "sk-1 is fine");
    }

    #[test]
    fn http_errors_are_short_and_scrubbed() {
        let key = "sk-ant-api03-averylongsecret";
        let body = format!(r#"{{"error":{{"message":"key {key} is invalid"}}}}"#);
        let e = http_error(400, &body, Some(key));
        assert!(!e.to_string().contains(key), "{e}");
        assert!(matches!(
            http_error(401, "{}", None),
            AppError::Validation(_)
        ));
        assert!(matches!(http_error(429, "{}", None), AppError::Conflict(_)));
        // A body that is not JSON still produces something readable.
        assert!(http_error(500, "upstream exploded", None)
            .to_string()
            .contains("upstream exploded"));
    }

    // -- the secret store, mocked

    #[test]
    fn the_secret_store_round_trips_and_clears() {
        let store = MemoryStore::default();
        assert_eq!(store.get().unwrap(), None);
        store.set("sk-test-key").unwrap();
        assert_eq!(store.get().unwrap().as_deref(), Some("sk-test-key"));
        store.clear().unwrap();
        assert_eq!(store.get().unwrap(), None);
    }

    #[test]
    fn a_blank_key_is_no_key() {
        let store = MemoryStore::default();
        store.set("   ").unwrap();
        assert_eq!(api_key(&store).unwrap(), None);
    }

    // -- settings default to off, and stay off through a round trip

    #[test]
    fn every_assisted_feature_is_off_by_default() {
        let s = AssistSettings::default();
        assert!(!s.suggest_codes);
        assert!(!s.summarise_code);
        assert!(!s.suggest_definition);
        assert_eq!(s.base_url, "");
        assert_eq!(s.model, DEFAULT_MODEL);
        for feature in [
            Feature::SuggestCodes,
            Feature::SummariseCode,
            Feature::SuggestDefinition,
        ] {
            assert!(!feature.enabled_in(&s), "{}", feature.as_str());
        }
        // Pressing "Test connection" is its own consent.
        assert!(Feature::TestConnection.enabled_in(&s));
    }

    #[test]
    fn a_settings_file_without_the_section_reads_as_off() {
        let s: AssistSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, AssistSettings::default());
    }

    // -- the log and the rate limit

    #[test]
    fn the_log_is_newest_first_and_bounded() {
        let state = AssistState::in_memory();
        for i in 0..LOG_CAPACITY + 10 {
            state.log(AssistLogEntry {
                at: now(),
                feature: format!("f{i}"),
                provider: "anthropic".into(),
                model: "m".into(),
                request_bytes: i,
                response_bytes: 0,
                outcome: "ok".into(),
            });
        }
        let entries = state.entries();
        assert_eq!(entries.len(), LOG_CAPACITY);
        assert_eq!(entries[0].feature, format!("f{}", LOG_CAPACITY + 9));
        state.clear_log();
        assert!(state.entries().is_empty());
    }

    #[test]
    fn the_log_records_sizes_but_never_content() {
        let entry = AssistLogEntry {
            at: now(),
            feature: "suggestCodes".into(),
            provider: "anthropic".into(),
            model: "claude-sonnet-5".into(),
            request_bytes: 1234,
            response_bytes: 56,
            outcome: "ok".into(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("requestBytes"));
        assert!(!json.contains("passage"));
    }

    #[test]
    fn only_one_request_is_in_the_air_at_a_time() {
        let state = AssistState::in_memory();
        let first = state.begin_request().unwrap();
        assert!(matches!(state.begin_request(), Err(AppError::Conflict(_))));
        drop(first);
        // The claim is released even though the first request "failed";
        // the second is now only held back by the minimum gap.
        std::thread::sleep(MIN_REQUEST_GAP);
        assert!(state.begin_request().is_ok());
    }

    #[test]
    fn a_second_request_in_the_same_breath_is_refused() {
        let state = AssistState::in_memory();
        drop(state.begin_request().unwrap());
        assert!(matches!(state.begin_request(), Err(AppError::Conflict(_))));
    }

    #[test]
    fn cancelling_is_remembered_until_the_request_finishes() {
        let state = AssistState::in_memory();
        assert!(!state.is_cancelled("r1"));
        state.cancel("r1");
        assert!(state.is_cancelled("r1"));
        assert!(!state.is_cancelled("r2"));
        state.finish("r1");
        assert!(!state.is_cancelled("r1"));
    }
}
