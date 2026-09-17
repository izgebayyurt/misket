import { invoke } from "./client";

export interface E2eConfig {
  projectPath: string | null;
  projectName: string | null;
  importPaths: string[];
  /** A copy to pull from, so the smoke test skips the native file chooser. */
  pullPath: string | null;
  /** A `.qdpx` to import, for the same reason. */
  refiPath: string | null;
}

export const getE2eConfig = () => invoke<E2eConfig>("get_e2e_config");
