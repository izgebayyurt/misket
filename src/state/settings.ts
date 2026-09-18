import { create } from "zustand";
import { getSettings, setSettings } from "@/api/settings";
import { queryClient } from "@/queries/client";
import { keys } from "@/queries/keys";
import type { AppSettings } from "@/api/types";
import { setTheme } from "./theme";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  editorFontSize: 17,
  editorLineHeight: 1.7,
  confirmDeleteExcerpt: false,
  keepBackups: 20,
  showParagraphNumbers: true,
  showSpeakerGutter: true,
  coderName: null,
  coderId: null,
  coderColor: null,
  lanesByCoder: false,
  copyMediaIntoProject: false,
  ocrLanguages: [],
};

const SAVE_DEBOUNCE_MS = 400;

function applyDocStyle(s: AppSettings) {
  const root = document.documentElement;
  root.style.setProperty("--doc-font-size", `${s.editorFontSize}px`);
  root.style.setProperty("--doc-line-height", `${s.editorLineHeight}`);
}

function applyAll(s: AppSettings) {
  setTheme(s.theme);
  applyDocStyle(s);
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist(s: AppSettings) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void setSettings(s)
      .then(() => {
        // The backend also writes the new name and colour onto the open
        // project's `coders` row, so anything showing them refetches.
        queryClient.invalidateQueries({ queryKey: keys.coders });
      })
      .catch(() => {
        // Best-effort: a failed write just means the next change retries.
      });
  }, SAVE_DEBOUNCE_MS);
}

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  /** Load the persisted settings once at startup, applying defaults if none exist. */
  load: () => Promise<void>;
  /** Patch settings, applying them immediately and persisting (debounced). */
  update: (patch: Partial<AppSettings>) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    let settings = DEFAULT_SETTINGS;
    try {
      settings = await getSettings();
    } catch {
      // No project/config dir yet, or running outside Tauri: keep defaults.
    }
    set({ settings, loaded: true });
    applyAll(settings);
  },
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    applyAll(settings);
    persist(settings);
  },
}));
