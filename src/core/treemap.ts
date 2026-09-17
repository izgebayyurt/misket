/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk, "Squarified
 * Treemaps", 2000) and the small hierarchy helpers the code-treemap view
 * needs on top of it. Pure geometry: no SVG, no React, no chart library.
 */

export interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreemapItem {
  id: string;
  /** Must be `>= 0`. Non-positive values are dropped before layout. */
  value: number;
}

export interface TreemapLeaf extends TreemapItem, TreemapRect {}

/** The worst (largest) aspect ratio any rectangle in `row` would have if
 * laid out along a strip of the given `length`, per Bruls et al. §3.
 * `row` holds *areas* already scaled to the target rectangle's units, and
 * `length` is the shorter side of the remaining rectangle. Lower is better;
 * 1 is a perfect square. */
function worst(row: number[], length: number): number {
  if (row.length === 0) return Infinity;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const a of row) {
    sum += a;
    if (a > max) max = a;
    if (a < min) min = a;
  }
  const lenSq = length * length;
  const sumSq = sum * sum;
  return Math.max((lenSq * max) / sumSq, sumSq / (lenSq * min));
}

/**
 * Lay out `items` in `rect` with the squarified algorithm: areas are exactly
 * proportional to `value` (scaled so they sum to `rect`'s area), tiled with
 * no gaps and no overlaps, always inside `rect`'s bounds, favouring rows
 * whose cells are close to square. Items are laid out in the order given —
 * sort by value descending first for the usual "biggest first" look, which
 * is also what keeps aspect ratios closest to 1.
 *
 * Non-positive values and a non-positive `rect` are dropped/short-circuited
 * rather than producing NaN or infinite geometry.
 */
export function squarify(items: TreemapItem[], rect: TreemapRect): TreemapLeaf[] {
  const usable = items.filter((i) => i.value > 0);
  if (usable.length === 0 || rect.w <= 0 || rect.h <= 0) return [];

  const total = usable.reduce((a, i) => a + i.value, 0);
  const scale = (rect.w * rect.h) / total;
  const areas = usable.map((i) => i.value * scale);

  const out: TreemapLeaf[] = [];
  let x = rect.x;
  let y = rect.y;
  let w = rect.w;
  let h = rect.h;
  let i = 0;

  while (i < usable.length) {
    const length = Math.min(w, h);
    const row: number[] = [areas[i]!];
    let j = i + 1;
    // Grow the row while adding the next item improves (or ties) the worst
    // aspect ratio in it; stop the moment it would get worse.
    while (j < usable.length) {
      const candidate = [...row, areas[j]!];
      if (worst(candidate, length) > worst(row, length)) break;
      row.push(areas[j]!);
      j++;
    }

    const rowSum = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      // Vertical strip on the left, `rowSum / h` wide; items stack top to bottom.
      const stripW = rowSum / h;
      let cy = y;
      for (let k = 0; k < row.length; k++) {
        const item = usable[i + k]!;
        const itemH = row[k]! / stripW;
        out.push({ id: item.id, value: item.value, x, y: cy, w: stripW, h: itemH });
        cy += itemH;
      }
      x += stripW;
      w -= stripW;
    } else {
      // Horizontal strip on top, `rowSum / w` tall; items lay left to right.
      const stripH = rowSum / w;
      let cx = x;
      for (let k = 0; k < row.length; k++) {
        const item = usable[i + k]!;
        const itemW = row[k]! / stripH;
        out.push({ id: item.id, value: item.value, x: cx, y, w: itemW, h: stripH });
        cx += itemW;
      }
      y += stripH;
      h -= stripH;
    }
    i = j;
  }
  return out;
}

/** `squarify`, but sorting `items` by value descending first (ties broken by
 * the input order), which is the conventional way to feed it and gives the
 * most square cells. Most callers want this rather than raw `squarify`. */
export function squarifySorted(items: TreemapItem[], rect: TreemapRect): TreemapLeaf[] {
  const sorted = items
    .map((item, order) => ({ item, order }))
    .sort((a, b) => b.item.value - a.item.value || a.order - b.order)
    .map((x) => x.item);
  return squarify(sorted, rect);
}

// --------------------------------------------------------------- hierarchy

/** One code's worth of input to the treemap: its own id/value plus its
 * direct children, recursively. The tree the treemap view drills through. */
export interface TreemapCode {
  id: string;
  name: string;
  color: string;
  /** Area for this node at the current drill level: own or with-descendants
   * excerpt count, per the view's toggle. */
  value: number;
  children: TreemapCode[];
}

/** A drilled node's direct children, laid out to fill the whole viewport
 * (each drill level starts fresh — this is a "zoomable" treemap, not a
 * nested one), plus the node itself for a leaf with nothing to drill into. */
export interface TreemapLevel {
  node: TreemapCode;
  /** Squarified layout of `node.children`, or `[node]` itself when it has
   * none, so a leaf still renders as one full-viewport cell. */
  cells: (TreemapLeaf & { code: TreemapCode })[];
}

/** Lay out one drill level: `node`'s children fill `rect`, or `node` itself
 * fills it when there is nothing below to drill into. Cells with zero area
 * are omitted (nothing to click, nothing to see). */
export function layoutLevel(node: TreemapCode, rect: TreemapRect): TreemapLevel {
  const source = node.children.length ? node.children : [node];
  const byId = new Map(source.map((c) => [c.id, c]));
  const cells = squarifySorted(
    source.map((c) => ({ id: c.id, value: c.value })),
    rect,
  ).map((leaf) => ({ ...leaf, code: byId.get(leaf.id)! }));
  return { node, cells };
}

/** A lightness step per depth, applied on top of a code's own colour so
 * descendants read as tints of their ancestor rather than unrelated hues.
 * `color-mix` does the actual mixing at render time; this only says how far
 * to go relative to the code's *own* saturated colour (depth 0). */
export function tintFor(baseDepth: number, cellDepth: number): number {
  const steps = Math.max(0, cellDepth - baseDepth);
  return Math.min(0.75, steps * 0.22);
}

/** The smallest cell side (px) below which a label is unreadable and should
 * be hidden rather than overflow or get truncated to nothing. */
export const MIN_LABEL_SIDE = 28;

/** Whether a cell is big enough to carry a label at all. */
export function canLabel(cell: TreemapRect, minSide = MIN_LABEL_SIDE): boolean {
  return cell.w >= minSide && cell.h >= minSide * 0.6;
}
