import { create } from "zustand";
import { historyRedo, historyUndo } from "@/api/history";
import { queryClient } from "@/queries/client";
import { toast } from "./toasts";

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
        toast.info(`Undid: ${node.summary}`);
      } else {
        toast.info("Nothing left to undo");
      }
    } catch (e) {
      toast.error(e);
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
        toast.info(`Redid: ${node.summary}`);
      } else {
        toast.info("Nothing to redo");
      }
    } catch (e) {
      toast.error(e);
    } finally {
      set({ busy: false });
    }
  },
}));
