import { useMemo, useState } from "react";
import { flattenTree, pathOf } from "@/core/codeTree";
import { matrixCsv } from "@/core/csv";
import { useCodeByDocument, useCodeFrequencies } from "@/queries/analysis";
import { useCodeTree } from "@/queries/codes";
import { useDocuments } from "@/queries/documents";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { CoderFilter } from "@/components/coders/CoderMark";
import { useWorkspace } from "@/state/workspace";
import { AnalysisToolbar, EmptyNote, ExportCsvButton } from "./shared";
import { shade } from "./shade";

const NO_DOCUMENT_FILTER: string[] = [];

export function CodeByDocumentMatrix() {
  const [includeSub, setIncludeSub] = useState(false);
  const [onlyUsed, setOnlyUsed] = useState(true);
  const [coderIds, setCoderIds] = useState<string[]>([]);
  const direct = useCodeByDocument(coderIds);
  // Descendant-inclusive counts come from the frequency table, where they are
  // already de-duplicated per excerpt.
  const frequencies = useCodeFrequencies(NO_DOCUMENT_FILTER, NO_DOCUMENT_FILTER, coderIds);
  const { data: docs } = useDocuments();
  const tree = useCodeTree();
  const openExcerpts = useWorkspace((s) => s.openExcerpts);
  const isPending = includeSub ? frequencies.isPending : direct.isPending;

  const { documents, codes, at, max } = useMemo(() => {
    const cells = new Map<string, number>();
    if (includeSub) {
      for (const f of frequencies.data ?? [])
        for (const [documentId, n] of f.perDocument) cells.set(`${documentId}|${f.codeId}`, n);
    } else {
      for (const [documentId, codeId, n] of direct.data?.cells ?? [])
        cells.set(`${documentId}|${codeId}`, n);
    }
    const at = (documentId: string, codeId: string) => cells.get(`${documentId}|${codeId}`) ?? 0;
    const documents = docs ?? [];
    let codes = flattenTree(tree).map((n) => n.code);
    if (onlyUsed) codes = codes.filter((c) => documents.some((d) => at(d.id, c.id) > 0));
    let max = 0;
    for (const d of documents) for (const c of codes) max = Math.max(max, at(d.id, c.id));
    return { documents, codes, at, max };
  }, [direct.data, frequencies.data, docs, tree, includeSub, onlyUsed]);

  const csv = () =>
    matrixCsv(
      "Document",
      codes.map((c) => pathOf(tree, c.id)),
      documents.map((d) => ({ label: d.name, values: codes.map((c) => at(d.id, c.id)) })),
    );

  const toolbar = (
    <AnalysisToolbar>
      <CoderFilter coderIds={coderIds} onChange={setCoderIds} />
      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={includeSub}
          onChange={(e) => setIncludeSub(e.target.checked)}
          data-testid="include-sub-codes"
        />
        Include sub-codes
      </label>
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
        {documents.length} document{documents.length === 1 ? "" : "s"} · {codes.length} code
        {codes.length === 1 ? "" : "s"}
      </span>
      <span className="ml-auto" />
      <ExportCsvButton
        name="code-by-document"
        build={csv}
        disabled={!documents.length || !codes.length}
      />
    </AnalysisToolbar>
  );

  if (!documents.length || !codes.length) {
    return (
      <div className="flex h-full flex-col" data-testid="analysis-matrix">
        {toolbar}
        <EmptyNote>
          {isPending ? "Counting…" : "Import a document and code some passages to fill this grid."}
        </EmptyNote>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="analysis-matrix">
      {toolbar}
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
            {documents.map((d) => (
              <tr key={d.id}>
                <th
                  className="sticky left-0 z-10 border-b border-border bg-bg py-0 pr-2 text-left font-normal"
                  scope="row"
                  title={d.name}
                >
                  <span className="block max-w-48 truncate">{d.name}</span>
                </th>
                {codes.map((c) => {
                  const n = at(d.id, c.id);
                  return (
                    <td
                      key={c.id}
                      className={
                        "h-7 w-8 cursor-default border border-border/60 text-center tabular-nums " +
                        (n ? "hover:outline hover:outline-accent" : "")
                      }
                      style={shade(n, max)}
                      title={`${d.name} × ${pathOf(tree, c.id)}: ${n} excerpt${n === 1 ? "" : "s"}`}
                      onClick={() =>
                        n &&
                        openExcerpts({
                          codeIds: [c.id],
                          documentIds: [d.id],
                          includeDescendants: includeSub,
                        })
                      }
                      data-testid={n ? "matrix-cell" : undefined}
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
          Excerpts per document and code{includeSub ? ", sub-codes included" : ""}. Click a cell to
          browse those excerpts.
        </p>
      </div>
    </div>
  );
}
