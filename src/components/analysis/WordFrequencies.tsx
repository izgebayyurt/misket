import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WordFrequency, WordFrequencyOptions, WordFrequencyScope } from "@/api/types";
import { DEFAULT_WORD_FREQUENCY_OPTIONS } from "@/api/types";
import { toCsv } from "@/core/csv";
import { useSetStopWords, useStopWords, useWordFrequencies } from "@/queries/analysis";
import { useDocuments } from "@/queries/documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";
import { toast } from "@/state/toasts";
import { AnalysisToolbar, CodeFilter, DocumentFilter, EmptyNote, ExportCsvButton } from "./shared";

type SortKey = "term" | "count" | "documents";
type ViewMode = "table" | "cloud";

const WORD_CLOUD_LIMIT = 100;

export function WordFrequencies() {
  const { t } = useTranslation();
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const { data: allDocuments } = useDocuments();
  const [documentSetIds, setDocumentSetIds] = useState<string[]>([]);
  const [codeIds, setCodeIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [stopWords, setStopWordsOn] = useState(true);
  const [stem, setStem] = useState(false);
  const [view, setView] = useState<ViewMode>("table");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "count", desc: true });
  const setWorkspaceView = useWorkspace((s) => s.setView);

  const scope: WordFrequencyScope = useMemo(
    () => ({
      documentIds: documentIds.length ? documentIds : null,
      documentSetIds: documentSetIds.length ? documentSetIds : null,
      codeIds: codeIds.length ? codeIds : null,
    }),
    [documentIds, documentSetIds, codeIds],
  );
  const options: WordFrequencyOptions = useMemo(
    () => ({ ...DEFAULT_WORD_FREQUENCY_OPTIONS, stopWords, stem }),
    [stopWords, stem],
  );
  const { data, isPending } = useWordFrequencies(scope, options);

  const rows = useMemo<WordFrequency[]>(() => {
    const q = search.trim().toLowerCase();
    const filtered = (data ?? []).filter((r) => !q || r.term.toLowerCase().includes(q));
    const sorted = [...filtered].sort((a, b) => {
      const by = sort.key === "term" ? a.term.localeCompare(b.term) : a[sort.key] - b[sort.key];
      return sort.desc ? -by : by;
    });
    return sorted;
  }, [data, search, sort]);

  const maxCount = Math.max(1, ...rows.map((r) => r.count));

  function openInSearch(term: string) {
    setWorkspaceView({ kind: "search", query: term });
  }

  function csv() {
    return toCsv([
      ["Term", "Count", "Documents"],
      ...rows.map((r) => [r.term, r.count, r.documents]),
    ]);
  }

  const header = (key: SortKey, label: string, className?: string) => (
    <th
      className={cn("cursor-default select-none px-3 py-1.5 font-medium hover:text-fg", className)}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "term" }))}
      data-testid={`word-frequencies-sort-${key}`}
      scope="col"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sort.key === key ? (
          sort.desc ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronUp className="size-3" />
          )
        ) : null}
      </span>
    </th>
  );

  // A recording has no words. Saying so beats an empty list that looks like a
  // bug — the backend counts text documents only (`db::analysis`).
  const onlyRecordings =
    documentIds.length > 0 &&
    documentIds.every((id) => allDocuments?.find((d) => d.id === id)?.kind === "video");

  return (
    <div className="flex h-full flex-col" data-testid="analysis-word-frequencies">
      <AnalysisToolbar>
        <DocumentFilter
          documentIds={documentIds}
          onChange={setDocumentIds}
          documentSetIds={documentSetIds}
          onSetIdsChange={setDocumentSetIds}
        />
        <CodeFilter codeIds={codeIds} onChange={setCodeIds} />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("analysis.words.filterWords")}
          className="h-7 w-40 text-xs"
          data-testid="word-frequencies-search"
        />
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={stopWords}
            onChange={(e) => setStopWordsOn(e.target.checked)}
            data-testid="word-frequencies-stop-words"
          />
          {t("analysis.words.stopWords")}
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={stem}
            onChange={(e) => setStem(e.target.checked)}
            data-testid="word-frequencies-stem"
          />
          {t("analysis.words.groupByStem")}
        </label>
        <StopWordsEditor />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-fg-muted">
            {t("analysis.words.wordCount", { count: rows.length })}
          </span>
          <div className="flex overflow-hidden rounded-md border border-border text-xs">
            <button
              type="button"
              className={cn(
                "px-2 py-1",
                view === "table" ? "bg-accent text-accent-fg" : "hover:bg-muted",
              )}
              onClick={() => setView("table")}
              data-testid="word-frequencies-view-table"
            >
              {t("analysis.words.viewTable")}
            </button>
            <button
              type="button"
              className={cn(
                "px-2 py-1",
                view === "cloud" ? "bg-accent text-accent-fg" : "hover:bg-muted",
              )}
              onClick={() => setView("cloud")}
              data-testid="word-frequencies-view-cloud"
            >
              {t("analysis.words.viewCloud")}
            </button>
          </div>
          <ExportCsvButton name="word-frequencies" build={csv} disabled={!rows.length} />
        </div>
      </AnalysisToolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        {!rows.length ? (
          <EmptyNote>
            {isPending
              ? t("analysis.counting")
              : onlyRecordings
                ? t("analysis.words.needsTranscript")
                : t("analysis.words.noneForSelection")}
          </EmptyNote>
        ) : view === "cloud" ? (
          <WordCloud
            rows={rows.slice(0, WORD_CLOUD_LIMIT)}
            maxCount={maxCount}
            onPick={openInSearch}
          />
        ) : (
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-panel text-left text-xs text-fg-muted shadow-[0_1px_0_var(--border)]">
              <tr>
                {header("term", t("analysis.words.colTerm"))}
                {header("count", t("analysis.words.colCount"), "w-24 text-right")}
                {header("documents", t("analysis.frequencies.colDocuments"), "w-28 text-right")}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.term}
                  className="cursor-default border-b border-border hover:bg-muted"
                  onClick={() => openInSearch(r.term)}
                  title={t("analysis.words.findAcrossProject", { term: r.term })}
                  data-testid="word-frequency-row"
                >
                  <td className="truncate px-3 py-1.5">{r.term}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.count}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.documents}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Sized inline spans, biggest word first, wrapping like text — no charting
 * library needed for a word cloud this simple. */
function WordCloud({
  rows,
  maxCount,
  onPick,
}: {
  rows: WordFrequency[];
  maxCount: number;
  onPick: (term: string) => void;
}) {
  const { t } = useTranslation();
  const MIN_PX = 12;
  const MAX_PX = 40;
  return (
    <div
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-6 leading-none"
      data-testid="word-cloud"
    >
      {rows.map((r) => {
        const scale = Math.sqrt(r.count / maxCount); // area-proportional, not linear
        const size = Math.round(MIN_PX + scale * (MAX_PX - MIN_PX));
        return (
          <button
            key={r.term}
            type="button"
            className="rounded px-1 text-accent hover:bg-muted hover:underline"
            style={{ fontSize: `${size}px` }}
            onClick={() => onPick(r.term)}
            title={t("analysis.words.cloudTitle", {
              term: r.term,
              occurrences: t("analysis.words.occurrenceCount", { count: r.count }),
              documents: t("excerpts.filters.documentCount", { count: r.documents }),
            })}
            data-testid="word-cloud-term"
          >
            {r.term}
          </button>
        );
      })}
    </div>
  );
}

/** A popover editor for the project's custom stop-word list, on top of the
 * built-in English list. */
function StopWordsEditor() {
  const { t } = useTranslation();
  const { data: words } = useStopWords();
  const setStopWords = useSetStopWords();
  const [text, setText] = useState<string | null>(null);
  const value = text ?? (words ?? []).join(", ");

  async function save() {
    try {
      const list = value
        .split(/[,\n]/)
        .map((w) => w.trim())
        .filter(Boolean);
      await setStopWords.mutateAsync(list);
      toast.info(t("analysis.words.stopWordsUpdated"));
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Popover onOpenChange={(open) => !open && setText(null)}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-testid="stop-words-editor-trigger">
          <Settings2 /> {t("analysis.words.stopWordsEllipsis")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <p className="mb-2 text-xs text-fg-muted">{t("analysis.words.stopWordsHint")}</p>
        <textarea
          className="h-28 w-full resize-none rounded-md border border-border bg-bg p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
          value={value}
          onChange={(e) => setText(e.target.value)}
          data-testid="stop-words-editor-textarea"
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={() => void save()} disabled={setStopWords.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
