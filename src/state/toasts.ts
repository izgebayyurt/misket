import { create } from "zustand";
import { log } from "@/api/log";

/**
 * The toast stack.
 *
 * Toasts can be *keyed*. A keyed toast never stacks: raising the same key
 * again reuses the one already on screen and restarts its dismiss timer. When
 * the repeat carries the very same message — holding `Ctrl`/`⌘`+`Shift`+`Z`
 * past the end of the redo line, say — the toast is *nudged* rather than
 * duplicated: `nudge` counts up, and the component flashes and shakes it once
 * per count. That is the whole fix for "redoing creates a bunch of popups
 * saying nothing to redo".
 */

export interface Toast {
  id: number;
  kind: "info" | "error";
  message: string;
  /**
   * The coalescing key, if this toast was raised with one. Only one toast per
   * key is ever on screen.
   */
  key?: string;
  /**
   * How many times this exact message has been raised again while the toast
   * was still visible. 0 on a fresh toast, and back to 0 when the message
   * changes, so the component animates only real repeats.
   */
  nudge: number;
}

export interface ToastOptions {
  /** Reuse the toast already showing under this key instead of stacking. */
  key?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: Toast["kind"], message: string, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

/** How long a toast stays up; every repeat under the same key restarts it. */
export const DISMISS_MS = 4500;

let nextId = 1;

/** Live dismiss timers by toast id, so a reused toast can restart its own. */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function clearTimer(id: number) {
  const handle = timers.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    timers.delete(id);
  }
}

/** (Re)start the dismiss countdown for one toast. */
function armTimer(id: number) {
  clearTimer(id);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, DISMISS_MS),
  );
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message, options) => {
    const key = options?.key;
    const existing = key ? get().toasts.find((t) => t.key === key) : undefined;
    if (existing) {
      // The same words again: nudge. Different words under the same key
      // (going from "Undid: …" to "Nothing left to undo"): replace quietly.
      const same = existing.message === message && existing.kind === kind;
      set((s) => ({
        toasts: s.toasts.map((t) =>
          t.id === existing.id ? { ...t, kind, message, nudge: same ? t.nudge + 1 : 0 } : t,
        ),
      }));
      armTimer(existing.id);
      return;
    }
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, key, nudge: 0 }] }));
    armTimer(id);
  },
  dismiss: (id) => {
    clearTimer(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export const toast = {
  info: (message: string, options?: ToastOptions) =>
    useToasts.getState().push("info", message, options),
  error: (e: unknown, options?: ToastOptions) => {
    const message = e instanceof Error ? e.message : String(e);
    // `client.ts`'s `invoke` already logs every command failure by code and
    // message; this also catches errors raised outside a command (a bad
    // drag-and-drop file, a client-side validation) that only ever surface
    // as a toast.
    log.error(message, e instanceof Error && e.name !== "Error" ? { name: e.name } : undefined);
    useToasts.getState().push("error", message, options);
  },
};

/**
 * Keys for the toasts that fire on a held-down shortcut, where stacking is
 * only ever noise. Named here so every place that raises one uses the same
 * channel.
 */
export const TOAST_KEYS = {
  /** Undo, redo and history checkout: one "where am I now" toast for all three. */
  timeTravel: "time-travel",
  /** "Select some text…", "Draw a region…": nothing to code right now. */
  codeTarget: "code-target",
  /** The quick-code key with no code applied yet. */
  quickCode: "quick-code",
  /** In vivo coding with no usable selection. */
  inVivo: "in-vivo",
  /** Splitting an excerpt with the cursor outside it. */
  splitExcerpt: "split-excerpt",
  /** Anything assistance has to say: one channel, so a provider that is
   * down cannot bury the screen in identical toasts. */
  assist: "assist",
  /** A media key pressed with no stretch marked: [ and ] first. */
  mediaTarget: "media-target",
  /** A time typed into the excerpt inspector that does not read as one. */
  mediaTimecode: "media-timecode",
} as const;
