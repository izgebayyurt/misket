/**
 * Checkbox multi-selection over an ordered list of rows, with Shift+click
 * ranges. Pure state so the excerpt browser only has to render it.
 */

export interface SelectionState {
  /** The selected ids, in no particular order. */
  ids: ReadonlySet<string>;
  /** Index of the row last clicked, the anchor a Shift+click extends from. */
  anchor: number | null;
}

export const emptySelection: SelectionState = { ids: new Set(), anchor: null };

/**
 * Click the checkbox of row `index`.
 *
 * A plain click toggles that one row and becomes the new anchor. `Shift`+click
 * selects every row between the anchor and here (inclusive) without clearing
 * what is already selected, and leaves the anchor where it was so the range
 * can be re-dragged. With no anchor yet, `Shift` behaves like a plain click.
 */
export function clickRow(
  state: SelectionState,
  rowIds: readonly string[],
  index: number,
  shiftKey: boolean,
): SelectionState {
  const id = rowIds[index];
  if (id === undefined) return state;
  if (shiftKey && state.anchor !== null && state.anchor < rowIds.length) {
    const from = Math.min(state.anchor, index);
    const to = Math.max(state.anchor, index);
    const ids = new Set(state.ids);
    for (const rowId of rowIds.slice(from, to + 1)) ids.add(rowId);
    return { ids, anchor: state.anchor };
  }
  const ids = new Set(state.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: index };
}

/** Select every loaded row, or clear the selection if all of them are selected. */
export function toggleAll(state: SelectionState, rowIds: readonly string[]): SelectionState {
  if (rowIds.length > 0 && rowIds.every((id) => state.ids.has(id))) return emptySelection;
  return { ids: new Set(rowIds), anchor: null };
}

/**
 * Forget ids that are no longer loaded (the filters changed, or a page was
 * reloaded after a delete), keeping the selection honest about what the
 * action bar will act on.
 */
export function pruneSelection(state: SelectionState, rowIds: readonly string[]): SelectionState {
  const loaded = new Set(rowIds);
  const ids = new Set([...state.ids].filter((id) => loaded.has(id)));
  if (ids.size === state.ids.size) return state;
  return { ids, anchor: ids.size ? state.anchor : null };
}

/** The selected ids in row order, which is what the backend calls expect. */
export function selectedInOrder(state: SelectionState, rowIds: readonly string[]): string[] {
  return rowIds.filter((id) => state.ids.has(id));
}

/**
 * Every code carried by at least one selected row, in the order the rows list
 * them — the candidates for "Remove code…".
 */
export function codesInSelection(
  rows: readonly { id: string; codeIds: readonly string[] }[],
  state: SelectionState,
): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!state.ids.has(row.id)) continue;
    for (const codeId of row.codeIds) seen.add(codeId);
  }
  return [...seen];
}
