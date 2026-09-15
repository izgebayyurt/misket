import { describe, expect, it } from "vitest";
import { emptyUndo, MAX_UNDO, popRedo, popUndo, pushCommand, type Command } from "./undo";

const cmd = (label: string): Command => ({ label, redo: async () => {}, undo: async () => {} });

describe("undo stack", () => {
  it("pushes, undoes, redoes in order", () => {
    let s = pushCommand(pushCommand(emptyUndo(), cmd("a")), cmd("b"));
    const u1 = popUndo(s)!;
    expect(u1.cmd.label).toBe("b");
    s = u1.next;
    const u2 = popUndo(s)!;
    expect(u2.cmd.label).toBe("a");
    s = u2.next;
    expect(popUndo(s)).toBeNull();
    const r1 = popRedo(s)!;
    expect(r1.cmd.label).toBe("a");
    s = r1.next;
    expect(s.past.map((c) => c.label)).toEqual(["a"]);
    expect(s.future.map((c) => c.label)).toEqual(["b"]);
  });

  it("clears the future on a new command", () => {
    let s = pushCommand(emptyUndo(), cmd("a"));
    s = popUndo(s)!.next;
    s = pushCommand(s, cmd("c"));
    expect(s.future).toEqual([]);
    expect(popRedo(s)).toBeNull();
  });

  it("caps the stack", () => {
    let s = emptyUndo();
    for (let i = 0; i < MAX_UNDO + 5; i++) s = pushCommand(s, cmd(String(i)));
    expect(s.past.length).toBe(MAX_UNDO);
    expect(s.past[0]?.label).toBe("5");
  });
});
