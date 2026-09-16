import { useEffect } from "react";
import { matchAction } from "@/core/keymap";
import { useWorkspace } from "@/state/workspace";
import { useUndoStore } from "@/state/undoStore";
import { useImportFiles } from "@/components/documents/useImportFiles";
import { useShortcutActions } from "@/state/shortcutActions";

/** Binds application-wide keyboard shortcuts while a project is open. */
export function useGlobalShortcuts() {
  const { pickAndImport } = useImportFiles();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const action = matchAction(e);
      if (!action) return;
      const ws = useWorkspace.getState();
      const handlers = useShortcutActions.getState().handlers;
      switch (action) {
        case "import":
          e.preventDefault();
          void pickAndImport();
          return;
        case "excerptBrowser":
          e.preventDefault();
          ws.setView({ kind: "excerpts" });
          return;
        case "findInProject":
          e.preventDefault();
          ws.setView({ kind: "search" });
          return;
        case "tabDocuments":
          e.preventDefault();
          ws.setSidebarTab("documents");
          return;
        case "tabCodes":
          e.preventDefault();
          ws.setSidebarTab("codes");
          return;
        case "palette":
          e.preventDefault();
          ws.setPaletteOpen(true);
          return;
        case "undo":
          e.preventDefault();
          void useUndoStore.getState().undo();
          return;
        case "redo":
          e.preventDefault();
          void useUndoStore.getState().redo();
          return;
        case "escape":
          if (ws.paletteOpen) return; // the palette closes itself
          // An open popover, menu or dialog owns Escape; Radix closes it.
          if (
            document.querySelector(
              "[data-radix-popper-content-wrapper], [role='dialog'], [role='menu']",
            )
          )
            return;
          if (handlers.escape) {
            handlers.escape();
            return;
          }
          ws.setFocusedExcerptId(null);
          ws.setPendingSelection(null);
          window.getSelection()?.removeAllRanges();
          return;
        case "openProject":
        case "newProject":
          return; // handled on the start screen only
        default: {
          const handler = handlers[action];
          if (handler) {
            e.preventDefault();
            handler();
          }
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pickAndImport]);
}
