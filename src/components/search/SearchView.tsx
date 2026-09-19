import { useEffect, useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SearchHit } from "@/api/types";
import { useProjectSearch } from "@/queries/search";
import { useWorkspace } from "@/state/workspace";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isAppError } from "@/api/client";
import { AutoCodeDialog } from "./AutoCodeDialog";

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
export function SearchView({ initialQuery }: { initialQuery?: string } = {}) {
  const { t } = useTranslation();
  const [input, setInput] = useState(initialQuery ?? "");
  const [debounced, setDebounced] = useState(initialQuery ?? "");
  const [stem, setStem] = useState(false);
  const [regexMode, setRegexMode] = useState(false);
  const [autoCoding, setAutoCoding] = useState(false);
  const openDocument = useWorkspace((s) => s.openDocument);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(input), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [input]);

  const { data: hits, isFetching, error } = useProjectSearch(debounced, regexMode, stem);
  const groups = useMemo(() => groupByDocument(hits ?? []), [hits]);
  const hasQuery = debounced.trim().length > 0;
  const invalidRegex = isAppError(error, "Validation") ? error.message : null;

  return (
    <div className="flex h-full flex-col" data-testid="search-view">
      <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-2">
        <h2 className="mr-1 font-serif text-lg font-medium">{t("search.title")}</h2>
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-muted" />
          <Input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={regexMode ? t("search.placeholderRegex") : t("search.placeholderPlain")}
            className="h-8 pl-7"
            data-testid="search-input"
          />
        </div>
        <Button
          size="sm"
          variant={regexMode ? "default" : "outline"}
          onClick={() =>
            setRegexMode((v) => {
              // Regex matches raw text, so "Match word forms" wouldn't mean
              // anything while it's on; keep the two mutually exclusive.
              if (!v) setStem(false);
              return !v;
            })
          }
          aria-pressed={regexMode}
          title={t("search.regexToggleTitle")}
          data-testid="regex-toggle"
        >
          .*
        </Button>
        <label
          className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted"
          title={regexMode ? t("search.matchWordFormsUnavailable") : t("search.matchWordFormsHint")}
        >
          <input
            type="checkbox"
            checked={stem}
            disabled={regexMode}
            onChange={(e) => setStem(e.target.checked)}
            data-testid="search-match-word-forms"
          />
          {t("search.matchWordForms")}
        </label>
        {hasQuery && !invalidRegex ? (
          <span className="ml-auto text-xs text-fg-muted" data-testid="search-total">
            {t("search.matchCount", { count: hits?.length ?? 0 })}
          </span>
        ) : null}
        {hasQuery && !invalidRegex && hits && hits.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAutoCoding(true)}
            data-testid="auto-code-all"
          >
            <Sparkles /> {t("search.autoCodeAll", { count: hits.length })}
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {invalidRegex ? (
          <p className="p-6 text-sm text-danger" data-testid="search-error">
            {invalidRegex}
          </p>
        ) : !hasQuery ? (
          <p className="p-6 text-sm text-fg-muted">{t("search.typeToSearchHint")}</p>
        ) : groups.length === 0 && !isFetching ? (
          <p className="p-6 text-sm text-fg-muted">
            {t("search.noMatches", { query: debounced.trim() })}
          </p>
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
                      <span className="font-semibold text-fg">{h.matchedText}</span>
                      <span className="text-fg-muted">{h.contextAfter}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
      {autoCoding && hits && hits.length > 0 ? (
        <AutoCodeDialog hits={hits} onClose={() => setAutoCoding(false)} />
      ) : null}
    </div>
  );
}
