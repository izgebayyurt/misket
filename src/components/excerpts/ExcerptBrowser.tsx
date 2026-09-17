import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExcerptFilter } from "@/api/types";
import { useExcerptQuery } from "@/queries/excerpts";
import { useWorkspace } from "@/state/workspace";
import { useShortcutActions } from "@/state/shortcutActions";
import { isTextField, mod } from "@/core/keymap";
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
import { ReviewBar } from "./ReviewBar";
import { Button } from "@/components/ui/button";
import { CodeDialog } from "@/components/codebook/CodeDialog";
import { useCodeTree } from "@/queries/codes";
import { usePushDownExcerpt } from "@/queries/excerpts";
import { toast } from "@/state/toasts";

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

  // Push-down review, read on mount like the filter. Closing the bar is local
  // state: nothing else re-reads the view, and remounting would throw away
  // the scroll position mid-review.
  const [reviewParentId, setReviewParentId] = useState<string | null>(() => {
    const view = useWorkspace.getState().view;
    return view.kind === "excerpts" ? (view.review?.parentCodeId ?? null) : null;
  });
  const tree = useCodeTree();
  const reviewParent = reviewParentId ? tree.byId.get(reviewParentId) : undefined;
  const pushDown = usePushDownExcerpt();
  const [reviewIndex, setReviewIndex] = useState(0);
  const [newChildOpen, setNewChildOpen] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

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
  const rowCount = rows.length;
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

  // --- push-down review -----------------------------------------------------
  const reviewChildren = useMemo(
    () => (reviewParent ? reviewParent.children.map((n) => n.code) : []),
    [reviewParent],
  );

  /** Re-file the focused row under one of the parent's children. */
  const pushDownRow = useCallback(
    async (childId: string) => {
      if (!reviewParent) return;
      const row = rows[reviewIndex];
      if (!row) return;
      const child = tree.byId.get(childId)?.code;
      try {
        await pushDown.mutateAsync({
          excerptId: row.id,
          fromCodeId: reviewParent.code.id,
          toCodeId: childId,
          label: `Push down to ${child?.name ?? "sub-code"}`,
        });
        // The row leaves the result set, so the next one takes its index;
        // clamping keeps the focus on the last row once the list runs out.
        setReviewIndex((i) => Math.max(0, Math.min(i, rows.length - 2)));
      } catch (e) {
        toast.error(e);
      }
    },
    [pushDown, reviewIndex, reviewParent, rows, tree],
  );

  // Number keys pick a child, arrows walk the list. Bound only while
  // reviewing, so digits mean nothing in the ordinary browser.
  useEffect(() => {
    if (!reviewParent) return;
    function onKey(e: KeyboardEvent) {
      if (isTextField(e.target) || mod(e) || e.altKey) return;
      if (useWorkspace.getState().paletteOpen) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setReviewIndex((i) => Math.max(0, Math.min(rowCount - 1, i + step)));
        return;
      }
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const child = reviewChildren[n - 1];
      if (!child) return;
      e.preventDefault();
      void pushDownRow(child.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewParent, pushDownRow, reviewChildren, rowCount]);

  // Keep the focused row on screen as it advances.
  useEffect(() => {
    if (!reviewParent) return;
    const items = listRef.current?.querySelectorAll("li");
    items?.[reviewIndex]?.scrollIntoView({ block: "nearest" });
  }, [reviewIndex, reviewParent, rows]);

  return (
    <div className="relative flex h-full flex-col" data-testid="excerpt-browser">
      {reviewParent ? (
        <ReviewBar
          parent={reviewParent.code}
          remaining={data?.total ?? rows.length}
          hasTarget={!!rows[reviewIndex]}
          busy={pushDown.isPending}
          onPushDown={(childId) => void pushDownRow(childId)}
          onNewChild={() => setNewChildOpen(true)}
          onDone={() => setReviewParentId(null)}
          childCodes={reviewChildren}
        />
      ) : null}
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
        overlapsCodeId={state.overlapsCodeId}
        onOverlapsCodeId={(overlapsCodeId) => update({ overlapsCodeId })}
        descriptors={state.descriptors}
        onDescriptors={(descriptors) => update({ descriptors })}
        query={state.query}
        onQuery={(query) => update({ query })}
        speakers={state.speakers}
        onSpeakers={(speakers) => update({ speakers })}
        coderIds={state.coderIds}
        onCoderIds={(coderIds) => update({ coderIds })}
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
              : state.requireAllCodes && !state.overlapsCodeId && codePickCount(state) > 1
                ? "No single excerpt carries all of these codes. Untick “match all selected codes” to see excerpts carrying any of them."
                : "Nothing matches these filters."}
          </p>
        ) : null}
        <ul ref={listRef} className="divide-y divide-border">
          {rows.map((row, index) => (
            <ExcerptRow
              key={row.id}
              row={row}
              selected={selection.ids.has(row.id)}
              // In review mode a click picks the row the child buttons act
              // on, rather than leaving for the document.
              active={reviewParent ? index === reviewIndex : false}
              onOpen={() =>
                reviewParent ? setReviewIndex(index) : openDocument(row.documentId, row.id)
              }
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
      {newChildOpen && reviewParent ? (
        <CodeDialog
          mode="create"
          parentId={reviewParent.code.id}
          onClose={() => setNewChildOpen(false)}
        />
      ) : null}
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
