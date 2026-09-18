import { invoke } from "./client";

export interface UpdaterStatus {
  /** False while `tauri.conf.json`'s updater pubkey is still the placeholder
   * a fresh clone ships with; see docs/RELEASING.md. */
  configured: boolean;
}

export const getUpdaterStatus = () => invoke<UpdaterStatus>("get_updater_status");
