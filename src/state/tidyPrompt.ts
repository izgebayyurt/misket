import { create } from "zustand";
import {
  DEFAULT_TIDY_OPTIONS,
  type TidyOptions,
  type WhitespaceReport,
} from "@/core/importers/tidy";

/** One file in the batch that would change if tidied. */
export interface TidyFileInfo {
  name: string;
  text: string;
  report: WhitespaceReport;
}

export interface TidyPromptRequest {
  files: TidyFileInfo[];
}

export type TidyChoice = { apply: true; options: TidyOptions } | { apply: false };

interface TidyPromptState {
  request: TidyPromptRequest | null;
  resolve: ((choice: TidyChoice) => void) | null;
  /** Show the dialog and resolve once the person picks an option. */
  prompt: (request: TidyPromptRequest) => Promise<TidyChoice>;
  /** Called by the dialog with the person's choice. */
  respond: (choice: TidyChoice) => void;
}

export const useTidyPromptStore = create<TidyPromptState>((set, get) => ({
  request: null,
  resolve: null,
  prompt: (request) =>
    new Promise<TidyChoice>((resolve) => {
      set({ request, resolve });
    }),
  respond: (choice) => {
    get().resolve?.(choice);
    set({ request: null, resolve: null });
  },
}));

const STORAGE_KEY = "misket:tidyImportChoice";

/** The remembered choice from a previous import, or null if there isn't one. */
export function loadRememberedTidyChoice(): TidyChoice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TidyChoice;
    if (parsed.apply === true || parsed.apply === false) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveRememberedTidyChoice(choice: TidyChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Private browsing / blocked storage: just ask again next time.
  }
}

/** "Ask again on import": forget the remembered choice. */
export function clearRememberedTidyChoice(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export { DEFAULT_TIDY_OPTIONS };
