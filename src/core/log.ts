// Pure logging logic: batching and a couple of tiny redaction helpers. No
// `react`, `@tauri-apps/*` or `@/api` import belongs here (see CLAUDE.md) —
// `src/api/log.ts` wires this to the `frontend_log` command and exports the
// ready-to-use singleton the rest of the app imports as `log`.

export type LogLevel = "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

export interface QueuedLogEntry {
  level: LogLevel;
  message: string;
  context?: LogContext;
  /** `Date.now()` when the entry was raised, for anyone inspecting the queue. */
  at: number;
}

export type LoggerSink = (entries: QueuedLogEntry[]) => void | Promise<void>;

/** At most this many entries go to the sink in one call. */
const MAX_BATCH = 20;
/** How long a burst of log calls waits before flushing, so a hot loop of
 * errors sends at most a couple of batches per second rather than one
 * `invoke` per line. */
const FLUSH_MS = 400;

export interface Logger {
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  /** Send whatever is queued right now, bypassing the debounce. Useful right
   * before the app might go away (a caught render error, an unload). */
  flush: () => void;
}

/**
 * A small batching logger: every `info`/`warn`/`error` call queues an entry
 * and schedules a flush; a burst of calls inside one debounce window goes
 * out together, capped at `MAX_BATCH` entries per call to `sink`.
 */
export function createLogger(sink: LoggerSink): Logger {
  const queue: QueuedLogEntry[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    if (timer !== undefined) return;
    timer = setTimeout(flush, FLUSH_MS);
  }

  function flush() {
    timer = undefined;
    if (queue.length === 0) return;
    const batch = queue.splice(0, MAX_BATCH);
    void sink(batch);
    if (queue.length > 0) schedule();
  }

  function push(level: LogLevel, message: string, context?: LogContext) {
    queue.push({ level, message, context, at: Date.now() });
    schedule();
  }

  return {
    info: (message, context) => push("info", message, context),
    warn: (message, context) => push("warn", message, context),
    error: (message, context) => push("error", message, context),
    flush,
  };
}

/**
 * True for a value that looks like a filesystem path: has a separator and is
 * longer than a bare slash. Deliberately generous (matches `misket-media://`
 * URLs, forward and back slashes alike) — false positives just mean an
 * ordinary-looking string gets hashed too, which costs nothing.
 */
export function looksLikePath(value: string): boolean {
  return (value.includes("/") || value.includes("\\")) && value.length > 2;
}

/**
 * A tiny, fast, non-cryptographic hash (FNV-1a): not for security, only so a
 * log line can tell two different paths apart without ever holding either
 * one. Good enough here because the real, cryptographic redaction happens
 * again on the Rust side before anything is written to a crash report (see
 * `reporting::redact_log_line`); this only keeps raw paths out of the log
 * file in the first place.
 */
export function hashToken(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Hash a value if it looks like a path, otherwise return it unchanged. */
export function redactPathArg(value: unknown): unknown {
  return typeof value === "string" && looksLikePath(value) ? `path:${hashToken(value)}` : value;
}

/** Apply {@link redactPathArg} to every value of a plain object. */
export function redactPathArgs<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) out[key] = redactPathArg(value);
  return out;
}
