import { create } from "zustand";
import type { Action } from "@/core/keymap";

/**
 * Views register handlers for context-dependent shortcuts (excerpt navigation,
 * memo creation) while mounted; the global listener dispatches to them.
 */
interface ShortcutActions {
  handlers: Partial<Record<Action, () => void>>;
  register: (handlers: Partial<Record<Action, () => void>>) => () => void;
}

export const useShortcutActions = create<ShortcutActions>((set, get) => ({
  handlers: {},
  register: (handlers) => {
    set({ handlers: { ...get().handlers, ...handlers } });
    return () => {
      const next = { ...get().handlers };
      for (const k of Object.keys(handlers) as Action[]) {
        if (next[k] === handlers[k]) delete next[k];
      }
      set({ handlers: next });
    };
  },
}));
