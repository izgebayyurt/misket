import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { SearchHit } from "@/api/types";
import { useProjectSearch } from "@/queries/search";
import { useWorkspace } from "@/state/workspace";
import { Input } from "@/components/ui/input";

const DEBOUNCE_MS = 200;

interface DocumentGroup {
  documentId: string;
  documentName: string;
  hits: SearchHit[];
}

function groupByDocument(hits: SearchHit[]): DocumentGroup[] {
  const groups: DocumentGroup[] = [];
  const byId = new Map<string, DocumentGroup>();
  for (const hit of hits) {
    let group = byId.get(hit.documentId);
    if (!group) {
      group = { documentId: hit.documentId, documentName: hit.documentName, hits: [] };
      byId.set(hit.documentId, group);
      groups.push(group);
    }
    group.hits.push(hit);
  }
  return groups;
}

/** Project-wide "find in project": debounced search across every document. */
export function SearchView() {
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const openDocument = useWorkspace((s) => s.openDocument);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(input), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [input]);

  const { data: hits, isFetching } = useProjectSearch(debounced);
  const groups = useMemo(() => groupByDocument(hits ?? []), [hits]);
  const hasQuery = debounced.trim().length > 0;

  return (
    <div className="flex h-full flex-col" data-testid="search-view">
      <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-2">
        <h2 className="mr-1 font-serif text-lg font-medium">Search</h2>
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-muted" />
          <Input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search across all documents…"
            className="h-8 pl-7"
            data-testid="search-input"
          />
        </div>
        {hasQuery ? (
          <span className="ml-auto text-xs text-fg-muted" data-testid="search-total">
            {hits?.length ?? 0} match{hits?.length === 1 ? "" : "es"}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasQuery ? (
          <p className="p-6 text-sm text-fg-muted">Type to search across every document.</p>
        ) : groups.length === 0 && !isFetching ? (
          <p className="p-6 text-sm text-fg-muted">Nothing matches “{debounced.trim()}”.</p>
        ) : (
          groups.map((g) => (
            <div key={g.documentId}>
              <div className="bg-muted px-4 py-1.5 text-xs font-medium text-fg-muted">
                {g.documentName} · {g.hits.length}
              </div>
              <ul className="divide-y divide-border">
                {g.hits.map((h, i) => (
                  <li key={`${h.startPos}-${i}`}>
                    <button
                      className="block w-full px-4 py-2.5 text-left font-serif text-[15px] leading-snug hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      onClick={() => openDocument(h.documentId, undefined, h.startPos)}
                      data-testid="search-hit"
                    >
                      <span className="text-fg-muted">{h.contextBefore}</span>
                      <span className="font-semibold text-fg">{debounced.trim()}</span>
                      <span className="text-fg-muted">{h.contextAfter}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
