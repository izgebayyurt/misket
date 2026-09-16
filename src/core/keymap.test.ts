import { describe, expect, it } from "vitest";
import { LABELS, matchAction, SHORTCUTS, type Action } from "./keymap";

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
    expect(matchAction(ev({ key: "ArrowRight", altKey: true, shiftKey: true }))).toBe(
      "extendSelectionRight",
    );
    expect(matchAction(ev({ key: "ArrowRight", shiftKey: true }))).toBeNull();
  });

  it("only fires global shortcuts inside text fields", () => {
    const input = document.createElement("input");
    expect(matchAction(ev({ key: "Backspace" }, input))).toBeNull();
    expect(matchAction(ev({ key: "Escape" }, input))).toBe("escape");
    expect(matchAction(ev({ key: "k", ctrlKey: true }, input))).toBe("palette");
  });

  it("matches the settings and shortcuts-help shortcuts, even in a text field", () => {
    const input = document.createElement("input");
    expect(matchAction(ev({ key: ",", ctrlKey: true }))).toBe("settings");
    expect(matchAction(ev({ key: "/", ctrlKey: true }))).toBe("shortcutsHelp");
    expect(matchAction(ev({ key: ",", ctrlKey: true }, input))).toBe("settings");
    expect(matchAction(ev({ key: "/", ctrlKey: true }, input))).toBe("shortcutsHelp");
  });

  it("gives every action a non-empty label", () => {
    for (const action of Object.keys(SHORTCUTS) as Action[]) {
      expect(LABELS[action], `missing label for "${action}"`).toBeTruthy();
    }
  });
});
