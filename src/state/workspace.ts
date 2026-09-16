import { create } from "zustand";

export type View =
  | { kind: "document"; documentId: string; focusExcerptId?: string; scrollToOffset?: number }
  | { kind: "excerpts" }
  | { kind: "search" }
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
  setView: (view: View) => void;
  openDocument: (documentId: string, focusExcerptId?: string, scrollToOffset?: number) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setSelectedCodeId: (id: string | null) => void;
  setPendingSelection: (sel: PendingSelection | null) => void;
  setFocusedExcerptId: (id: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  reset: () => void;
}

const initial = {
  view: { kind: "empty" } as View,
  sidebarTab: "documents" as SidebarTab,
  selectedCodeId: null,
  pendingSelection: null,
  focusedExcerptId: null,
  paletteOpen: false,
};

export const useWorkspace = create<WorkspaceState>((set) => ({
  ...initial,
  setView: (view) => set({ view, pendingSelection: null, focusedExcerptId: null }),
  openDocument: (documentId, focusExcerptId, scrollToOffset) =>
    set({
      view: { kind: "document", documentId, focusExcerptId, scrollToOffset },
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
  reset: () => set({ ...initial }),
}));
