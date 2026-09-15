import { describe, expect, it } from "vitest";
import { offsetsToRange, pointToOffset, rangeToOffsets } from "./selection";

/** Build the document-view DOM for `text` with the given span boundaries. */
function build(text: string, splits: number[][]): HTMLElement {
  const root = document.createElement("div");
  const paras = text.split("\n");
  let start = 0;
  paras.forEach((p, i) => {
    const el = document.createElement("p");
    el.setAttribute("data-p", String(start));
    const bounds = splits[i] ?? [];
    let s = 0;
    for (const b of [...bounds, p.length]) {
      if (b > s) {
        const span = document.createElement("span");
        span.setAttribute("data-s", String(start + s));
        span.textContent = p.slice(s, b);
        el.appendChild(span);
      }
      s = b;
    }
    if (p.length === 0) el.appendChild(document.createElement("br"));
    root.appendChild(el);
    start += p.length + 1;
  });
  document.body.appendChild(root);
  return root;
}

describe("selection mapping", () => {
  const text = "hello world\n\nsecond para";
  const root = build(text, [[5], [], [7]]);

  it("maps text node points to offsets", () => {
    const spans = root.querySelectorAll("span[data-s]");
    expect(pointToOffset(spans[1]!.firstChild!, 3, root)).toBe(8);
    expect(pointToOffset(spans[3]!.firstChild!, 0, root)).toBe(20);
  });

  it("maps element boundaries", () => {
    const p0 = root.children[0]!;
    expect(pointToOffset(p0, 0, root)).toBe(0);
    expect(pointToOffset(p0, 2, root)).toBe(11);
    expect(pointToOffset(root, 2, root)).toBe(13); // start of third paragraph
    expect(pointToOffset(root, 1, root)).toBe(12); // empty paragraph
    expect(pointToOffset(document.body, 0, root)).toBeNull();
  });

  it("converts a range and trims whitespace", () => {
    const spans = root.querySelectorAll("span[data-s]");
    const range = document.createRange();
    range.setStart(spans[0]!.firstChild!, 2);
    range.setEnd(spans[1]!.firstChild!, 2); // "llo w" -> before trim "llo w"
    expect(rangeToOffsets(range, root, text)).toEqual({ start: 2, end: 7 });
    const ws = document.createRange();
    ws.setStart(spans[0]!.firstChild!, 5); // " wo"
    ws.setEnd(spans[1]!.firstChild!, 3);
    expect(rangeToOffsets(ws, root, text)).toEqual({ start: 6, end: 8 });
    expect(rangeToOffsets(ws, root, text, { trim: false })).toEqual({ start: 5, end: 8 });
    const collapsed = document.createRange();
    collapsed.setStart(spans[0]!.firstChild!, 1);
    collapsed.setEnd(spans[0]!.firstChild!, 1);
    expect(rangeToOffsets(collapsed, root, text)).toBeNull();
  });

  it("round-trips offsets to a range across spans and paragraphs", () => {
    const r = offsetsToRange(root, 3, 20)!;
    expect(r).not.toBeNull();
    expect(rangeToOffsets(r, root, text, { trim: false })).toEqual({ start: 3, end: 20 });
    expect(r.toString()).toBe("lo worldsecond ");
    expect(offsetsToRange(root, 3, 999)).toBeNull();
  });
});
