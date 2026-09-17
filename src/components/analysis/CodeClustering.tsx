import { useMemo, useRef, useState } from "react";
import { Boxes } from "lucide-react";
import {
  averageLinkage,
  cutTree,
  heightRange,
  similarity,
  type DendroTree,
  type SimilarityMethod,
} from "@/core/cluster";
import { nextColor, PALETTE, pathOf } from "@/core/codeTree";
import { matrixCsv } from "@/core/csv";
import { useCoOccurrence } from "@/queries/analysis";
import { useCodeTree, useCodes, useCreateParentFromCluster } from "@/queries/codes";
import { ColorDot, ColorPicker } from "@/components/codebook/ColorSwatch";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CoderFilter } from "@/components/coders/CoderMark";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";
import { shade } from "./shade";
import {
  AnalysisToolbar,
  DocumentFilter,
  EmptyNote,
  ExportCsvButton,
  ExportPngButton,
} from "./shared";

const NEUTRAL = "var(--fg-muted)";
const ROW_HEIGHT = 22;
const LABEL_WIDTH = 160;

/** A distinct, stable colour per cluster, cycling the codebook palette by
 * the cluster's position in leaf order (not by code colour, which belongs
 * to the code itself, not to cluster membership). */
function clusterColorScale(clusters: string[][]): Map<string, string> {
  const byLeaf = new Map<string, string>();
  clusters.forEach((members, i) => {
    const color = PALETTE[i % PALETTE.length]!;
    for (const id of members) byLeaf.set(id, color);
  });
  return byLeaf;
}

export function CodeClustering() {
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [documentSetIds, setDocumentSetIds] = useState<string[]>([]);
  const [coderIds, setCoderIds] = useState<string[]>([]);
  const [method, setMethod] = useState<SimilarityMethod>("jaccard");
  const [cutHeight, setCutHeight] = useState<number | null>(null);
  const [dialogMembers, setDialogMembers] = useState<string[] | null>(null);
  const { data, isPending } = useCoOccurrence(documentIds, documentSetIds, coderIds);
  const tree = useCodeTree();
  const openExcerpts = useWorkspace((s) => s.openExcerpts);
  const svgRef = useRef<SVGSVGElement>(null);

  const { ids, ownSize, pairCount, hasCooccurrence } = useMemo(() => {
    const cells = new Map<string, number>();
    for (const [row, col, n] of data?.cells ?? []) cells.set(`${row}|${col}`, n);
    const ownSize = (id: string) => cells.get(`${id}|${id}`) ?? 0;
    const pairCount = (a: string, b: string) =>
      a === b ? ownSize(a) : (cells.get(`${a}|${b}`) ?? 0);
    const ids = (data?.codeIds ?? []).filter((id) => ownSize(id) > 0);
    const hasCooccurrence = ids.some((a) => ids.some((b) => a !== b && pairCount(a, b) > 0));
    return { ids, ownSize, pairCount, hasCooccurrence };
  }, [data]);

  const { tree: dendro, leafOrder } = useMemo(() => {
    const distance = (a: string, b: string) =>
      1 - similarity(method, pairCount(a, b), ownSize(a), ownSize(b));
    return averageLinkage(ids, distance);
  }, [ids, method, ownSize, pairCount]);

  const [, maxHeight] = heightRange(dendro);
  // Default to the tallest merge (everything in one cluster) until the user
  // moves the slider, and clamp a stale height down rather than resetting it
  // in an effect: a filter change that shrinks the dendrogram should not
  // leave the cut above its new, lower ceiling.
  const height = cutHeight === null ? maxHeight : Math.min(cutHeight, maxHeight);
  const clusters = useMemo(() => cutTree(dendro, height), [dendro, height]);
  const clusterColor = useMemo(() => clusterColorScale(clusters), [clusters]);

  function csv() {
    const rows: (string | number)[][] = [["Code", "Cluster"]];
    clusters.forEach((members, i) => {
      for (const id of members) rows.push([pathOf(tree, id), `Cluster ${i + 1}`]);
    });
    return matrixCsv(
      "Code",
      leafOrder.map((a) => pathOf(tree, a)),
      leafOrder.map((a) => ({
        label: pathOf(tree, a),
        values: leafOrder.map((b) =>
          Number(similarity(method, pairCount(a, b), ownSize(a), ownSize(b)).toFixed(3)),
        ),
      })),
    );
  }

  if (!hasCooccurrence) {
    return (
      <div className="flex h-full flex-col" data-testid="analysis-clustering">
        <Toolbar
          documentIds={documentIds}
          setDocumentIds={setDocumentIds}
          documentSetIds={documentSetIds}
          setDocumentSetIds={setDocumentSetIds}
          coderIds={coderIds}
          setCoderIds={setCoderIds}
          method={method}
          setMethod={setMethod}
          csv={csv}
          svgRef={svgRef}
          disabled
        />
        <EmptyNote>
          {isPending
            ? "Counting…"
            : "Nothing to cluster yet: two or more codes need to co-occur (be applied to overlapping passages) before they can be grouped by similarity."}
        </EmptyNote>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="analysis-clustering">
      <Toolbar
        documentIds={documentIds}
        setDocumentIds={setDocumentIds}
        documentSetIds={documentSetIds}
        setDocumentSetIds={setDocumentSetIds}
        coderIds={coderIds}
        setCoderIds={setCoderIds}
        method={method}
        setMethod={setMethod}
        csv={csv}
        svgRef={svgRef}
        disabled={false}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-auto border-r border-border p-3">
          <Dendrogram
            svgRef={svgRef}
            tree={dendro}
            leafOrder={leafOrder}
            codeTree={tree}
            cutHeight={height}
            maxHeight={maxHeight}
            clusterColor={clusterColor}
            onOpenExcerpts={(id) => openExcerpts({ codeIds: [id], includeDescendants: false })}
          />
          <h3 className="mt-6 mb-2 text-xs font-medium text-fg-muted">
            Similarity matrix (ordered by the dendrogram)
          </h3>
          <SimilarityHeatmap
            order={leafOrder}
            tree={tree}
            method={method}
            ownSize={ownSize}
            pairCount={pairCount}
            onOpenExcerpts={(a, b) =>
              openExcerpts(
                a === b
                  ? { codeIds: [a], includeDescendants: false }
                  : { codeIds: [a], overlapsCodeId: b, includeDescendants: false },
              )
            }
          />
        </div>
        <div className="w-64 shrink-0 overflow-auto p-3" data-testid="cluster-list">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-medium text-fg-muted">
              {clusters.length} cluster{clusters.length === 1 ? "" : "s"}
            </h3>
            <input
              type="range"
              min={0}
              max={maxHeight || 1}
              step={(maxHeight || 1) / 200}
              value={height}
              onChange={(e) => setCutHeight(Number(e.target.value))}
              className="w-24 accent-[var(--accent)]"
              data-testid="cluster-cut-height"
              aria-label="Cut height"
            />
          </div>
          <ul className="space-y-2">
            {clusters.map((members, i) => (
              <li key={i} className="rounded-md border border-border p-2 text-xs">
                <div className="mb-1 flex items-center gap-1.5">
                  <ColorDot color={clusterColor.get(members[0]!) ?? NEUTRAL} />
                  <span className="font-medium">
                    Cluster {i + 1} ({members.length})
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {members.map((id) => (
                    <li key={id} className="flex items-center gap-1.5 truncate text-fg-muted">
                      <ColorDot color={tree.byId.get(id)?.code.color ?? "#888"} />
                      <span className="truncate">{tree.byId.get(id)?.code.name ?? id}</span>
                    </li>
                  ))}
                </ul>
                {members.length > 1 ? (
                  <button
                    type="button"
                    className="mt-1.5 text-accent hover:underline"
                    onClick={() => setDialogMembers(members)}
                    data-testid="create-parent-from-cluster"
                  >
                    Create parent code from cluster…
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-fg-muted">
        Similarity is {method === "jaccard" ? "the Jaccard index" : "cosine similarity"} over each
        pair of codes&rsquo; excerpt sets. Use the cut-height slider to change how many clusters
        that makes; double-click a leaf to see that code&rsquo;s excerpts.
      </p>
      {dialogMembers ? (
        <CreateParentDialog memberIds={dialogMembers} onClose={() => setDialogMembers(null)} />
      ) : null}
    </div>
  );
}

function Toolbar({
  documentIds,
  setDocumentIds,
  documentSetIds,
  setDocumentSetIds,
  coderIds,
  setCoderIds,
  method,
  setMethod,
  csv,
  svgRef,
  disabled,
}: {
  documentIds: string[];
  setDocumentIds: (ids: string[]) => void;
  documentSetIds: string[];
  setDocumentSetIds: (ids: string[]) => void;
  coderIds: string[];
  setCoderIds: (ids: string[]) => void;
  method: SimilarityMethod;
  setMethod: (m: SimilarityMethod) => void;
  csv: () => string;
  svgRef: React.RefObject<SVGSVGElement | null>;
  disabled: boolean;
}) {
  return (
    <AnalysisToolbar>
      <DocumentFilter
        documentIds={documentIds}
        onChange={setDocumentIds}
        documentSetIds={documentSetIds}
        onSetIdsChange={setDocumentSetIds}
      />
      <CoderFilter coderIds={coderIds} onChange={setCoderIds} />
      <div className="flex items-center gap-1 rounded-md border border-border p-0.5 text-xs">
        {(["jaccard", "cosine"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={cn(
              "rounded px-2 py-1 capitalize",
              method === m ? "bg-accent text-accent-fg" : "hover:bg-muted",
            )}
            onClick={() => setMethod(m)}
            data-testid={`similarity-method-${m}`}
          >
            {m}
          </button>
        ))}
      </div>
      <span className="ml-auto" />
      <ExportPngButton name="code-clustering" svgRef={svgRef} disabled={disabled} />
      <ExportCsvButton name="code-clustering" build={csv} disabled={disabled} />
    </AnalysisToolbar>
  );
}

function Dendrogram({
  svgRef,
  tree,
  leafOrder,
  codeTree,
  cutHeight,
  maxHeight,
  clusterColor,
  onOpenExcerpts,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  tree: DendroTree | null;
  leafOrder: string[];
  codeTree: ReturnType<typeof useCodeTree>;
  cutHeight: number;
  maxHeight: number;
  clusterColor: Map<string, string>;
  onOpenExcerpts: (id: string) => void;
}) {
  if (!tree || leafOrder.length < 2) return null;
  const height = leafOrder.length * ROW_HEIGHT + 8;
  const plotWidth = 260;
  const width = plotWidth + LABEL_WIDTH;
  const scaleX = (h: number) => (maxHeight > 0 ? plotWidth * (1 - h / maxHeight) : plotWidth);

  const indexOf = new Map(leafOrder.map((id, i) => [id, i]));
  const pos = new Map<DendroTree, { x: number; y: number }>();
  const place = (node: DendroTree): { x: number; y: number } => {
    if (node.type === "leaf") {
      const p = { x: scaleX(0), y: (indexOf.get(node.id)! + 0.5) * ROW_HEIGHT + 4 };
      pos.set(node, p);
      return p;
    }
    const l = place(node.left);
    const r = place(node.right);
    const p = { x: scaleX(node.height), y: (l.y + r.y) / 2 };
    pos.set(node, p);
    return p;
  };
  place(tree);

  const edges: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
  const walk = (node: DendroTree) => {
    if (node.type === "leaf") return;
    const p = pos.get(node)!;
    const l = pos.get(node.left)!;
    const r = pos.get(node.right)!;
    const color =
      node.height <= cutHeight ? (clusterColor.get(node.members[0]!) ?? NEUTRAL) : NEUTRAL;
    edges.push({ x1: l.x, y1: l.y, x2: p.x, y2: l.y, color });
    edges.push({ x1: r.x, y1: r.y, x2: p.x, y2: r.y, color });
    edges.push({ x1: p.x, y1: l.y, x2: p.x, y2: r.y, color });
    walk(node.left);
    walk(node.right);
  };
  walk(tree);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="Code similarity dendrogram"
      data-testid="dendrogram-svg"
    >
      <line
        x1={scaleX(cutHeight)}
        y1={0}
        x2={scaleX(cutHeight)}
        y2={height}
        stroke="var(--accent)"
        strokeDasharray="3,3"
        data-testid="dendrogram-cut-line"
      />
      {edges.map((e, i) => (
        <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={e.color} strokeWidth={1.5} />
      ))}
      {leafOrder.map((id) => {
        const y = (indexOf.get(id)! + 0.5) * ROW_HEIGHT + 4;
        const code = codeTree.byId.get(id)?.code;
        return (
          <g
            key={id}
            className="cursor-pointer"
            onDoubleClick={() => onOpenExcerpts(id)}
            data-testid="dendrogram-leaf"
          >
            <title>{pathOf(codeTree, id)}</title>
            <circle cx={scaleX(0) + 8} cy={y} r={4} fill={code?.color ?? "#888"} />
            <text x={scaleX(0) + 16} y={y + 3.5} fontSize={11} fill="var(--fg)">
              {code?.name ?? id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SimilarityHeatmap({
  order,
  tree,
  method,
  ownSize,
  pairCount,
  onOpenExcerpts,
}: {
  order: string[];
  tree: ReturnType<typeof useCodeTree>;
  method: SimilarityMethod;
  ownSize: (id: string) => number;
  pairCount: (a: string, b: string) => number;
  onOpenExcerpts: (a: string, b: string) => void;
}) {
  if (order.length < 2) return null;
  return (
    <table className="border-separate border-spacing-0 text-xs" data-testid="similarity-matrix">
      <thead>
        <tr>
          <th className="sticky left-0 top-0 z-30 bg-bg" />
          {order.map((id) => (
            <th
              key={id}
              className="h-24 w-7 min-w-7 bg-bg align-bottom p-0"
              title={pathOf(tree, id)}
              scope="col"
            >
              <div className="flex h-24 flex-col items-center justify-end gap-1 pb-1">
                <span
                  className="max-h-20 overflow-hidden whitespace-nowrap font-normal text-fg-muted"
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                >
                  {tree.byId.get(id)?.code.name ?? id}
                </span>
                <ColorDot color={tree.byId.get(id)?.code.color ?? "#888"} />
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {order.map((row) => (
          <tr key={row}>
            <th
              className="max-w-40 truncate border-b border-border bg-bg py-0 pr-2 text-left font-normal"
              scope="row"
              title={pathOf(tree, row)}
            >
              <span className="flex items-center gap-1.5">
                <ColorDot color={tree.byId.get(row)?.code.color ?? "#888"} />
                <span className="max-w-32 truncate">{tree.byId.get(row)?.code.name ?? row}</span>
              </span>
            </th>
            {order.map((col) => {
              const s = similarity(method, pairCount(row, col), ownSize(row), ownSize(col));
              const diagonal = row === col;
              return (
                <td
                  key={col}
                  className={cn(
                    "h-6 w-7 cursor-default border border-border/60 text-center tabular-nums",
                    diagonal
                      ? "bg-muted font-medium"
                      : s > 0
                        ? "hover:outline hover:outline-accent"
                        : "",
                  )}
                  style={diagonal ? undefined : shade(s, 1)}
                  title={`${pathOf(tree, row)} × ${pathOf(tree, col)}: ${s.toFixed(2)}`}
                  onClick={() => onOpenExcerpts(row, col)}
                >
                  {diagonal ? "" : s > 0.005 ? s.toFixed(2).replace(/^0\./, ".") : ""}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CreateParentDialog({ memberIds, onClose }: { memberIds: string[]; onClose: () => void }) {
  const tree = useCodeTree();
  const { data: codes } = useCodes();
  const create = useCreateParentFromCluster();
  const [name, setName] = useState("");
  const [color, setColor] = useState(() => nextColor(codes ?? []));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        color,
        memberIds,
        label: `Create "${name.trim()}" from a cluster of ${memberIds.length} codes`,
      });
      onClose();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Create parent code from cluster">
        <form onSubmit={submit} className="space-y-3">
          <p className="text-xs text-fg-muted">
            Moves {memberIds.length} code{memberIds.length === 1 ? "" : "s"} under a new top-level
            code, as one undoable step.
          </p>
          <ul className="max-h-24 space-y-0.5 overflow-auto rounded-md border border-border p-2 text-xs">
            {memberIds.map((id) => (
              <li key={id} className="flex items-center gap-1.5">
                <ColorDot color={tree.byId.get(id)?.code.color ?? "#888"} />
                {pathOf(tree, id)}
              </li>
            ))}
          </ul>
          <div>
            <label className="text-xs font-medium text-fg-muted" htmlFor="cluster-parent-name">
              New code name
            </label>
            <Input
              id="cluster-parent-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              data-testid="cluster-parent-name"
            />
          </div>
          <div>
            <span className="text-xs font-medium text-fg-muted">Color</span>
            <div className="mt-1">
              <ColorPicker value={color} onChange={setColor} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || create.isPending}
              data-testid="cluster-parent-submit"
            >
              <Boxes /> Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
