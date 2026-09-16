import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExcerptFilter } from "@/api/types";
import { useExcerptQuery } from "@/queries/excerpts";
import { useWorkspace } from "@/state/workspace";
import { useShortcutActions } from "@/state/shortcutActions";
import {
  clickRow,
  codesInSelection,
  emptySelection,
  pruneSelection,
  selectedInOrder,
  toggleAll,
} from "@/core/multiSelect";
import {
  codePickCount,
  filterState,
  isFiltered,
  toFilter,
  type FilterState,
} from "@/core/excerptFilter";
import { ExcerptFilters } from "./ExcerptFilters";
import { ExcerptRow } from "./ExcerptRow";
import { BulkActionBar } from "./BulkActionBar";
import { Button } from "@/components/ui/button";

const PAGE = 200;

export function ExcerptBrowser() {
  // The analysis views open the browser with a filter already set; it is read
  // once, on mount (Workspace remounts this component when it changes).
  const [state, setState] = useState<FilterState>(() => {
    const view = useWorkspace.getState().view;
    return filterState(view.kind === "excerpts" ? view.initialFilter : null);
  });
  const [pages, setPages] = useState(1);
  const openDocument = useWorkspace((s) => s.openDocument);

  /** Any filter change starts the result list over at one page. */
  const update = useCallback((patch: Partial<FilterState>) => {
    setState((s) => ({ ...s, ...patch }));
    setPages(1);
  }, []);
  /**
   * Applying a saved filter sets every field rather than merging into what is
   * there, so anything the saved filter leaves out goes back to its default.
   */
  const applyFilter = useCallback(
    (f: ExcerptFilter) => {
      update(filterState(f));
    },
    [update],
  );

  const filter = useMemo<ExcerptFilter>(() => toFilter(state, PAGE * pages), [state, pages]);
  const { data, isFetching } = useExcerptQuery(filter);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const [rawSelection, setSelection] = useState(emptySelection);
  const register = useShortcutActions((s) => s.register);

  // Rows that left the result set (the filters changed, excerpts were deleted)
  // must not stay in the selection the action bar acts on, so the selection is
  // read through the currently loaded rows.
  const selection = useMemo(() => pruneSelection(rawSelection, rowIds), [rawSelection, rowIds]);
  // Escape clears the selection, like it clears a text selection elsewhere.
  useEffect(() => {
    if (selection.ids.size === 0) return;
    return register({ escape: () => setSelection(emptySelection) });
  }, [register, selection.ids.size]);

  const selectedIds = selectedInOrder(selection, rowIds);
  const allSelected = rowIds.length > 0 && selectedIds.length === rowIds.length;

  return (
    <div className="relative flex h-full flex-col" data-testid="excerpt-browser">
      <ExcerptFilters
        codeIds={state.codeIds}
        onCodeIds={(codeIds) => update({ codeIds })}
        codeSetIds={state.codeSetIds}
        onCodeSetIds={(codeSetIds) => update({ codeSetIds })}
        includeDescendants={state.includeDescendants}
        onIncludeDescendants={(includeDescendants) => update({ includeDescendants })}
        requireAllCodes={state.requireAllCodes}
        onRequireAllCodes={(requireAllCodes) => update({ requireAllCodes })}
        documentIds={state.documentIds}
        onDocumentIds={(documentIds) => update({ documentIds })}
        documentSetIds={state.documentSetIds}
        onDocumentSetIds={(documentSetIds) => update({ documentSetIds })}
        uncodedOnly={state.uncodedOnly}
        onUncodedOnly={(uncodedOnly) => update({ uncodedOnly })}
        descriptors={state.descriptors}
        onDescriptors={(descriptors) => update({ descriptors })}
        filter={filter}
        onApplyFilter={applyFilter}
        total={data?.total ?? 0}
      />
      {rows.length > 0 ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-fg-muted">
          <label className="flex cursor-default items-center gap-2">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selectedIds.length > 0 && !allSelected;
              }}
              onChange={() => setSelection(toggleAll(selection, rowIds))}
              data-testid="select-all-excerpts"
            />
            Select all {rows.length} loaded
          </label>
          {selectedIds.length > 0 ? <span>{selectedIds.length} selected</span> : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {data && data.rows.length === 0 ? (
          <p className="p-6 text-sm text-fg-muted">
            {data.total === 0 && !isFiltered(state)
              ? "No excerpts yet. Select text in a document and press the palette shortcut to code it."
              : state.requireAllCodes && codePickCount(state) > 1
                ? "No single excerpt carries all of these codes. Untick “match all selected codes” to see excerpts carrying any of them."
                : "Nothing matches these filters."}
          </p>
        ) : null}
        <ul className="divide-y divide-border">
          {rows.map((row, index) => (
            <ExcerptRow
              key={row.id}
              row={row}
              selected={selection.ids.has(row.id)}
              onOpen={() => openDocument(row.documentId, row.id)}
              onToggle={(shiftKey) => setSelection(clickRow(selection, rowIds, index, shiftKey))}
            />
          ))}
        </ul>
        {data && data.rows.length < data.total ? (
          <div className="p-3">
            <Button variant="outline" onClick={() => setPages((p) => p + 1)} disabled={isFetching}>
              Load more ({data.total - data.rows.length} remaining)
            </Button>
          </div>
        ) : null}
      </div>
      {selectedIds.length > 0 ? (
        <BulkActionBar
          ids={selectedIds}
          codeIds={codesInSelection(rows, selection)}
          onClear={() => setSelection(emptySelection)}
        />
      ) : null}
    </div>
  );
}
