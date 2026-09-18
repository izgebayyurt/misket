import { invoke } from "./client";

export interface LogViewerData {
  /** The log directory, so a person can find it themselves too. */
  dir: string;
  /** The current log file's path, if anything has been logged yet. */
  file: string | null;
  lines: string[];
}

export const readLogs = () => invoke<LogViewerData>("read_logs");
export const clearLogs = () => invoke<void>("clear_logs");

/** Refuses (as an `AppError`) unless "Send anonymous crash reports" is on
 * and an endpoint is set — see the Diagnostics section of Settings. */
export const sendReportNow = () => invoke<void>("send_report_now");

export interface Diagnostics {
  appVersion: string;
  os: string;
  webview: string;
  logDir: string;
  /** The last 50 log lines, redacted the same way a crash report is. */
  logTail: string[];
}

export const getDiagnostics = () => invoke<Diagnostics>("get_diagnostics");
