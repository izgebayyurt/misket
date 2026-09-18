import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { redactPathArgs } from "@/core/log";
import { log } from "./log";
import type { AppErrorCode } from "./types";

/**
 * Commands worth a line in the log on success too, not only on failure —
 * roughly "opening, closing or bringing in a whole project's worth of
 * data", which is what `docs/DATA_MODEL.md` and the roadmap call out for
 * diagnostics (project open/close, backups, REFI-QDA and codebook imports,
 * pulling from another copy). Every other command is still logged when it
 * fails, just not when it succeeds — that would be most of what the app
 * does, for no diagnostic value.
 */
const NOTABLE_COMMANDS = new Set([
  "create_project",
  "create_sample_project",
  "open_project",
  "close_project",
  "restore_backup",
  "save_project_copy",
  "merge_apply",
  "import_refi",
  "import_codebook",
]);

export class AppError extends Error {
  code: AppErrorCode;
  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e && typeof e === "object" && "code" in e) {
    const obj = e as { code: AppErrorCode; message?: unknown };
    const msg =
      typeof obj.message === "string"
        ? obj.message
        : typeof obj.message === "number"
          ? String(obj.message)
          : obj.code;
    return new AppError(obj.code, msg);
  }
  return new AppError("Db", typeof e === "string" ? e : String(e));
}

/**
 * Typed wrapper around Tauri's invoke that normalizes backend errors and
 * logs every failure (command, `AppError` code and message — never the
 * arguments) plus the success of a [`NOTABLE_COMMANDS`] entry (arguments
 * included, but with anything path-shaped hashed first).
 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    const result = await tauriInvoke<T>(cmd, args);
    if (NOTABLE_COMMANDS.has(cmd)) {
      log.info(cmd, args ? redactPathArgs(args) : undefined);
    }
    return result;
  } catch (e) {
    const err = toAppError(e);
    log.error(`${cmd} failed`, { code: err.code, message: err.message });
    throw err;
  }
}

export function isAppError(e: unknown, code?: AppErrorCode): e is AppError {
  return e instanceof AppError && (code === undefined || e.code === code);
}
