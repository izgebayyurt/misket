import { create } from "zustand";
import {
  emptyUndo,
  popRedo,
  popUndo,
  pushCommand,
  type Command,
  type UndoState,
} from "@/core/undo";
import { toast } from "./toasts";

interface UndoStore extends UndoState {
  busy: boolean;
  /** Execute a command and record it. */
  run: (cmd: Command) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clear: () => void;
}

export const useUndoStore = create<UndoStore>((set, get) => ({
  ...emptyUndo(),
  busy: false,
  run: async (cmd) => {
    set({ busy: true });
    try {
      await cmd.redo();
      set((s) => pushCommand(s, cmd));
    } finally {
      set({ busy: false });
    }
  },
  undo: async () => {
    const r = popUndo(get());
    if (!r || get().busy) return;
    set({ busy: true });
    try {
      await r.cmd.undo();
      set(r.next);
      toast.info(`Undid: ${r.cmd.label}`);
    } catch (e) {
      toast.error(e);
      set(emptyUndo());
    } finally {
      set({ busy: false });
    }
  },
  redo: async () => {
    const r = popRedo(get());
    if (!r || get().busy) return;
    set({ busy: true });
    try {
      await r.cmd.redo();
      set(r.next);
      toast.info(`Redid: ${r.cmd.label}`);
    } catch (e) {
      toast.error(e);
      set(emptyUndo());
    } finally {
      set({ busy: false });
    }
  },
  clear: () => set(emptyUndo()),
}));
