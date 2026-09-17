import { useMemo, useState } from "react";
import { flattenTree } from "@/core/codeTree";
import { formatWeight, formatWeightWithLabel, weightScaleValues } from "@/core/weights";
import { useWeightSummary } from "@/queries/analysis";
import { useCodeTree } from "@/queries/codes";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { CoderFilter } from "@/components/coders/CoderMark";
import { useWorkspace } from "@/state/workspace";
import type { ExcerptFilter } from "@/api/types";
import { AnalysisToolbar, DocumentFilter, EmptyNote } from "./shared";

/**
 * Per weighted code: a histogram of every rated value and its summary
 * statistics (mean, median, min, max), over whatever documents/coders are
 * picked — the mixed-methods complement to the plain frequency table.
 */
export function WeightsView() {
  const tree = useCodeTree();
  const openExcerpts = useWorkspace((s) => s.openExcerpts);
  const weightedCodes = useMemo(() => flattenTree(tree).filter((n) => n.code.weightScale), [tree]);
  const [codeId, setCodeId] = useState<string | null>(null);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [documentSetIds, setDocumentSetIds] = useState<string[]>([]);
  const [coderIds, setCoderIds] = useState<string[]>([]);

  const node = codeId ? weightedCodes.find((n) => n.code.id === codeId) : weightedCodes[0];
  const code = node?.code;
  const scale = code?.weightScale ?? null;

  // `weightSummary` scopes and pages through matches on the Rust side; the
  // `limit`/`offset` here are unused but keep `ExcerptFilter` fully typed.
  const filter = useMemo<ExcerptFilter>(
    () => ({
      documentIds: documentIds.length ? documentIds : null,
      documentSetIds: documentSetIds.length ? documentSetIds : null,
      coderIds: coderIds.length ? coderIds : null,
    }),
    [documentIds, documentSetIds, coderIds],
  );
  const { data: summary, isPending } = useWeightSummary(code?.id ?? null, filter);

  const values = scale ? weightScaleValues(scale) : [];
  const countOf = (v: number) =>
    summary?.histogram.find((b) => Math.abs(b.value - v) < 1e-9)?.count ?? 0;
  const maxCount = Math.max(1, ...values.map(countOf));

  const openForValue = (v: number) => {
    if (!code) return;
    openExcerpts({
      documentIds: documentIds.length ? documentIds : null,
      documentSetIds: documentSetIds.length ? documentSetIds : null,
      coderIds: coderIds.length ? coderIds : null,
      weightRange: { codeId: code.id, min: v, max: v },
    });
  };

  return (
    <div className="flex h-full flex-col" data-testid="analysis-weights">
      <AnalysisToolbar>
        <select
          className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
          value={code?.id ?? ""}
          onChange={(e) => setCodeId(e.target.value)}
          aria-label="Weighted code"
          data-testid="weights-code-picker"
        >
          {weightedCodes.map((n) => (
            <option key={n.code.id} value={n.code.id}>
              {n.code.name}
            </option>
          ))}
        </select>
        <DocumentFilter
          documentIds={documentIds}
          onChange={setDocumentIds}
          documentSetIds={documentSetIds}
          onSetIdsChange={setDocumentSetIds}
        />
        <CoderFilter coderIds={coderIds} onChange={setCoderIds} />
      </AnalysisToolbar>
      {!weightedCodes.length ? (
        <EmptyNote>
          No code has a weight scale yet. Open a code and turn on “Weight scale” to rate its
          applications on a numeric scale.
        </EmptyNote>
      ) : !summary || isPending ? (
        <EmptyNote>Counting…</EmptyNote>
      ) : summary.count === 0 ? (
        <EmptyNote>
          Nobody has rated a coding of “{code?.name}” yet — the inspector's weight control, or the
          1–9 keys with an excerpt focused, set one.
        </EmptyNote>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mb-4 flex items-center gap-2">
            <ColorDot color={code?.color ?? "#888"} />
            <h3 className="font-serif text-base font-medium">{code?.name}</h3>
          </div>
          <dl
            className="mb-5 grid max-w-md grid-cols-4 gap-3 text-center text-sm"
            data-testid="weight-stats"
          >
            {(
              [
                ["Rated", summary.count, null],
                ["Mean", summary.mean, scale],
                ["Median", summary.median, scale],
                ["Range", null, null],
              ] as const
            ).map(([label, value, s], i) => (
              <div key={label} className="rounded-md border border-border p-2">
                <dt className="text-[11px] uppercase tracking-wide text-fg-muted">{label}</dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {i === 3
                    ? summary.min != null && summary.max != null
                      ? `${formatWeight(summary.min)}–${formatWeight(summary.max)}`
                      : "–"
                    : value != null
                      ? s
                        ? formatWeightWithLabel(s, value)
                        : String(value)
                      : "–"}
                </dd>
              </div>
            ))}
          </dl>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Distribution
          </h4>
          <ul className="max-w-lg space-y-1.5" data-testid="weight-histogram">
            {values.map((v) => {
              const count = countOf(v);
              return (
                <li key={v} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 truncate text-right text-fg-muted">
                    {scale ? formatWeightWithLabel(scale, v) : v}
                  </span>
                  <button
                    type="button"
                    className="h-4 rounded bg-accent/70 hover:bg-accent disabled:cursor-default disabled:bg-muted"
                    style={{ width: `${Math.max(2, (count / maxCount) * 100)}%` }}
                    disabled={count === 0}
                    onClick={() => openForValue(v)}
                    title={`${count} coding${count === 1 ? "" : "s"} rated ${formatWeight(v)}`}
                    data-testid="weight-histogram-bar"
                  />
                  <span className="w-6 shrink-0 tabular-nums text-fg-muted">{count}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
