import { describe, expect, it } from "vitest";
import { clipToSpokenText, labelCut, type TurnRange } from "./turns";

/**
 * "Alice: Hi there.\nBob: Hello.\nAlice: Bye.\n" — all ASCII, so the offsets
 * below are also the string indices.
 */
const TEXT = "Alice: Hi there.\nBob: Hello.\nAlice: Bye.\n";

const turns: TurnRange[] = [
  { labelStart: 0, labelEnd: 7, start: 7, end: 16 }, // Alice: Hi there.
  { labelStart: 17, labelEnd: 22, start: 22, end: 28 }, // Bob: Hello.
  { labelStart: 29, labelEnd: 36, start: 36, end: 39 }, // Alice: Bye.
];

const spoken = (r: { start: number; end: number } | null) =>
  r ? TEXT.slice(r.start, r.end) : null;

describe("clipToSpokenText", () => {
  it("leaves a selection that is already inside one turn alone", () => {
    expect(clipToSpokenText({ start: 7, end: 16 }, turns)).toEqual({ start: 7, end: 16 });
    expect(clipToSpokenText({ start: 10, end: 12 }, turns)).toEqual({ start: 10, end: 12 });
  });

  it("moves a start inside a label forward to what that speaker said", () => {
    expect(spoken(clipToSpokenText({ start: 0, end: 16 }, turns))).toBe("Hi there.");
    // Dropped on the delimiter, one character before the text.
    expect(spoken(clipToSpokenText({ start: 6, end: 16 }, turns))).toBe("Hi there.");
  });

  it("pulls an end inside a label back to the previous turn's last word", () => {
    // Dragged from Alice's text into Bob's label.
    expect(spoken(clipToSpokenText({ start: 7, end: 20 }, turns))).toBe("Hi there.");
    // The first turn has no previous one, so it stops at the label itself.
    expect(clipToSpokenText({ start: 0, end: 3 }, turns)).toBe(null);
  });

  it("keeps labels that sit in the middle of a multi-turn selection", () => {
    // An excerpt really can run across turns; only the edges are trimmed.
    expect(spoken(clipToSpokenText({ start: 7, end: 28 }, turns))).toBe("Hi there.\nBob: Hello.");
  });

  it("trims both ends at once", () => {
    // Select-all: from the very first label to inside the last one.
    expect(spoken(clipToSpokenText({ start: 0, end: 33 }, turns))).toBe("Hi there.\nBob: Hello.");
  });

  it("returns null when nothing spoken is left", () => {
    expect(clipToSpokenText({ start: 0, end: 7 }, turns)).toBe(null);
    expect(clipToSpokenText({ start: 17, end: 22 }, turns)).toBe(null);
    // …and for an empty or inverted range.
    expect(clipToSpokenText({ start: 12, end: 12 }, turns)).toBe(null);
  });

  it("passes a selection straight through when the document has no turns", () => {
    expect(clipToSpokenText({ start: 3, end: 9 }, [])).toEqual({ start: 3, end: 9 });
    expect(clipToSpokenText({ start: 3, end: 3 }, [])).toBe(null);
  });
});

describe("labelCut", () => {
  it("cuts before the timestamp when the name comes first", () => {
    const text = "Alice (00:12): Hi there.\n";
    expect(labelCut(text, { labelStart: 0, labelEnd: 15, speaker: "Alice", time: "00:12" })).toBe(6);
    expect(text.slice(0, 6)).toBe("Alice ");
    expect(text.slice(6, 15)).toBe("(00:12): ");
  });

  it("cuts before the name when the timestamp comes first", () => {
    const text = "[00:12:03] Alice: Hi there.\n";
    expect(labelCut(text, { labelStart: 0, labelEnd: 18, speaker: "Alice", time: "00:12:03" })).toBe(11);
    expect(text.slice(0, 11)).toBe("[00:12:03] ");
    expect(text.slice(11, 18)).toBe("Alice: ");
  });

  it("reads the label range, not the spoken text", () => {
    // The turn's own `start`/`end` cover what was said, where neither the
    // name nor the time appears; passing the whole turn must still work.
    const text = "P1 (00:07): Frustrated, mostly.\n";
    const turn = {
      speaker: "P1",
      time: "00:07",
      labelStart: 0,
      labelEnd: 12,
      start: 12,
      end: 30,
    };
    expect(labelCut(text, turn)).toBe(3);
    expect(text.slice(0, 3)).toBe("P1 ");
    expect(text.slice(3, 12)).toBe("(00:07): ");
  });

  it("has nothing to cut without a timestamp, or when the parts are not in the label", () => {
    expect(labelCut(TEXT, { labelStart: 0, labelEnd: 7, speaker: "Alice", time: null })).toBe(null);
    expect(labelCut(TEXT, { labelStart: 0, labelEnd: 7, speaker: "Alice" })).toBe(null);
    // A custom pattern whose capture is not literally in the label.
    expect(labelCut("<A> Hi.\n", { labelStart: 0, labelEnd: 4, speaker: "Alice", time: "00:12" })).toBe(null);
  });
});
