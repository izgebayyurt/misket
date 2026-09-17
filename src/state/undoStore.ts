import { create } from "zustand";
import { historyRedo, historyUndo } from "@/api/history";
import { queryClient } from "@/queries/client";
import { TOAST_KEYS, toast } from "./toasts";

/**
 * Undo and redo, over the history tree in the project file.
 *
 * There is no stack here, and no closures: every mutation records its own
 * inverse as it writes, so this store only has to call the command, refresh
 * everything and say what happened. That is what makes undo survive closing
 * the window — and what makes deleting a document, changing a descriptor's
 * type or importing a codebook undoable like any other edit.
 */
interface UndoStore {
  busy: boolean;
  /** The summary of the last step taken back or reapplied. */
  lastLabel: string | null;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/** An undo can move any part of the project, so nothing is still known fresh. */
const refresh = () => queryClient.invalidateQueries();

/**
 * Undo, redo and a history checkout all share one toast: holding the shortcut
 * updates the message in place, and running off the end of the line nudges
 * that same toast instead of stacking "Nothing to redo" a dozen times.
 */
const timeTravel = { key: TOAST_KEYS.timeTravel };

export const useUndoStore = create<UndoStore>((set, get) => ({
  busy: false,
  lastLabel: null,
  undo: async () => {
    if (get().busy) return;
    set({ busy: true });
    try {
      const node = await historyUndo();
      await refresh();
      if (node) {
        set({ lastLabel: node.summary });
        toast.info(`Undid: ${node.summary}`, timeTravel);
      } else {
        toast.info("Nothing left to undo", timeTravel);
      }
    } catch (e) {
      toast.error(e, timeTravel);
    } finally {
      set({ busy: false });
    }
  },
  redo: async () => {
    if (get().busy) return;
    set({ busy: true });
    try {
      const node = await historyRedo();
      await refresh();
      if (node) {
        set({ lastLabel: node.summary });
        toast.info(`Redid: ${node.summary}`, timeTravel);
      } else {
        toast.info("Nothing to redo", timeTravel);
      }
    } catch (e) {
      toast.error(e, timeTravel);
    } finally {
      set({ busy: false });
    }
  },
}));
