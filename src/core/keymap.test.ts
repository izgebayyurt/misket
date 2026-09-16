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
});
