import { create } from "zustand";
import { cancelTranscription } from "@/api/transcribe";

export interface TranscriptionRun {
  /** The recording being transcribed. */
  documentId: string;
  /** Its name, for the progress dialog's title. */
  name: string;
  percent: number;
  segmentsDone: number;
  /** Seconds still to go, once the backend can guess. */
  eta: number | null;
  /** Set once the person has pressed Stop, so the button can say so. */
  stopping: boolean;
}

interface TranscriptionState {
  run: TranscriptionRun | null;
  start: (documentId: string, name: string) => void;
  update: (documentId: string, percent: number, segmentsDone: number, eta: number | null) => void;
  stop: () => void;
  finish: (documentId: string) => void;
}

/**
 * One transcription at a time, shown as a modal progress dialog.
 *
 * The backend allows one run per recording and would happily run two
 * recordings at once, but a single Whisper pass already wants every core on
 * the machine; queueing is a worse experience than saying "one at a time".
 */
export const useTranscription = create<TranscriptionState>((set, get) => ({
  run: null,
  start: (documentId, name) =>
    set({
      run: { documentId, name, percent: 0, segmentsDone: 0, eta: null, stopping: false },
    }),
  update: (documentId, percent, segmentsDone, eta) =>
    set((s) =>
      s.run && s.run.documentId === documentId
        ? { run: { ...s.run, percent, segmentsDone, eta } }
        : s,
    ),
  stop: () => {
    const run = get().run;
    if (!run) return;
    set({ run: { ...run, stopping: true } });
    void cancelTranscription(run.documentId).catch(() => {
      // The run may have just finished on its own; the done event clears it.
    });
  },
  finish: (documentId) => set((s) => (s.run?.documentId === documentId ? { run: null } : s)),
}));
