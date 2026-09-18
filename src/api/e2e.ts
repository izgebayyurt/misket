import { invoke } from "./client";

export interface E2eConfig {
  projectPath: string | null;
  projectName: string | null;
  importPaths: string[];
  /** A copy to pull from, so the smoke test skips the native file chooser. */
  pullPath: string | null;
  /** A `.qdpx` to import, for the same reason. */
  refiPath: string | null;
  /** A `latest.json` URL to check against instead of the real updater
   * endpoint, so the update banner can be exercised without a signed
   * release. See `src/state/updates.ts` and `e2e/README.md`. */
  updateJsonUrl: string | null;
}

export const getE2eConfig = () => invoke<E2eConfig>("get_e2e_config");

/** Metadata shape matching `@tauri-apps/plugin-updater`'s `UpdateMetadata`,
 * from the Rust `e2e_check_update` command (test-only; see `E2eConfig`). */
export interface E2eUpdateMetadata {
  rid: number;
  currentVersion: string;
  version: string;
  date?: string | null;
  body?: string | null;
  rawJson: Record<string, unknown>;
}

export const e2eCheckUpdate = () => invoke<E2eUpdateMetadata | null>("e2e_check_update");
