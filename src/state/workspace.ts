import { create } from "zustand";
import type { ExcerptFilter, Rect } from "@/api/types";

export type AnalysisTab =
  "frequencies" | "cooccurrence" | "matrix" | "descriptor" | "framework" | "words";

export type View =
  | { kind: "document"; documentId: string; focusExcerptId?: string; scrollToOffset?: number }
  /**
   * `initialFilter` seeds the browser's filters when it mounts. `review` puts
   * it in push-down mode for one parent code: the review bar at the top
   * re-files the parent's own excerpts under its children.
   */
  | { kind: "excerpts"; initialFilter?: ExcerptFilter; review?: { parentCodeId: string } }
  | { kind: "analysis"; tab: AnalysisTab }
  /** Two coders side by side: Cohen's kappa, percent agreement and every
   * disagreement between them. */
  | { kind: "reliability" }
  /** `query` seeds the search box when it mounts (e.g. clicking a term in
   * the word-frequency view). */
  | { kind: "search"; query?: string }
  | { kind: "descriptorTable" }
  /** The project's home screen; the default view when a project opens. */
  | { kind: "overview" }
  /** The branch graph over the undo tree: jump to, fork or name any point. */
  | { kind: "history" }
  /** Nothing to show (e.g. the open document was just deleted). */
  | { kind: "empty" };

export type SidebarTab = "documents" | "codes";

/**
 * What the code palette should do with the code the user picks. Without one
 * it codes the pending selection or the focused excerpt, as usual; with one it
 * is a plain code picker (bulk "Add code…"), which keeps `>name` and the
 * filtering behaviour without a second implementation of the palette.
 */
export interface PaletteTarget {
  /** Shown in the palette instead of "Code selection". */
  label: string;
  onPick: (codeId: string) => void | Promise<void>;
}

/**
 * What the palette and the code hotkeys will code next: a text selection in
 * code point offsets, or a rectangle drawn on an image (fractions, 0..1).
 */
export type PendingSelection =
  | { documentId: string; kind: "text"; start: number; end: number }
  | { documentId: string; kind: "image"; geometry: Rect };

interface WorkspaceState {
  view: View;
  sidebarTab: SidebarTab;
  selectedCodeId: string | null;
  pendingSelection: PendingSelection | null;
  focusedExcerptId: string | null;
  paletteOpen: boolean;
  paletteTarget: PaletteTarget | null;
  /**
   * The code most recently applied to something, by any path: the palette,
   * a code hotkey, in vivo coding, a bulk "Add code…". It is what the
   * quick-code shortcut applies, and what the status bar advertises, so the
   * user can see what the key will do before pressing it.
   */
  lastAppliedCodeId: string | null;
  settingsOpen: boolean;
  shortcutsHelpOpen: boolean;
  setView: (view: View) => void;
  openDocument: (documentId: string, focusExcerptId?: string, scrollToOffset?: number) => void;
  /** Open the excerpt browser, optionally pre-filtered (analysis click-through)
   * and optionally in push-down review mode for one parent code. */
  openExcerpts: (initialFilter?: ExcerptFilter, review?: { parentCodeId: string }) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setSelectedCodeId: (id: string | null) => void;
  setPendingSelection: (sel: PendingSelection | null) => void;
  setFocusedExcerptId: (id: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  /** Open the palette as a code picker rather than as a coding action. */
  openCodePicker: (target: PaletteTarget) => void;
  setLastAppliedCodeId: (id: string | null) => void;
  setSettingsOpen: (open: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  reset: () => void;
}

const initial = {
  view: { kind: "overview" } as View,
  sidebarTab: "documents" as SidebarTab,
  selectedCodeId: null,
  pendingSelection: null,
  focusedExcerptId: null,
  paletteOpen: false,
  paletteTarget: null as PaletteTarget | null,
  lastAppliedCodeId: null as string | null,
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
  openExcerpts: (initialFilter, review) =>
    set({
      view: { kind: "excerpts", initialFilter, review },
      pendingSelection: null,
      focusedExcerptId: null,
    }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  // Selecting a code and focusing an excerpt are mutually exclusive targets
  // for the right panel (like `setFocusedExcerptId` below): picking a code
  // in the tree should show its own definition, memos and history rather
  // than leaving the panel on whatever excerpt was last focused.
  setSelectedCodeId: (selectedCodeId) =>
    set(
      selectedCodeId
        ? { selectedCodeId, focusedExcerptId: null, pendingSelection: null }
        : { selectedCodeId },
    ),
  setPendingSelection: (pendingSelection) =>
    set(pendingSelection ? { pendingSelection, focusedExcerptId: null } : { pendingSelection }),
  setFocusedExcerptId: (focusedExcerptId) =>
    set(focusedExcerptId ? { focusedExcerptId, pendingSelection: null } : { focusedExcerptId }),
  setPaletteOpen: (paletteOpen) =>
    set(paletteOpen ? { paletteOpen } : { paletteOpen, paletteTarget: null }),
  openCodePicker: (paletteTarget) => set({ paletteTarget, paletteOpen: true }),
  setLastAppliedCodeId: (lastAppliedCodeId) => set({ lastAppliedCodeId }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setShortcutsHelpOpen: (shortcutsHelpOpen) => set({ shortcutsHelpOpen }),
  reset: () => set({ ...initial }),
}));
