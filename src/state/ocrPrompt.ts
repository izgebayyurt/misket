import { create } from "zustand";
import type { PdfQualityStats, ScannedPdfMessage } from "@/core/importers/pdfQuality";

/** One PDF in the batch that looks scanned and needs a decision. `message`
 * is structured data, not a sentence — the dialog turns it into text with
 * `t()` (src/core stays framework-free; see CLAUDE.md). */
export interface OcrFileInfo {
  name: string;
  stats: PdfQualityStats;
  message: ScannedPdfMessage;
}

export interface OcrPromptRequest {
  file: OcrFileInfo;
  /** Whether more than one scanned PDF remains in this batch, so the dialog
   * can offer "Apply to the rest of this import" — remembered only for the
   * current batch, never across imports. */
  moreInBatch: boolean;
}

export type OcrDecision = "ocr" | "as-is" | "skip";

export interface OcrChoice {
  decision: OcrDecision;
  /** Use this decision for every other scanned PDF in the same batch,
   * without asking again. */
  applyToRest: boolean;
}

interface OcrPromptState {
  request: OcrPromptRequest | null;
  resolve: ((choice: OcrChoice) => void) | null;
  /** Show the per-file dialog and resolve once the person decides. */
  prompt: (request: OcrPromptRequest) => Promise<OcrChoice>;
  /** Called by the dialog with the person's choice. */
  respond: (choice: OcrChoice) => void;
}

export const useOcrPromptStore = create<OcrPromptState>((set, get) => ({
  request: null,
  resolve: null,
  prompt: (request) =>
    new Promise<OcrChoice>((resolve) => {
      set({ request, resolve });
    }),
  respond: (choice) => {
    get().resolve?.(choice);
    set({ request: null, resolve: null });
  },
}));
