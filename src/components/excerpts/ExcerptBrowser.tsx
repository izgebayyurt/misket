import { useMemo, useState } from "react";
import type { ExcerptFilter } from "@/api/types";
import { useExcerptQuery } from "@/queries/excerpts";
import { useWorkspace } from "@/state/workspace";
import { ExcerptFilters } from "./ExcerptFilters";
import { ExcerptRow } from "./ExcerptRow";
import { Button } from "@/components/ui/button";

const PAGE = 200;

export function ExcerptBrowser() {
  // The analysis views open the browser with a filter already set; it is read
  // once, on mount (Workspace remounts this component when it changes).
  const [initial] = useState<ExcerptFilter>(() => {
    const view = useWorkspace.getState().view;
    return (view.kind === "excerpts" && view.initialFilter) || {};
  });
  const [codeIds, setCodeIds] = useState<string[]>(initial.codeIds ?? []);
  const [includeDescendants, setIncludeDescendants] = useState(initial.includeDescendants ?? true);
  const [requireAllCodes, setRequireAllCodes] = useState(initial.requireAllCodes ?? false);
  const [documentIds, setDocumentIds] = useState<string[]>(initial.documentIds ?? []);
  const [uncodedOnly, setUncodedOnly] = useState(initial.uncodedOnly ?? false);
  const [pages, setPages] = useState(1);
  const openDocument = useWorkspace((s) => s.openDocument);

  const filter = useMemo<ExcerptFilter>(
    () => ({
      codeIds: codeIds.length ? codeIds : null,
      includeDescendants,
      requireAllCodes,
      documentIds: documentIds.length ? documentIds : null,
      uncodedOnly,
      limit: PAGE * pages,
      offset: 0,
    }),
    [codeIds, includeDescendants, requireAllCodes, documentIds, uncodedOnly, pages],
  );
  const { data, isFetching } = useExcerptQuery(filter);

  return (
    <div className="flex h-full flex-col" data-testid="excerpt-browser">
      <ExcerptFilters
        codeIds={codeIds}
        onCodeIds={(v) => {
          setCodeIds(v);
          setPages(1);
        }}
        includeDescendants={includeDescendants}
        onIncludeDescendants={setIncludeDescendants}
        requireAllCodes={requireAllCodes}
        onRequireAllCodes={setRequireAllCodes}
        documentIds={documentIds}
        onDocumentIds={(v) => {
          setDocumentIds(v);
          setPages(1);
        }}
        uncodedOnly={uncodedOnly}
        onUncodedOnly={(v) => {
          setUncodedOnly(v);
          setPages(1);
        }}
        total={data?.total ?? 0}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {data && data.rows.length === 0 ? (
          <p className="p-6 text-sm text-fg-muted">
            {data.total === 0 && !codeIds.length && !documentIds.length && !uncodedOnly
              ? "No excerpts yet. Select text in a document and press the palette shortcut to code it."
              : "Nothing matches these filters."}
          </p>
        ) : null}
        <ul className="divide-y divide-border">
          {data?.rows.map((row) => (
            <ExcerptRow
              key={row.id}
              row={row}
              onOpen={() => openDocument(row.documentId, row.id)}
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
    </div>
  );
}
