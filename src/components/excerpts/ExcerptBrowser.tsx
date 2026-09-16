import { useMemo, useState } from "react";
import type { DescriptorFilter, ExcerptFilter } from "@/api/types";
import { useExcerptQuery } from "@/queries/excerpts";
import { useWorkspace } from "@/state/workspace";
import { ExcerptFilters } from "./ExcerptFilters";
import { ExcerptRow } from "./ExcerptRow";
import { Button } from "@/components/ui/button";

const PAGE = 200;

export function ExcerptBrowser() {
  const [codeIds, setCodeIds] = useState<string[]>([]);
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [uncodedOnly, setUncodedOnly] = useState(false);
  const [descriptors, setDescriptors] = useState<DescriptorFilter[]>([]);
  const [pages, setPages] = useState(1);
  const openDocument = useWorkspace((s) => s.openDocument);

  const filter = useMemo<ExcerptFilter>(
    () => ({
      codeIds: codeIds.length ? codeIds : null,
      includeDescendants,
      documentIds: documentIds.length ? documentIds : null,
      uncodedOnly,
      descriptors: descriptors.length ? descriptors : null,
      limit: PAGE * pages,
      offset: 0,
    }),
    [codeIds, includeDescendants, documentIds, uncodedOnly, descriptors, pages],
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
        descriptors={descriptors}
        onDescriptors={(v) => {
          setDescriptors(v);
          setPages(1);
        }}
        total={data?.total ?? 0}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {data && data.rows.length === 0 ? (
          <p className="p-6 text-sm text-fg-muted">
            {data.total === 0 &&
            !codeIds.length &&
            !documentIds.length &&
            !descriptors.length &&
            !uncodedOnly
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
