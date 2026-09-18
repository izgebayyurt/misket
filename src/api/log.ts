import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { createLogger, redactPathArgs, type LogContext, type QueuedLogEntry } from "@/core/log";

// Deliberately imports Tauri's own `invoke` rather than `./client`'s
// wrapped one: `client.ts` itself logs through `log` (see its "every
// command failed" hook), and importing back from here would be a cycle.
// Logging is also best-effort by nature — a failed `frontend_log` call
// should never throw into whatever just tried to log something.

function redact(context: LogContext | undefined): LogContext | undefined {
  return context ? redactPathArgs(context) : undefined;
}

async function sink(entries: QueuedLogEntry[]) {
  for (const entry of entries) {
    try {
      await tauriInvoke("frontend_log", {
        level: entry.level,
        message: entry.message,
        context: redact(entry.context),
      });
    } catch {
      // Nowhere useful to report a logging failure to; drop it.
    }
  }
}

/** The app's one frontend logger: `log.info/warn/error(message, context)`.
 * Batched and posted to the Rust `frontend_log` command, which writes it to
 * the same file the backend logs to (see `src-tauri/src/logging.rs`). Any
 * context value that looks like a filesystem path is hashed before it ever
 * leaves this module. */
export const log = createLogger(sink);
