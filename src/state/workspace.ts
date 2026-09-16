import { create } from "zustand";
import type { ExcerptFilter } from "@/api/types";

export type AnalysisTab = "frequencies" | "cooccurrence" | "matrix";

export type View =
  | { kind: "document"; documentId: string; focusExcerptId?: string; scrollToOffset?: number }
  /** `initialFilter` seeds the browser's filters when it mounts. */
  | { kind: "excerpts"; initialFilter?: ExcerptFilter }
  | { kind: "analysis"; tab: AnalysisTab }
  | { kind: "search" }
  | { kind: "descriptorTable" }
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
  openDocument: (documentId: string, focusExcerptId?: string, scrollToOffset?: number) => void;
  /** Open the excerpt browser, optionally pre-filtered (analysis click-through). */
  openExcerpts: (initialFilter?: ExcerptFilter) => void;
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
  openDocument: (documentId, focusExcerptId, scrollToOffset) =>
    set({
      view: { kind: "document", documentId, focusExcerptId, scrollToOffset },
      pendingSelection: null,
      focusedExcerptId: focusExcerptId ?? null,
    }),
  openExcerpts: (initialFilter) =>
    set({
      view: { kind: "excerpts", initialFilter },
      pendingSelection: null,
      focusedExcerptId: null,
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
