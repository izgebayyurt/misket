import { useMemo, useState } from "react";
import { flattenTree, pathOf } from "@/core/codeTree";
import { matrixCsv } from "@/core/csv";
import { useCodeByDescriptor } from "@/queries/analysis";
import { useCodeTree } from "@/queries/codes";
import { useDescriptorFields } from "@/queries/descriptors";
import { useProjectSpeakers } from "@/queries/transcripts";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { FilterPicker } from "@/components/ui/filter-picker";
import { useWorkspace } from "@/state/workspace";
import type { CrosstabMode, CrosstabRequest } from "@/api/types";
import { AnalysisToolbar, DocumentFilter, EmptyNote, ExportCsvButton } from "./shared";
import { shade } from "./shade";

/**
 * Codes against the values of one descriptor field — "how often does each
 * theme come up at each site, in each interview wave, in each age band".
 *
 * The columns come from Rust (one per value in scope, bins for a number
 * field, year-months for a date field, `(no value)` last) together with the
 * descriptor condition that reproduces each one, so a cell can open the
 * excerpt browser on exactly the excerpts it counted.
 */
/**
 * The virtual field standing for "who was speaking". It is not a descriptor —
 * Rust special-cases the id in `code_by_descriptor` — but it belongs in the
 * same picker, because it is one more thing to cross-tabulate codes against.
 */
const SPEAKER_FIELD_ID = "speaker";

export function CodeByDescriptorMatrix() {
  const { data: descriptorFields } = useDescriptorFields();
  const { data: projectSpeakers } = useProjectSpeakers();
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [codeIds, setCodeIds] = useState<string[]>([]);
  const [includeSub, setIncludeSub] = useState(true);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [documentSetIds, setDocumentSetIds] = useState<string[]>([]);
  const [mode, setMode] = useState<CrosstabMode>("excerpts");
  const [bins, setBins] = useState(4);
  const tree = useCodeTree();
  const openExcerpts = useWorkspace((s) => s.openExcerpts);

  // "Speaker" joins the descriptors in the picker whenever the project has
  // any transcripts at all.
  const fields = useMemo(() => {
    const list = [...(descriptorFields ?? [])];
    if (projectSpeakers?.length) {
      list.push({
        id: SPEAKER_FIELD_ID,
        name: "Speaker",
        kind: "text",
        options: projectSpeakers,
        sortOrder: -1,
        valueCount: projectSpeakers.length,
        createdAt: "",
        updatedAt: "",
      });
    }
    return list;
  }, [descriptorFields, projectSpeakers]);

  // The first field is the useful default: picking one is a second click
  // nobody wants when the project has only one descriptor.
  const field = fields.find((f) => f.id === fieldId) ?? fields[0];
  const isNumber = field?.kind === "number";
  const bySpeaker = field?.id === SPEAKER_FIELD_ID;

  const request = useMemo<CrosstabRequest | null>(
    () =>
      field
        ? {
            fieldId: field.id,
            codeIds: codeIds.length ? codeIds : null,
            includeDescendants: includeSub,
            documentIds: documentIds.length ? documentIds : null,
            documentSetIds: documentSetIds.length ? documentSetIds : null,
            bins: isNumber ? bins : null,
            mode,
          }
        : null,
    [field, codeIds, includeSub, documentIds, documentSetIds, isNumber, bins, mode],
  );
  const { data, isPending } = useCodeByDescriptor(request);

  const codeName = useMemo(() => {
    const byId = new Map(flattenTree(tree).map((n) => [n.code.id, n.code]));
    return (id: string) => byId.get(id);
  }, [tree]);

  const { rows, columns, columnTotals, max } = useMemo(() => {
    const columns = data?.columns ?? [];
    // Rows with nothing in them are noise; the picker is how you get them back.
    const rows = (data?.rows ?? []).filter((r) => r.cells.some((n) => n > 0));
    const columnTotals = columns.map((_, i) => rows.reduce((sum, r) => sum + r.cells[i]!, 0));
    let max = 0;
    for (const r of rows) for (const n of r.cells) max = Math.max(max, n);
    return { rows, columns, columnTotals, max };
  }, [data]);

  const unit = data?.mode === "documents" ? "document" : "excerpt";

  const csv = () =>
    matrixCsv(
      data?.field.name ?? "Descriptor",
      [...columns.map((c) => c.label), "Total"],
      rows.map((r) => ({
        label: pathOf(tree, r.codeId),
        values: [...r.cells, r.cells.reduce((a, b) => a + b, 0)],
      })),
    );

  const toolbar = (
    <AnalysisToolbar>
      <select
        className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
        value={field?.id ?? ""}
        onChange={(e) => setFieldId(e.target.value)}
        aria-label="Descriptor"
        data-testid="crosstab-field"
      >
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <FilterPicker
        label={
          codeIds.length ? `${codeIds.length} code${codeIds.length > 1 ? "s" : ""}` : "All codes"
        }
        active={codeIds.length > 0}
        onClear={() => setCodeIds([])}
        testId="crosstab-filter-codes"
      >
        {(query) => (
          <>
            <label className="mb-1 flex items-center gap-2 px-2 py-1 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={includeSub}
                onChange={(e) => setIncludeSub(e.target.checked)}
                data-testid="include-sub-codes"
              />
              Include sub-codes
            </label>
            {flattenTree(tree)
              .filter((n) => pathOf(tree, n.code.id).toLowerCase().includes(query.toLowerCase()))
              .map((n) => (
                <label
                  key={n.code.id}
                  className="flex cursor-default items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                  style={{ paddingLeft: 8 + n.depth * 12 }}
                >
                  <input
                    type="checkbox"
                    checked={codeIds.includes(n.code.id)}
                    onChange={() =>
                      setCodeIds(
                        codeIds.includes(n.code.id)
                          ? codeIds.filter((x) => x !== n.code.id)
                          : [...codeIds, n.code.id],
                      )
                    }
                  />
                  <ColorDot color={n.code.color} />
                  <span className="truncate">{n.code.name}</span>
                </label>
              ))}
          </>
        )}
      </FilterPicker>
      <DocumentFilter
        documentIds={documentIds}
        onChange={setDocumentIds}
        documentSetIds={documentSetIds}
        onSetIdsChange={setDocumentSetIds}
      />
      <select
        className="rounded-md border border-border bg-bg px-2 py-1 text-xs"
        value={mode}
        onChange={(e) => setMode(e.target.value as CrosstabMode)}
        aria-label="Count"
        data-testid="crosstab-mode"
      >
        <option value="excerpts">Count excerpts</option>
        <option value="documents">Count documents</option>
      </select>
      {isNumber ? (
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          Bins
          <input
            type="number"
            min={1}
            max={20}
            value={bins}
            onChange={(e) => setBins(Math.min(20, Math.max(1, Number(e.target.value) || 4)))}
            className="w-14 rounded-md border border-border bg-bg px-1.5 py-1 text-xs"
            data-testid="crosstab-bins"
          />
        </label>
      ) : null}
      <span className="ml-auto" />
      <ExportCsvButton
        name="code-by-descriptor"
        build={csv}
        disabled={!rows.length || !columns.length}
      />
    </AnalysisToolbar>
  );

  if (!fields.length) {
    return (
      <div className="flex h-full flex-col" data-testid="analysis-crosstab">
        <EmptyNote>
          Nothing to compare codes across yet. Define a document attribute — a site, an interview
          wave, an age group — and set it on a few documents, or import a transcript and compare
          codes across its speakers.
        </EmptyNote>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="analysis-crosstab">
      {toolbar}
      {!rows.length || !columns.length ? (
        <EmptyNote>
          {isPending
            ? "Counting…"
            : bySpeaker
              ? "Nothing to cross-tabulate yet: code some passages in a transcript."
              : `Nothing to cross-tabulate yet: give some documents a value for “${field?.name}” and code them.`}
        </EmptyNote>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <table className="border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 bg-bg py-1 pr-2 text-left font-normal text-fg-muted">
                  {data?.field.name}
                </th>
                {columns.map((c, i) => (
                  <th
                    key={c.label}
                    className="sticky top-0 z-20 min-w-16 bg-bg px-2 py-1 text-center align-bottom font-normal"
                    scope="col"
                    title={`${data?.documentsPerColumn[i] ?? 0} document${
                      data?.documentsPerColumn[i] === 1 ? "" : "s"
                    }`}
                  >
                    <span className="block max-w-32 truncate">{c.label}</span>
                    <span className="block text-fg-muted">
                      n={data?.documentsPerColumn[i] ?? 0}
                    </span>
                  </th>
                ))}
                <th
                  className="sticky top-0 z-20 min-w-16 bg-bg px-2 py-1 text-center align-bottom font-medium"
                  scope="col"
                >
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const code = codeName(r.codeId);
                const total = r.cells.reduce((a, b) => a + b, 0);
                return (
                  <tr key={r.codeId}>
                    <th
                      className="sticky left-0 z-10 border-b border-border bg-bg py-0 pr-2 text-left font-normal"
                      scope="row"
                      title={pathOf(tree, r.codeId)}
                    >
                      <span className="flex items-center gap-1.5">
                        <ColorDot color={code?.color ?? "#888888"} />
                        <span className="max-w-48 truncate">{code?.name ?? r.codeId}</span>
                      </span>
                    </th>
                    {r.cells.map((n, i) => {
                      const column = columns[i]!;
                      return (
                        <td
                          key={column.label}
                          className={
                            "h-7 cursor-default border border-border/60 px-2 text-center tabular-nums " +
                            (n ? "hover:outline hover:outline-accent" : "")
                          }
                          style={shade(n, max)}
                          title={`${pathOf(tree, r.codeId)} × ${column.label}: ${n} ${unit}${
                            n === 1 ? "" : "s"
                          }`}
                          onClick={() => {
                            // The "(no speaker)" column has no filter that
                            // reproduces it, so it carries no values and does
                            // not open the browser.
                            if (!n || (bySpeaker && column.values.length === 0)) return;
                            openExcerpts({
                              codeIds: [r.codeId],
                              includeDescendants: includeSub,
                              documentIds: documentIds.length ? documentIds : null,
                              documentSetIds: documentSetIds.length ? documentSetIds : null,
                              ...(bySpeaker
                                ? { speakers: column.values }
                                : {
                                    descriptors: [
                                      {
                                        fieldId: field!.id,
                                        op: column.op,
                                        values: column.values,
                                      },
                                    ],
                                  }),
                            });
                          }}
                          data-testid={n ? "crosstab-cell" : undefined}
                        >
                          {n || ""}
                        </td>
                      );
                    })}
                    <td className="h-7 border border-border/60 bg-muted px-2 text-center font-medium tabular-nums">
                      {total}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <th
                  className="sticky left-0 z-10 bg-bg py-0 pr-2 text-left font-medium"
                  scope="row"
                >
                  Total
                </th>
                {columnTotals.map((n, i) => (
                  <td
                    key={columns[i]!.label}
                    className="h-7 border border-border/60 bg-muted px-2 text-center font-medium tabular-nums"
                  >
                    {n}
                  </td>
                ))}
                <td className="h-7 border border-border/60 bg-muted px-2 text-center font-medium tabular-nums">
                  {columnTotals.reduce((a, b) => a + b, 0)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 max-w-prose text-xs text-fg-muted">
            {data?.mode === "documents"
              ? "Each cell counts the documents with that value that carry the code at least once"
              : "Each cell counts the excerpts carrying the code in documents with that value"}
            {includeSub ? ", sub-codes included" : ""}. <em>n</em> is how many documents fall in the
            column.{" "}
            {bySpeaker
              ? "An excerpt belongs to the turn it starts in, so one transcript feeds several columns and n is the documents that speaker appears in."
              : "A document belongs to exactly one column, so a row adds up to its total;"}{" "}
            a column total counts an excerpt once per code it carries. Click a cell to browse those
            excerpts.
          </p>
        </div>
      )}
    </div>
  );
}
