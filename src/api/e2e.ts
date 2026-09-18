import { invoke } from "./client";

export interface E2eConfig {
  projectPath: string | null;
  projectName: string | null;
  importPaths: string[];
  /** A copy to pull from, so the smoke test skips the native file chooser. */
  pullPath: string | null;
  /** A `.qdpx` to import, for the same reason. */
  refiPath: string | null;
  /** Throw a frontend error on startup, to exercise the error boundary and
   * the log viewer headlessly (`MISKET_E2E_CRASH_TEST`). */
  triggerFrontendError: boolean;
}

export const getE2eConfig = () => invoke<E2eConfig>("get_e2e_config");
