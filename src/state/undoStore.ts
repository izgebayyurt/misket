import { create } from "zustand";
import { historyRedo, historyUndo } from "@/api/history";
import { queryClient } from "@/queries/client";
import { toast } from "./toasts";

/**
 * Undo and redo, over the history tree in the project file.
 *
 * There is no stack here any more: the project knows which step it is on, so
 * this store only has to call the command, refresh everything and say what
 * happened. That is what makes undo survive closing the window — and what
 * makes deleting or merging a code undoable like any other edit.
 */
interface UndoStore {
  busy: boolean;
  /** The summary of the last step taken back or reapplied. */
  lastLabel: string | null;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  /**
   * Run a command and remember its label. Kept for the mutations whose undo
   * has not moved into the backend yet — descriptors, sets, framework
   * matrices, documents, the project itself, backups and codebook import —
   * which still hand in an inverse this no longer uses. Phase 2 removes it
   * along with those closures.
   */
  run: (cmd: {
    label: string;
    redo: () => Promise<void>;
    undo?: () => Promise<void>;
  }) => Promise<void>;
  /** A no-op, for the same callers. Nothing needs clearing any more. */
  clear: () => void;
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
  run: async (cmd) => {
    set({ busy: true });
    try {
      await cmd.redo();
      set({ lastLabel: cmd.label });
    } finally {
      set({ busy: false });
    }
  },
  clear: () => {},
}));
