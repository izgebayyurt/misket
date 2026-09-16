import { create } from "zustand";

export type View =
  | { kind: "document"; documentId: string; focusExcerptId?: string }
  | { kind: "excerpts" }
  | { kind: "empty" };

export type SidebarTab = "documents" | "codes";

/** A text selection in the active document, in code point offsets. */
export interface PendingSelection {
  documentId: string;
  start: number;
  end: number;
}

interface WorkspaceState {
  view: View;
  sidebarTab: SidebarTab;
  selectedCodeId: string | null;
  pendingSelection: PendingSelection | null;
  focusedExcerptId: string | null;
  paletteOpen: boolean;
  settingsOpen: boolean;
  shortcutsHelpOpen: boolean;
  setView: (view: View) => void;
  openDocument: (documentId: string, focusExcerptId?: string) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setSelectedCodeId: (id: string | null) => void;
  setPendingSelection: (sel: PendingSelection | null) => void;
  setFocusedExcerptId: (id: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  reset: () => void;
}

const initial = {
  view: { kind: "empty" } as View,
  sidebarTab: "documents" as SidebarTab,
  selectedCodeId: null,
  pendingSelection: null,
  focusedExcerptId: null,
  paletteOpen: false,
  settingsOpen: false,
  shortcutsHelpOpen: false,
};

export const useWorkspace = create<WorkspaceState>((set) => ({
  ...initial,
  setView: (view) => set({ view, pendingSelection: null, focusedExcerptId: null }),
  openDocument: (documentId, focusExcerptId) =>
    set({
      view: { kind: "document", documentId, focusExcerptId },
      pendingSelection: null,
      focusedExcerptId: focusExcerptId ?? null,
    }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  setSelectedCodeId: (selectedCodeId) => set({ selectedCodeId }),
  setPendingSelection: (pendingSelection) =>
    set(pendingSelection ? { pendingSelection, focusedExcerptId: null } : { pendingSelection }),
  setFocusedExcerptId: (focusedExcerptId) =>
    set(focusedExcerptId ? { focusedExcerptId, pendingSelection: null } : { focusedExcerptId }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setShortcutsHelpOpen: (shortcutsHelpOpen) => set({ shortcutsHelpOpen }),
  reset: () => set({ ...initial }),
}));
