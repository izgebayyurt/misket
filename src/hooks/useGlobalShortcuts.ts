import { useEffect } from "react";
import { matchAction } from "@/core/keymap";
import { useWorkspace } from "@/state/workspace";
import { useUndoStore } from "@/state/undoStore";
import { useImportFiles } from "@/components/documents/useImportFiles";
import { useShortcutActions } from "@/state/shortcutActions";

/**
 * Plain Tab/Shift+Tab cycle the focused excerpt while the document, image or
 * media pane's own neutral surface has focus (where it lands right after
 * opening or navigating one — see the `rootRef.current?.focus()` calls in
 * DocumentView) — the same convenience a text editor gives Tab once the
 * cursor is inside it. The moment focus moves to an actual control (a
 * button in the header, the sidebar, a dialog…), `document.activeElement` is
 * that control rather than the pane root, and Tab goes back to moving focus
 * normally: it must, or a keyboard user could never reach anything outside
 * the document view while one is open.
 */
function documentSurfaceHasFocus(): boolean {
  const el = document.activeElement;
  if (!el || el === document.body) return true;
  return el.matches(
    '[data-testid="doc-text"], [data-testid="image-canvas"], [data-testid="media-view"]',
  );
}

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
        case "overview":
          e.preventDefault();
          ws.setView({ kind: "overview" });
          return;
        case "history":
          e.preventDefault();
          ws.setView({ kind: "history" });
          return;
        case "excerptBrowser":
          e.preventDefault();
          ws.openExcerpts();
          return;
        case "analysis":
          e.preventDefault();
          ws.setView({ kind: "analysis", tab: "frequencies" });
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
        case "settings":
          e.preventDefault();
          ws.setSettingsOpen(true);
          return;
        case "shortcutsHelp":
          e.preventDefault();
          ws.setShortcutsHelpOpen(true);
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
        case "nextExcerpt":
        case "prevExcerpt": {
          if (!documentSurfaceHasFocus()) return; // let Tab move focus normally
          const handler = handlers[action];
          if (handler) {
            e.preventDefault();
            handler();
          }
          return;
        }
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
