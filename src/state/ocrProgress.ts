import { create } from "zustand";

export interface OcrRun {
  name: string;
  page: number;
  pages: number;
  cancel: () => void;
}

interface OcrProgressState {
  run: OcrRun | null;
  start: (name: string, cancel: () => void) => void;
  update: (page: number, pages: number) => void;
  finish: () => void;
}

/**
 * One page-by-page OCR run at a time (imports happen one PDF after another,
 * see `useImportFiles`), shown as a modal progress dialog with a cancel
 * button.
 */
export const useOcrProgressStore = create<OcrProgressState>((set) => ({
  run: null,
  start: (name, cancel) => set({ run: { name, page: 0, pages: 0, cancel } }),
  update: (page, pages) => set((s) => (s.run ? { run: { ...s.run, page, pages } } : s)),
  finish: () => set({ run: null }),
}));
