import { useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronUp, Download, Minus, Plus } from "lucide-react";
import type { IrrDisagreement, IrrReport, IrrRequest, IrrUnit } from "@/api/types";
import { irrExportCsv } from "@/api/irr";
import { describeScope, formatKappa, formatPercent, kappaBand, kappaShade } from "@/core/irr";
import { useIrrReport } from "@/queries/irr";
import { useCoders } from "@/queries/coders";
import { useProjectInfo } from "@/queries/project";
import { useAddExcerptCodes, useApplyCodes, useRemoveExcerptCode } from "@/queries/excerpts";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";
import { AnalysisToolbar, CodeFilter, DocumentFilter, EmptyNote } from "./shared";

type SortKey = "code" | "units" | "both" | "aOnly" | "bOnly" | "percentAgreement" | "kappa";

const UNITS: { id: IrrUnit; label: string }[] = [
  { id: "paragraph", label: "Paragraph" },
  { id: "turn", label: "Speaker turn" },
  { id: "excerpt", label: "Excerpt" },
];

/**
 * Two coders side by side: Cohen's kappa and percent agreement per code over
 * an explicit unit of analysis, and every disagreement as something you can
 * open, adopt or take back.
 *
 * The figures come from `db::irr`, which also documents what "present" means
 * for each unit; this view only picks the scope and lays the answer out.
 */
export function ReliabilityView() {
  const { data: coders } = useCoders();
  const me = coders?.find((c) => c.isLocal);
  // Me against whoever else has done the most coding: the comparison you
  // almost always want, without a single click.
  const other = coders?.filter((c) => !c.isLocal).sort((a, b) => b.codingCount - a.codingCount)[0];
  const [coderA, setCoderA] = useState<string | null>(null);
  const [coderB, setCoderB] = useState<string | null>(null);
  const [unit, setUnit] = useState<IrrUnit>("paragraph");
  const [threshold, setThreshold] = useState(0.5);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [documentSetIds, setDocumentSetIds] = useState<string[]>([]);
  const [codeIds, setCodeIds] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "code", desc: false });

  const a = coderA ?? me?.id ?? null;
  const b = coderB ?? (other?.id !== a ? (other?.id ?? null) : null);

  const request = useMemo<IrrRequest | null>(
    () =>
      a && b && a !== b
        ? {
            coderA: a,
            coderB: b,
            unit,
            overlapThreshold: threshold,
            documentIds: documentIds.length ? documentIds : null,
            documentSetIds: documentSetIds.length ? documentSetIds : null,
            codeIds: codeIds.length ? codeIds : null,
          }
        : null,
    [a, b, unit, threshold, documentIds, documentSetIds, codeIds],
  );
  const { data, isPending, error } = useIrrReport(request);

  const rows = useMemo(() => {
    const out = [...(data?.codes ?? [])];
    out.sort((x, y) => {
      if (sort.key === "code") return x.codePath.localeCompare(y.codePath);
      const by =
        sort.key === "kappa"
          ? (x.kappa ?? Number.NEGATIVE_INFINITY) - (y.kappa ?? Number.NEGATIVE_INFINITY)
          : x[sort.key] - y[sort.key];
      return by || x.codePath.localeCompare(y.codePath);
    });
    return sort.desc ? out.reverse() : out;
  }, [data, sort]);

  if (coders && coders.length < 2) return <OneCoderEmptyState />;

  const header = (key: SortKey, label: string, className?: string) => (
    <th
      className={cn("cursor-default select-none px-3 py-1.5 font-medium hover:text-fg", className)}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "code" }))}
      data-testid={`irr-sort-${key}`}
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

  const coderSelect = (
    value: string | null,
    onChange: (id: string) => void,
    label: string,
    testId: string,
  ) => (
    <label className="flex items-center gap-1.5 text-xs text-fg-muted">
      {label}
      <select
        className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      >
        {(coders ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.isLocal ? " (you)" : ""}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="flex h-full flex-col" data-testid="reliability-view">
      <AnalysisToolbar>
        {coderSelect(a, setCoderA, "A", "irr-coder-a")}
        {coderSelect(b, setCoderB, "B", "irr-coder-b")}
        <select
          className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
          value={unit}
          onChange={(e) => setUnit(e.target.value as IrrUnit)}
          aria-label="Unit of analysis"
          data-testid="irr-unit"
        >
          {UNITS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
        {unit === "excerpt" ? null : (
          <label
            className="flex items-center gap-1.5 text-xs text-fg-muted"
            title="How much of a unit an excerpt must cover — or how much of the excerpt the unit must cover — for its code to count as present there."
          >
            Overlap
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={Math.round(threshold * 100)}
              onChange={(e) => setThreshold(Number(e.target.value) / 100)}
              className="w-24 accent-[var(--accent)]"
              data-testid="irr-threshold"
            />
            <span className="w-8 tabular-nums">{Math.round(threshold * 100)}%</span>
          </label>
        )}
        <DocumentFilter
          documentIds={documentIds}
          onChange={setDocumentIds}
          documentSetIds={documentSetIds}
          onSetIdsChange={setDocumentSetIds}
        />
        <CodeFilter codeIds={codeIds} onChange={setCodeIds} />
        <span className="ml-auto" />
        <ExportButton request={request} disabled={!data?.codes.length} />
      </AnalysisToolbar>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <EmptyNote>{error instanceof Error ? error.message : String(error)}</EmptyNote>
        ) : !data ? (
          <EmptyNote>{isPending ? "Comparing…" : "Pick two coders to compare."}</EmptyNote>
        ) : data.units === 0 ? (
          <EmptyNote>
            {data.coderAName} and {data.coderBName} have no document in common yet. Pick documents
            explicitly above to compare them anyway.
          </EmptyNote>
        ) : (
          <>
            <SummaryStrip
              pooledKappa={data.pooledKappa}
              meanKappa={data.meanKappa}
              percentAgreement={data.percentAgreement}
              scope={describeScope({
                unit: data.unit,
                units: data.units,
                documents: data.documents.length,
                codes: data.codes.length,
              })}
              note={
                data.unit === "excerpt"
                  ? "Excerpt units: ranges must match exactly."
                  : `A code counts as present when an excerpt covers ${Math.round(
                      data.overlapThreshold * 100,
                    )}% of the unit, or the unit covers ${Math.round(
                      data.overlapThreshold * 100,
                    )}% of the excerpt.`
              }
            />

            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-panel text-left text-xs text-fg-muted shadow-[0_1px_0_var(--border)]">
                <tr>
                  {header("code", "Code")}
                  {header("units", "Units", "w-20 text-right")}
                  {header("both", "Both", "w-20 text-right")}
                  {header("aOnly", `Only ${data.coderAName}`, "w-28 text-right")}
                  {header("bOnly", `Only ${data.coderBName}`, "w-28 text-right")}
                  {header("percentAgreement", "Agreement", "w-28 text-right")}
                  {header("kappa", "κ", "w-20 text-right")}
                  <th className="w-32 px-3 py-1.5 font-medium" scope="col">
                    Interpretation
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.codeId}
                    className="border-b border-border hover:bg-muted"
                    data-testid="irr-code-row"
                  >
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <ColorDot color={r.color} />
                        <span className="truncate">{r.codePath}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.units}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.both}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.aOnly}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.bOnly}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {formatPercent(r.percentAgreement)}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right tabular-nums"
                      style={kappaShade(r.kappa)}
                      title={
                        r.kappa === null
                          ? "Undefined: neither coder applied it, or both applied it everywhere."
                          : undefined
                      }
                    >
                      {formatKappa(r.kappa)}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-fg-muted">
                      {r.kappa === null ? "Undefined" : kappaBand(r.kappa).label}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Disagreements report={data} />
          </>
        )}
      </div>
    </div>
  );
}

function SummaryStrip({
  pooledKappa,
  meanKappa,
  percentAgreement,
  scope,
  note,
}: {
  pooledKappa: number | null;
  meanKappa: number | null;
  percentAgreement: number;
  scope: string;
  note: string;
}) {
  const figure = (label: string, value: string, sub?: string, testId?: string) => (
    <div className="min-w-32" data-testid={testId}>
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="font-serif text-2xl tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-fg-muted">{sub}</div> : null}
    </div>
  );
  return (
    <div className="border-b border-border bg-panel px-4 py-3">
      <div className="flex flex-wrap items-end gap-8">
        {figure(
          "Pooled κ",
          formatKappa(pooledKappa),
          pooledKappa === null ? "Undefined" : kappaBand(pooledKappa).label,
          "irr-pooled-kappa",
        )}
        {figure("Mean κ per code", formatKappa(meanKappa), "unweighted")}
        {figure("Agreement", formatPercent(percentAgreement), "over every decision")}
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        {scope}. {note}
      </p>
    </div>
  );
}

/**
 * Every unit one coder coded and the other did not, grouped by document.
 * Clicking one opens the document there; the row actions are ordinary
 * undoable codings.
 */
function Disagreements({ report }: { report: IrrReport }) {
  const openDocument = useWorkspace((s) => s.openDocument);
  const applyCodes = useApplyCodes();
  const addCodes = useAddExcerptCodes();
  const removeCode = useRemoveExcerptCode();
  const me = useCoders().data?.find((c) => c.isLocal);

  const groups = useMemo(() => {
    const byDoc = new Map<string, IrrDisagreement[]>();
    for (const d of report.disagreements) {
      const list = byDoc.get(d.documentId);
      if (list) list.push(d);
      else byDoc.set(d.documentId, [d]);
    }
    return [...byDoc.entries()];
  }, [report.disagreements]);

  function jump(d: IrrDisagreement) {
    if (d.unitExcerptId) openDocument(d.documentId, d.unitExcerptId);
    else if (d.excerptIds[0]) openDocument(d.documentId, d.excerptIds[0]);
    else openDocument(d.documentId, undefined, d.start);
  }

  /** Apply the code as the local coder. An image unit already is an excerpt,
   * so it gets the code added; a text unit is a range, which `applyCodes`
   * reuses or creates. Both are ordinary undoable codings. */
  async function adopt(d: IrrDisagreement) {
    try {
      if (d.kind === "image_region") {
        if (!d.unitExcerptId) return;
        await addCodes.mutateAsync({
          id: d.unitExcerptId,
          documentId: d.documentId,
          codeIds: [d.codeId],
        });
      } else {
        await applyCodes.mutateAsync({
          documentId: d.documentId,
          startPos: d.start,
          endPos: d.end,
          codeIds: [d.codeId],
        });
      }
      toast.info(`Added ${d.codeName} to your coding`);
    } catch (e) {
      toast.error(e);
    }
  }

  async function removeMine(d: IrrDisagreement) {
    try {
      for (const id of d.excerptIds) {
        await removeCode.mutateAsync({
          id,
          documentId: d.documentId,
          codeId: d.codeId,
          coderId: d.coderId,
        });
      }
      toast.info(`Removed your ${d.codeName}`);
    } catch (e) {
      toast.error(e);
    }
  }

  if (!report.disagreements.length) {
    return (
      <p className="p-6 text-sm text-fg-muted" data-testid="irr-no-disagreements">
        No disagreements: every unit is coded the same way by both of them.
      </p>
    );
  }

  return (
    <section className="border-t border-border" data-testid="irr-disagreements">
      <h3 className="px-4 pb-1 pt-4 font-serif text-base">
        {report.disagreementCount} disagreement{report.disagreementCount === 1 ? "" : "s"}
        {report.disagreements.length < report.disagreementCount ? (
          <span className="ml-2 text-xs font-normal text-fg-muted">
            showing the first {report.disagreements.length}
          </span>
        ) : null}
      </h3>
      {groups.map(([documentId, items]) => (
        <div key={documentId}>
          <div className="sticky top-0 z-10 bg-panel px-4 py-1 text-xs font-medium text-fg-muted">
            {items[0]!.documentName}
          </div>
          <ul>
            {items.map((d) => {
              const mine = !!me && d.coderId === me.id;
              const whose = d.who === "a" ? report.coderAName : report.coderBName;
              return (
                <li
                  key={`${d.documentId}-${d.unitIndex}-${d.codeId}-${d.who}`}
                  className="flex items-start gap-3 border-b border-border px-4 py-2 text-sm hover:bg-muted"
                  data-testid="irr-disagreement"
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => jump(d)}
                    title="Open the document here"
                    data-testid="irr-jump"
                  >
                    <span className="mr-2 inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-xs">
                      <ColorDot color={d.color} />
                      {d.codeName}
                    </span>
                    <span className="text-xs text-fg-muted">Only {whose}</span>
                    <span className="mt-0.5 block truncate text-fg-muted">
                      {d.snippet || "(image region)"}
                    </span>
                  </button>
                  {mine ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void removeMine(d)}
                      title={`Take ${d.codeName} off this passage`}
                      data-testid="irr-remove-mine"
                    >
                      <Minus /> Remove mine
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void adopt(d)}
                      title={`Apply ${d.codeName} here as well`}
                      data-testid="irr-adopt"
                    >
                      <Plus /> Adopt
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function ExportButton({ request, disabled }: { request: IrrRequest | null; disabled?: boolean }) {
  const { data: project } = useProjectInfo();
  async function run() {
    if (!request) return;
    try {
      const stem = (project?.name ?? "misket").replace(/[^\w.-]+/g, "_") || "misket";
      const path = await save({
        defaultPath: `${stem}-reliability.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      await irrExportCsv(request, path);
      toast.info(`Exported to ${path.split(/[\\/]/).pop()}`);
    } catch (e) {
      toast.error(e);
    }
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={run}
      disabled={disabled || !request}
      data-testid="irr-export-csv"
    >
      <Download /> CSV
    </Button>
  );
}

function OneCoderEmptyState() {
  return (
    <div
      className="flex h-full flex-col items-center justify-center px-8 text-center"
      data-testid="reliability-empty"
    >
      <p className="font-serif text-2xl">Only one coder so far</p>
      <p className="mt-2 max-w-md text-sm text-fg-muted">
        Inter-rater reliability needs two people&apos;s codings of the same material. A second coder
        appears once you pull their copy of this project in with{" "}
        <span className="font-medium text-fg">File → Pull from another copy…</span> — every coding
        carries the id of the install that made it, so Misket can tell your work from theirs.
      </p>
    </div>
  );
}
