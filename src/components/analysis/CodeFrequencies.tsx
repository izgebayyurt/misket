import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CodeFrequency } from "@/api/types";
import { flattenTree, pathOf } from "@/core/codeTree";
import { toCsv } from "@/core/csv";
import { sparklineAreaPath, sparklineLinePath, zeroFillDays } from "@/core/sparkline";
import { useCodeFrequencies, useCodeTimeline } from "@/queries/analysis";
import { useCodeTree } from "@/queries/codes";
import { useDocuments } from "@/queries/documents";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { CoderFilter } from "@/components/coders/CoderMark";
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
  const { t } = useTranslation();
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [documentSetIds, setDocumentSetIds] = useState<string[]>([]);
  const [coderIds, setCoderIds] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "code", desc: false });
  const { data, isPending } = useCodeFrequencies(documentIds, documentSetIds, coderIds);
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
        <CoderFilter coderIds={coderIds} onChange={setCoderIds} />
        <span className="text-xs text-fg-muted">
          {t("analysis.frequencies.codeCount", { count: rows.length })}
        </span>
        <span className="ml-auto" />
        <ExportCsvButton name="code-frequencies" build={csv} disabled={!rows.length} />
      </AnalysisToolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        {!rows.length ? (
          <EmptyNote>
            {isPending ? t("analysis.counting") : t("analysis.frequencies.empty")}
          </EmptyNote>
        ) : (
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-panel text-left text-xs text-fg-muted shadow-[0_1px_0_var(--border)]">
              <tr>
                {header("code", t("analysis.frequencies.colCode"))}
                {header("own", t("analysis.frequencies.colOwn"), "w-24 text-right")}
                {header(
                  "withDescendants",
                  t("analysis.frequencies.colWithSubcodes"),
                  "w-32 text-right",
                )}
                {header("documentCount", t("analysis.frequencies.colDocuments"), "w-28 text-right")}
                <th className="w-28 px-3 py-1.5 text-right font-medium" scope="col">
                  {t("analysis.frequencies.colLast30Days")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.codeId}
                  className="cursor-default border-b border-border hover:bg-muted"
                  onClick={() => openExcerpts({ codeIds: [r.codeId], includeDescendants: true })}
                  title={t("analysis.frequencies.showExcerptsCoded", { path: r.path })}
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
                  <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <CodeTimelineCell codeId={r.codeId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const MINI_SPARK_WIDTH = 90;
const MINI_SPARK_HEIGHT = 22;

/** A tiny, label-free 30-day coding-activity sparkline for one code (with
 * its sub-codes), for the frequencies table's rightmost column. */
function CodeTimelineCell({ codeId }: { codeId: string }) {
  const { t } = useTranslation();
  const { data } = useCodeTimeline(codeId, true, "day");
  const values = useMemo(() => zeroFillDays(data ?? [], 30).map(([, c]) => c), [data]);
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return <span className="block text-right text-xs text-fg-muted">–</span>;
  }
  const options = { width: MINI_SPARK_WIDTH, height: MINI_SPARK_HEIGHT };
  return (
    <svg
      viewBox={`0 0 ${MINI_SPARK_WIDTH} ${MINI_SPARK_HEIGHT}`}
      className="ml-auto block h-5 w-[90px]"
      preserveAspectRatio="none"
      role="img"
      aria-label={t("analysis.frequencies.codedLast30Days", { count: total })}
      data-testid="code-timeline-sparkline"
    >
      <path d={sparklineAreaPath(values, options)} fill="var(--color-accent)" opacity="0.15" />
      <path
        d={sparklineLinePath(values, options)}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
      />
    </svg>
  );
}
