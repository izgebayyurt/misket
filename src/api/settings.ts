import { invoke } from "./client";
import type { AppSettings } from "./types";

export const getSettings = () => invoke<AppSettings>("get_settings");
export const setSettings = (settings: AppSettings) => invoke<void>("set_settings", { settings });
