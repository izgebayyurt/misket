import { create } from "zustand";

/**
 * "Play this excerpt": a stretch of a recording somewhere else in the app
 * asked for.
 *
 * The excerpt browser and the inspector are not where a recording is played —
 * the player lives in the document view, either as the recording's own
 * viewer or as the compact strip a linked transcript shows. So those views
 * post a request here and open the right document; whichever player mounts
 * for `documentId` picks it up, seeks, plays, and stops at `endMs`.
 *
 * `at` makes two identical requests different, so asking for the same stretch
 * twice plays it twice.
 */
export interface PlayRequest {
  /** The document whose player should honour this: a recording, or the
   * transcript whose strip plays it. */
  documentId: string;
  startMs: number;
  /** Where to stop; `null` means "play on". */
  endMs: number | null;
  at: number;
}

interface PlayRequestState {
  request: PlayRequest | null;
  play: (documentId: string, startMs: number, endMs?: number | null) => void;
  /** Called by the player once it has acted on the request. */
  taken: (at: number) => void;
}

export const usePlayRequest = create<PlayRequestState>((set) => ({
  request: null,
  play: (documentId, startMs, endMs = null) =>
    set({ request: { documentId, startMs, endMs, at: Date.now() } }),
  taken: (at) => set((s) => (s.request?.at === at ? { request: null } : s)),
}));
