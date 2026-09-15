/**
 * Map a DOM selection inside the document view to UTF-16 offsets and back.
 *
 * DOM contract: inside the text root, all text lives in `span[data-s]`
 * elements whose `data-s` is the UTF-16 start of that span and whose only
 * child is a text node. Paragraphs are `p[data-p]`. Nothing else contains text.
 */

export interface Offsets {
  start: number;
  end: number;
}

function spanStart(el: Element): number | null {
  const v = el.getAttribute("data-s");
  return v === null ? null : Number(v);
}

/** Resolve a (node, offset) boundary to a UTF-16 document offset. */
export function pointToOffset(node: Node, offset: number, root: Element): number | null {
  if (!root.contains(node)) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    const span = (node.parentElement ?? null)?.closest("span[data-s]");
    if (!span || !root.contains(span)) return null;
    const s = spanStart(span);
    return s === null ? null : s + offset;
  }
  if (!(node instanceof Element)) return null;
  // Element boundary: resolve to the child at `offset`, or the end of the previous one.
  if (node.matches("span[data-s]")) {
    const s = spanStart(node);
    if (s === null) return null;
    return offset === 0 ? s : s + (node.textContent?.length ?? 0);
  }
  const children = Array.from(node.childNodes);
  const after = children[offset];
  if (after) {
    const first = firstSpan(after);
    if (first) return spanStart(first);
    const p = after instanceof Element ? after.closest("p[data-p]") : null;
    if (p) return Number(p.getAttribute("data-p"));
  }
  const before = children[offset - 1];
  if (before) {
    const last = lastSpan(before);
    if (last) return (spanStart(last) ?? 0) + (last.textContent?.length ?? 0);
    const p = before instanceof Element ? before.closest("p[data-p]") : null;
    if (p) return Number(p.getAttribute("data-p"));
  }
  if (node.matches("p[data-p]")) return Number(node.getAttribute("data-p"));
  return null;
}

function firstSpan(node: Node): Element | null {
  if (node instanceof Element) {
    if (node.matches("span[data-s]")) return node;
    return node.querySelector("span[data-s]");
  }
  return null;
}

function lastSpan(node: Node): Element | null {
  if (node instanceof Element) {
    if (node.matches("span[data-s]")) return node;
    const all = node.querySelectorAll("span[data-s]");
    return all[all.length - 1] ?? null;
  }
  return null;
}

/**
 * Convert a Range to document offsets. Returns null for collapsed or
 * out-of-root selections. Trims surrounding whitespace by default.
 */
export function rangeToOffsets(
  range: Range,
  root: Element,
  text: string,
  opts: { trim?: boolean } = {},
): Offsets | null {
  const start = pointToOffset(range.startContainer, range.startOffset, root);
  const end = pointToOffset(range.endContainer, range.endOffset, root);
  if (start === null || end === null) return null;
  let s = Math.min(start, end);
  let e = Math.max(start, end);
  if (opts.trim ?? true) {
    while (s < e && /\s/.test(text[s]!)) s++;
    while (e > s && /\s/.test(text[e - 1]!)) e--;
  }
  if (e <= s) return null;
  return { start: s, end: e };
}

/** Find the text node and local offset for a UTF-16 document offset. */
export function offsetToPoint(
  root: Element,
  offset: number,
): { node: Node; offset: number } | null {
  const spans = root.querySelectorAll<HTMLElement>("span[data-s]");
  let best: HTMLElement | null = null;
  for (const span of spans) {
    const s = spanStart(span) ?? 0;
    const len = span.textContent?.length ?? 0;
    if (offset >= s && offset <= s + len) {
      best = span;
      if (offset < s + len) break; // prefer the span that contains, not just ends at, the offset
    }
  }
  if (!best) return null;
  const textNode = best.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;
  return { node: textNode, offset: offset - (spanStart(best) ?? 0) };
}

/** Build a Range for [start, end) or null if the offsets are not rendered. */
export function offsetsToRange(root: Element, start: number, end: number): Range | null {
  const a = offsetToPoint(root, start);
  const b = offsetToPoint(root, end);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}
