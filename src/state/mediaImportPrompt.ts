import { create } from "zustand";

/** One recording in the batch about to be imported. */
export interface MediaImportFile {
  path: string;
  name: string;
  mime: string;
  durationMs: number;
  sizeBytes: number;
}

export interface MediaImportRequest {
  files: MediaImportFile[];
  /** What the setting says now; the dialog opens on this. */
  copyIntoProject: boolean;
}

export type MediaImportChoice = { import: true; copyIntoProject: boolean } | { import: false };

interface MediaImportPromptState {
  request: MediaImportRequest | null;
  resolve: ((choice: MediaImportChoice) => void) | null;
  /** Show the dialog and resolve once the person decides. */
  prompt: (request: MediaImportRequest) => Promise<MediaImportChoice>;
  /** Called by the dialog with the person's choice. */
  respond: (choice: MediaImportChoice) => void;
}

/**
 * A promise-based prompt, like `tidyPrompt`: audio and video are held by
 * reference, which is a decision worth showing once per batch rather than
 * burying in settings. The dialog offers to copy the files in instead, and
 * remembers the answer as the default for next time.
 */
export const useMediaImportPrompt = create<MediaImportPromptState>((set, get) => ({
  request: null,
  resolve: null,
  prompt: (request) =>
    new Promise<MediaImportChoice>((resolve) => {
      set({ request, resolve });
    }),
  respond: (choice) => {
    get().resolve?.(choice);
    set({ request: null, resolve: null });
  },
}));
