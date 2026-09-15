import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { AppErrorCode } from "./types";

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

/** Typed wrapper around Tauri's invoke that normalizes backend errors. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (e) {
    throw toAppError(e);
  }
}

export function isAppError(e: unknown, code?: AppErrorCode): e is AppError {
  return e instanceof AppError && (code === undefined || e.code === code);
}
