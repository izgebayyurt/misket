import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  describe as describeShortcut,
  LABELS,
  matchAction,
  SHORTCUTS,
  type Action,
} from "./keymap";

function ev(init: Partial<KeyboardEvent> & { key: string }, target?: EventTarget): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { ...init, bubbles: true });
  if (target) Object.defineProperty(e, "target", { value: target });
  return e;
}

describe("keymap", () => {
  it("matches modifier combinations (non-mac)", () => {
    expect(matchAction(ev({ key: "k", ctrlKey: true }))).toBe("palette");
    expect(matchAction(ev({ key: "z", ctrlKey: true }))).toBe("undo");
    expect(matchAction(ev({ key: "Z", ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(matchAction(ev({ key: "Tab" }))).toBe("nextExcerpt");
    expect(matchAction(ev({ key: "Tab", shiftKey: true }))).toBe("prevExcerpt");
    expect(matchAction(ev({ key: "k" }))).toBeNull();
    expect(matchAction(ev({ key: "A", ctrlKey: true, shiftKey: true }))).toBe("analysis");
    expect(matchAction(ev({ key: "a", ctrlKey: true }))).toBeNull(); // select all stays free
    expect(matchAction(ev({ key: "ArrowRight", altKey: true, shiftKey: true }))).toBe(
      "extendSelectionRight",
    );
    expect(matchAction(ev({ key: "ArrowRight", shiftKey: true }))).toBeNull();
    expect(matchAction(ev({ key: "f", ctrlKey: true }))).toBe("find");
    expect(matchAction(ev({ key: "f", ctrlKey: true, shiftKey: true }))).toBe("findInProject");
    expect(matchAction(ev({ key: "h", ctrlKey: true, shiftKey: true }))).toBe("overview");
  });

  it("only fires global shortcuts inside text fields", () => {
    const input = document.createElement("input");
    expect(matchAction(ev({ key: "Backspace" }, input))).toBeNull();
    expect(matchAction(ev({ key: "Escape" }, input))).toBe("escape");
    expect(matchAction(ev({ key: "k", ctrlKey: true }, input))).toBe("palette");
    expect(matchAction(ev({ key: "f", ctrlKey: true }, input))).toBe("find");
    expect(matchAction(ev({ key: "f", ctrlKey: true, shiftKey: true }, input))).toBe(
      "findInProject",
    );
    expect(matchAction(ev({ key: "h", ctrlKey: true, shiftKey: true }, input))).toBe("overview");
  });

  it("treats a focused button or menu trigger as passthrough, not a text field", () => {
    // After a dropdown-menu action (delete a set, rename, add to set…) focus
    // can land on the trigger button rather than back on the document. Every
    // shortcut that already works with nothing focused must keep working
    // there too — undo/redo in particular (issue #37), without needing
    // `global: true` and without an extra click to "reset" focus first.
    const button = document.createElement("button");
    expect(matchAction(ev({ key: "z", ctrlKey: true }, button))).toBe("undo");
    expect(matchAction(ev({ key: "Z", ctrlKey: true, shiftKey: true }, button))).toBe("redo");
    expect(matchAction(ev({ key: "k", ctrlKey: true }, button))).toBe("palette");
    expect(matchAction(ev({ key: "f", ctrlKey: true }, button))).toBe("find");
    expect(matchAction(ev({ key: "h", ctrlKey: true, shiftKey: true }, button))).toBe("overview");
    expect(matchAction(ev({ key: "e", ctrlKey: true }, button))).toBe("excerptBrowser");

    // A dropdown-menu trigger is still just a button.
    button.setAttribute("aria-haspopup", "menu");
    expect(matchAction(ev({ key: "z", ctrlKey: true }, button))).toBe("undo");

    // Focus falling back to the document root behaves the same way.
    expect(matchAction(ev({ key: "z", ctrlKey: true }, document.body))).toBe("undo");

    // `matchAction` itself does not know about the focused excerpt: Backspace
    // still resolves to `deleteExcerpt` here (as it would with nothing
    // focused). What stops it from actually deleting anything is that
    // clicking a sidebar button clears `focusedExcerptId` in the workspace
    // store (see DocumentList's blur-on-click); this is a keymap-level check
    // only, not a guarantee that nothing gets deleted.
    expect(matchAction(ev({ key: "Backspace" }, button))).toBe("deleteExcerpt");
  });

  it("matches the settings and shortcuts-help shortcuts, even in a text field", () => {
    const input = document.createElement("input");
    expect(matchAction(ev({ key: ",", ctrlKey: true }))).toBe("settings");
    expect(matchAction(ev({ key: "/", ctrlKey: true }))).toBe("shortcutsHelp");
    expect(matchAction(ev({ key: ",", ctrlKey: true }, input))).toBe("settings");
    expect(matchAction(ev({ key: "/", ctrlKey: true }, input))).toBe("shortcutsHelp");
  });

  it("maps the excerpt boundary shortcuts without clashing (non-mac)", () => {
    expect(matchAction(ev({ key: "ArrowLeft", altKey: true }))).toBe("excerptEndLeft");
    expect(matchAction(ev({ key: "ArrowRight", altKey: true }))).toBe("excerptEndRight");
    expect(matchAction(ev({ key: "ArrowLeft", ctrlKey: true, shiftKey: true }))).toBe(
      "excerptEndLeftChar",
    );
    expect(matchAction(ev({ key: "ArrowRight", ctrlKey: true, shiftKey: true }))).toBe(
      "excerptEndRightChar",
    );
    expect(matchAction(ev({ key: "ArrowLeft", ctrlKey: true, altKey: true }))).toBe(
      "excerptStartLeft",
    );
    expect(matchAction(ev({ key: "ArrowRight", ctrlKey: true, altKey: true }))).toBe(
      "excerptStartRight",
    );
    expect(matchAction(ev({ key: "ArrowLeft", ctrlKey: true, altKey: true, shiftKey: true }))).toBe(
      "excerptStartLeftChar",
    );
    expect(
      matchAction(ev({ key: "ArrowRight", ctrlKey: true, altKey: true, shiftKey: true })),
    ).toBe("excerptStartRightChar");
    // The pre-existing selection shortcut keeps Alt+Shift+Arrow.
    expect(matchAction(ev({ key: "ArrowLeft", altKey: true, shiftKey: true }))).toBe(
      "extendSelectionLeft",
    );
    // Plain arrows stay with the browser.
    expect(matchAction(ev({ key: "ArrowLeft" }))).toBeNull();
    expect(matchAction(ev({ key: "ArrowRight", shiftKey: true }))).toBeNull();
  });

  it("keeps split and merge clear of the memo shortcut", () => {
    expect(matchAction(ev({ key: "s", ctrlKey: true, shiftKey: true }))).toBe("splitExcerpt");
    expect(matchAction(ev({ key: "m", ctrlKey: true, shiftKey: true }))).toBe("mergeExcerpt");
    expect(matchAction(ev({ key: "m", ctrlKey: true }))).toBe("newMemo");
    // Neither fires while typing in a field.
    const input = document.createElement("input");
    expect(matchAction(ev({ key: "s", ctrlKey: true, shiftKey: true }, input))).toBeNull();
    expect(matchAction(ev({ key: "m", ctrlKey: true, shiftKey: true }, input))).toBeNull();
  });

  it("binds the document orientation shortcuts (non-mac)", () => {
    expect(matchAction(ev({ key: "Home", ctrlKey: true }))).toBe("jumpTop");
    expect(matchAction(ev({ key: "End", ctrlKey: true }))).toBe("jumpBottom");
    expect(matchAction(ev({ key: "g", ctrlKey: true }))).toBe("goToParagraph");
    // Plain Home/End keep their normal meaning.
    expect(matchAction(ev({ key: "Home" }))).toBeNull();
    expect(matchAction(ev({ key: "End" }))).toBeNull();
    // And none of them fire while typing in a text field.
    const input = document.createElement("input");
    expect(matchAction(ev({ key: "Home", ctrlKey: true }, input))).toBeNull();
    expect(matchAction(ev({ key: "End", ctrlKey: true }, input))).toBeNull();
    expect(matchAction(ev({ key: "g", ctrlKey: true }, input))).toBeNull();
  });

  it("never binds the same chord to two actions", () => {
    const seen = new Map<string, Action>();
    for (const [action, s] of Object.entries(SHORTCUTS) as [Action, (typeof SHORTCUTS)[Action]][]) {
      const chord = [s.mod ? "mod" : "", s.shift ? "shift" : "", s.alt ? "alt" : "", s.key].join(
        "+",
      );
      expect(seen.get(chord), `${chord} is bound twice`).toBeUndefined();
      seen.set(chord, action);
    }
  });

  it("describes arrow shortcuts with glyphs", () => {
    expect(describeShortcut("excerptEndLeft")).toContain("←");
    expect(describeShortcut("excerptEndRight")).toContain("→");
  });

  it("gives every action a non-empty label", () => {
    for (const action of Object.keys(SHORTCUTS) as Action[]) {
      expect(LABELS[action], `missing label for "${action}"`).toBeTruthy();
    }
  });

  it("keeps the docs site's cheatsheet in sync with every shortcut", () => {
    // site/docs/shortcuts.html hand-transcribes SHORTCUTS for macOS and
    // Windows/Linux columns. Fail loudly if an action's label is missing,
    // so the shipped page can't silently drift from the real keymap.
    const shortcutsHtml = readFileSync(
      path.resolve(__dirname, "../../site/docs/shortcuts.html"),
      "utf-8",
    );
    for (const action of Object.keys(SHORTCUTS) as Action[]) {
      expect(
        shortcutsHtml.includes(LABELS[action]),
        `"${LABELS[action]}" (action "${action}") is missing from site/docs/shortcuts.html`,
      ).toBe(true);
    }
  });
});
