import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { CodeFrequency } from "@/api/types";
import { flattenTree, pathOf } from "@/core/codeTree";
import { toCsv } from "@/core/csv";
import { useCodeFrequencies } from "@/queries/analysis";
import { useCodeTree } from "@/queries/codes";
import { useDocuments } from "@/queries/documents";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";
import { AnalysisToolbar, DocumentFilter, EmptyNote, ExportCsvButton } from "./shared";

type SortKey = "code" | "own" | "withDescendants" | "documentCount";

interface Row extends CodeFrequency {
  name: string;
  path: string;
  color: string;
  depth: number;
  order: number;
}

export function CodeFrequencies() {
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [documentSetIds, setDocumentSetIds] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "code", desc: false });
  const { data, isPending } = useCodeFrequencies(documentIds, documentSetIds);
  const tree = useCodeTree();
  const { data: docs } = useDocuments();
  const openExcerpts = useWorkspace((s) => s.openExcerpts);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const order = new Map(flattenTree(tree).map((n, i) => [n.code.id, i]));
    const out = data
      .filter((f) => tree.byId.has(f.codeId))
      .map((f) => {
        const node = tree.byId.get(f.codeId)!;
        return {
          ...f,
          name: node.code.name,
          path: pathOf(tree, f.codeId),
          color: node.code.color,
          depth: node.depth,
          order: order.get(f.codeId) ?? 0,
        };
      });
    out.sort((a, b) => {
      const by =
        sort.key === "code" ? a.order - b.order : (a[sort.key] as number) - (b[sort.key] as number);
      return (sort.desc ? -by : by) || a.order - b.order;
    });
    return out;
  }, [data, tree, sort]);

  const shownDocs = useMemo(
    () => (docs ?? []).filter((d) => !documentIds.length || documentIds.includes(d.id)),
    [docs, documentIds],
  );

  function csv() {
    const header = ["Code", "Own", "With sub-codes", "Documents", ...shownDocs.map((d) => d.name)];
    return toCsv([
      header,
      ...rows.map((r) => {
        const per = new Map(r.perDocument);
        return [
          r.path,
          r.own,
          r.withDescendants,
          r.documentCount,
          ...shownDocs.map((d) => per.get(d.id) ?? 0),
        ];
      }),
    ]);
  }

  const header = (key: SortKey, label: string, className?: string) => (
    <th
      className={cn("cursor-default select-none px-3 py-1.5 font-medium hover:text-fg", className)}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "code" }))}
      data-testid={`sort-${key}`}
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

  return (
    <div className="flex h-full flex-col" data-testid="analysis-frequencies">
      <AnalysisToolbar>
        <DocumentFilter
          documentIds={documentIds}
          onChange={setDocumentIds}
          documentSetIds={documentSetIds}
          onSetIdsChange={setDocumentSetIds}
        />
        <span className="text-xs text-fg-muted">
          {rows.length} code{rows.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto" />
        <ExportCsvButton name="code-frequencies" build={csv} disabled={!rows.length} />
      </AnalysisToolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        {!rows.length ? (
          <EmptyNote>
            {isPending ? "Counting…" : "No codes yet. Build a codebook and code some text first."}
          </EmptyNote>
        ) : (
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-panel text-left text-xs text-fg-muted shadow-[0_1px_0_var(--border)]">
              <tr>
                {header("code", "Code")}
                {header("own", "Own", "w-24 text-right")}
                {header("withDescendants", "With sub-codes", "w-32 text-right")}
                {header("documentCount", "Documents", "w-28 text-right")}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.codeId}
                  className="cursor-default border-b border-border hover:bg-muted"
                  onClick={() => openExcerpts({ codeIds: [r.codeId], includeDescendants: true })}
                  title={`Show excerpts coded ${r.path} (with sub-codes)`}
                  data-testid="frequency-row"
                >
                  <td className="px-3 py-1.5">
                    <span
                      className="flex items-center gap-2"
                      style={{ paddingLeft: sort.key === "code" ? r.depth * 14 : 0 }}
                    >
                      <ColorDot color={r.color} />
                      <span className="truncate">{sort.key === "code" ? r.name : r.path}</span>
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.own}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.withDescendants}
                    {r.withDescendants !== r.own ? (
                      <span className="ml-1 text-xs text-fg-muted">
                        (+{r.withDescendants - r.own})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.documentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
