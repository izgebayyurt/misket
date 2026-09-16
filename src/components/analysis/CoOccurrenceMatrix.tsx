import { useMemo, useState } from "react";
import { flattenTree, pathOf } from "@/core/codeTree";
import { matrixCsv } from "@/core/csv";
import { useCoOccurrence } from "@/queries/analysis";
import { useCodeTree } from "@/queries/codes";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { useWorkspace } from "@/state/workspace";
import { AnalysisToolbar, DocumentFilter, EmptyNote, ExportCsvButton } from "./shared";
import { shade } from "./shade";

export function CoOccurrenceMatrix() {
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [documentSetIds, setDocumentSetIds] = useState<string[]>([]);
  const [onlyUsed, setOnlyUsed] = useState(true);
  const { data, isPending } = useCoOccurrence(documentIds, documentSetIds);
  const tree = useCodeTree();
  const openExcerpts = useWorkspace((s) => s.openExcerpts);

  const { codes, at, max } = useMemo(() => {
    const cells = new Map<string, number>();
    for (const [row, col, n] of data?.cells ?? []) cells.set(`${row}|${col}`, n);
    const at = (row: string, col: string) => cells.get(`${row}|${col}`) ?? 0;
    const present = new Set(data?.codeIds ?? []);
    let codes = flattenTree(tree)
      .map((n) => n.code)
      .filter((c) => present.has(c.id));
    if (onlyUsed) codes = codes.filter((c) => at(c.id, c.id) > 0);
    // Shade against the busiest pair, not the diagonal, which is much larger.
    let max = 0;
    for (const a of codes)
      for (const b of codes) if (a.id !== b.id) max = Math.max(max, at(a.id, b.id));
    return { codes, at, max };
  }, [data, tree, onlyUsed]);

  const csv = () =>
    matrixCsv(
      "Code",
      codes.map((c) => pathOf(tree, c.id)),
      codes.map((row) => ({
        label: pathOf(tree, row.id),
        values: codes.map((col) => at(row.id, col.id)),
      })),
    );

  if (!codes.length) {
    return (
      <div className="flex h-full flex-col" data-testid="analysis-cooccurrence">
        <Toolbar
          documentIds={documentIds}
          setDocumentIds={setDocumentIds}
          documentSetIds={documentSetIds}
          setDocumentSetIds={setDocumentSetIds}
          onlyUsed={onlyUsed}
          setOnlyUsed={setOnlyUsed}
          csv={csv}
          count={0}
        />
        <EmptyNote>
          {isPending
            ? "Counting…"
            : "Nothing to compare yet: code some overlapping passages first."}
        </EmptyNote>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="analysis-cooccurrence">
      <Toolbar
        documentIds={documentIds}
        setDocumentIds={setDocumentIds}
        documentSetIds={documentSetIds}
        setDocumentSetIds={setDocumentSetIds}
        onlyUsed={onlyUsed}
        setOnlyUsed={setOnlyUsed}
        csv={csv}
        count={codes.length}
      />
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-bg" />
              {codes.map((c) => (
                <th
                  key={c.id}
                  className="sticky top-0 z-20 h-28 w-8 min-w-8 bg-bg align-bottom p-0"
                  title={pathOf(tree, c.id)}
                  scope="col"
                >
                  <div className="flex h-28 flex-col items-center justify-end gap-1 pb-1">
                    <span
                      className="max-h-24 overflow-hidden whitespace-nowrap font-normal text-fg-muted"
                      style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                    >
                      {c.name}
                    </span>
                    <ColorDot color={c.color} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {codes.map((row) => (
              <tr key={row.id}>
                <th
                  className="sticky left-0 z-10 max-w-48 truncate border-b border-border bg-bg py-0 pr-2 text-left font-normal"
                  scope="row"
                  title={pathOf(tree, row.id)}
                >
                  <span className="flex items-center gap-1.5">
                    <ColorDot color={row.color} />
                    <span className="max-w-40 truncate">{row.name}</span>
                  </span>
                </th>
                {codes.map((col) => {
                  const n = at(row.id, col.id);
                  const diagonal = row.id === col.id;
                  return (
                    <td
                      key={col.id}
                      className={
                        "h-7 w-8 cursor-default border border-border/60 text-center tabular-nums " +
                        (diagonal
                          ? "bg-muted font-medium"
                          : n
                            ? "hover:outline hover:outline-accent"
                            : "")
                      }
                      style={diagonal ? undefined : shade(n, max)}
                      title={
                        diagonal
                          ? `${pathOf(tree, row.id)}: ${n} excerpt${n === 1 ? "" : "s"}`
                          : `${pathOf(tree, row.id)} × ${pathOf(tree, col.id)}: ${n} overlapping excerpt pair${n === 1 ? "" : "s"}`
                      }
                      onClick={() =>
                        n &&
                        openExcerpts({
                          codeIds: diagonal ? [row.id] : [row.id, col.id],
                          includeDescendants: false,
                          requireAllCodes: !diagonal,
                        })
                      }
                      data-testid={n ? "cooccurrence-cell" : undefined}
                    >
                      {n || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 max-w-prose text-xs text-fg-muted">
          Each cell counts pairs of overlapping excerpts in the same document carrying the two
          codes; an excerpt carrying both counts once. The diagonal is the code&rsquo;s own excerpt
          count. Click a cell to see those excerpts.
        </p>
      </div>
    </div>
  );
}

function Toolbar({
  documentIds,
  setDocumentIds,
  documentSetIds,
  setDocumentSetIds,
  onlyUsed,
  setOnlyUsed,
  csv,
  count,
}: {
  documentIds: string[];
  setDocumentIds: (ids: string[]) => void;
  documentSetIds: string[];
  setDocumentSetIds: (ids: string[]) => void;
  onlyUsed: boolean;
  setOnlyUsed: (v: boolean) => void;
  csv: () => string;
  count: number;
}) {
  return (
    <AnalysisToolbar>
      <DocumentFilter
        documentIds={documentIds}
        onChange={setDocumentIds}
        documentSetIds={documentSetIds}
        onSetIdsChange={setDocumentSetIds}
      />
      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={onlyUsed}
          onChange={(e) => setOnlyUsed(e.target.checked)}
          data-testid="only-used-codes"
        />
        Only codes in use
      </label>
      <span className="text-xs text-fg-muted">
        {count} code{count === 1 ? "" : "s"}
      </span>
      <span className="ml-auto" />
      <ExportCsvButton name="co-occurrence" build={csv} disabled={!count} />
    </AnalysisToolbar>
  );
}
