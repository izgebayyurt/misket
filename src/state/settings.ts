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
  // Assistance is off, and stays off unless somebody turns it on.
  assist: {
    provider: "anthropic",
    baseUrl: "",
    model: "claude-sonnet-5",
    suggestCodes: false,
    summariseCode: false,
    suggestDefinition: false,
    maxOutputTokens: 1200,
  },
  sendCrashReports: false,
  reportEndpoint: "",
  reportFormat: "json",
  checkForUpdatesAutomatically: true,
  skippedUpdateVersion: null,
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
/** The settings a pending debounced save is holding, if there is one. */
let unsaved: AppSettings | undefined;

function write(s: AppSettings) {
  return setSettings(s)
    .then(() => {
      // The backend also writes the new name and colour onto the open
      // project's `coders` row, so anything showing them refetches.
      queryClient.invalidateQueries({ queryKey: keys.coders });
    })
    .catch(() => {
      // Best-effort: a failed write just means the next change retries.
    });
}

function persist(s: AppSettings) {
  if (saveTimer) clearTimeout(saveTimer);
  unsaved = s;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    unsaved = undefined;
    void write(s);
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Write any pending change now instead of waiting out the debounce.
 *
 * Anything that asks the backend to *act* on settings has to await this
 * first, or it acts on the ones from before the last keystroke — ticking a
 * box and immediately pressing the button next to it is an ordinary thing to
 * do, and it must not read stale settings.
 */
export async function flushSettings(): Promise<void> {
  if (!unsaved) return;
  const pending = unsaved;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  unsaved = undefined;
  await write(pending);
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
