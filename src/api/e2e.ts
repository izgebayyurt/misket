import { invoke } from "./client";

export interface E2eConfig {
  projectPath: string | null;
  projectName: string | null;
  importPaths: string[];
}

export const getE2eConfig = () => invoke<E2eConfig>("get_e2e_config");
