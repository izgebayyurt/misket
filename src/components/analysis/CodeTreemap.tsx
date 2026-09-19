import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toCsv } from "@/core/csv";
import { canLabel, layoutLevel, tintFor, treemapForest, type TreemapCode } from "@/core/treemap";
import { pathOf } from "@/core/codeTree";
import { useCodeFrequencies } from "@/queries/analysis";
import { useCodeTree } from "@/queries/codes";
import { CoderFilter } from "@/components/coders/CoderMark";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";
import {
  AnalysisToolbar,
  DocumentFilter,
  EmptyNote,
  ExportCsvButton,
  ExportPngButton,
} from "./shared";

/** Not a real code: the forest's roots as one node's children, so the
 * top-level layout goes through the same `layoutLevel` as any drill. */
const ALL_CODES_ID = "__treemap_all__";

function findNode(nodes: TreemapCode[], id: string): TreemapCode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return undefined;
}

/** The chain of nodes from the forest's root down to `id` (inclusive),
 * for the breadcrumb — `undefined` if `id` no longer exists in `forest`. */
function pathTo(forest: TreemapCode[], id: string): TreemapCode[] | undefined {
  for (const n of forest) {
    if (n.id === id) return [n];
    const rest = pathTo(n.children, id);
    if (rest) return [n, ...rest];
  }
  return undefined;
}

export function CodeTreemap() {
  const { t } = useTranslation();
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [documentSetIds, setDocumentSetIds] = useState<string[]>([]);
  const [coderIds, setCoderIds] = useState<string[]>([]);
  const [ownOnly, setOwnOnly] = useState(false);
  const [drillId, setDrillId] = useState<string>(ALL_CODES_ID);
  const { data: frequencies, isPending } = useCodeFrequencies(
    documentIds,
    documentSetIds,
    coderIds,
  );
  const tree = useCodeTree();
  const openExcerpts = useWorkspace((s) => s.openExcerpts);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 640, height: 420 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const forest = useMemo(
    () => (frequencies ? treemapForest(tree, frequencies, ownOnly) : []),
    [tree, frequencies, ownOnly],
  );
  const root: TreemapCode = useMemo(
    () => ({
      id: ALL_CODES_ID,
      name: t("analysis.allCodes"),
      color: "var(--accent)",
      value: forest.reduce((s, n) => s + n.value, 0),
      children: forest,
    }),
    [forest, t],
  );

  // A code deleted, or filters that empty it out, should not leave the view
  // drilled into a node that no longer exists — fall back to the top level
  // for this render rather than resetting state from an effect; the next
  // click sets a fresh, valid `drillId` anyway.
  const effectiveDrillId =
    drillId !== ALL_CODES_ID && !findNode(forest, drillId) ? ALL_CODES_ID : drillId;

  const crumbs = useMemo(
    () =>
      effectiveDrillId === ALL_CODES_ID
        ? [root]
        : [root, ...(pathTo(forest, effectiveDrillId) ?? [])],
    [root, forest, effectiveDrillId],
  );
  const current = crumbs[crumbs.length - 1]!;
  const depth = crumbs.length - 1;

  const rect = { x: 0, y: 0, w: box.width, h: box.height };
  const { cells } = layoutLevel(current, rect);
  const total = current.value;

  function csv() {
    const rows: (string | number)[][] = [["Code", "Own", "With sub-codes", "Share of level"]];
    for (const cell of cells) {
      const f = (frequencies ?? []).find((x) => x.codeId === cell.id);
      rows.push([
        pathOf(tree, cell.id),
        f?.own ?? 0,
        f?.withDescendants ?? 0,
        total > 0 ? `${((cell.value / total) * 100).toFixed(1)}%` : "0%",
      ]);
    }
    return toCsv(rows);
  }

  return (
    <div className="flex h-full flex-col" data-testid="analysis-treemap">
      <AnalysisToolbar>
        <DocumentFilter
          documentIds={documentIds}
          onChange={setDocumentIds}
          documentSetIds={documentSetIds}
          onSetIdsChange={setDocumentSetIds}
        />
        <CoderFilter coderIds={coderIds} onChange={setCoderIds} />
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={ownOnly}
            onChange={(e) => setOwnOnly(e.target.checked)}
            data-testid="treemap-own-only"
          />
          {t("analysis.treemap.ownOnly")}
        </label>
        <span className="ml-auto" />
        <ExportPngButton name="code-treemap" svgRef={svgRef} disabled={!cells.length} />
        <ExportCsvButton name="code-treemap" build={csv} disabled={!cells.length} />
      </AnalysisToolbar>
      <nav
        className="flex items-center gap-1 border-b border-border bg-panel px-4 py-1.5 text-xs text-fg-muted"
        aria-label={t("analysis.treemap.breadcrumb")}
        data-testid="treemap-breadcrumb"
      >
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight className="size-3" /> : null}
            <button
              type="button"
              className={cn(
                "rounded px-1 py-0.5 hover:bg-muted hover:text-fg",
                i === crumbs.length - 1 && "font-medium text-fg",
              )}
              onClick={() => setDrillId(c.id)}
              disabled={i === crumbs.length - 1}
              data-testid="treemap-crumb"
            >
              {c.name}
            </button>
          </span>
        ))}
      </nav>
      <div ref={containerRef} className="min-h-0 flex-1 p-2">
        {!cells.length ? (
          <EmptyNote>
            {isPending
              ? t("analysis.counting")
              : depth > 0
                ? t("analysis.treemap.emptyDrilled")
                : t("analysis.frequencies.empty")}
          </EmptyNote>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${box.width} ${box.height}`}
            width="100%"
            height="100%"
            role="img"
            aria-label={t("analysis.treemap.svgLabel", { name: current.name })}
            data-testid="treemap-svg"
          >
            {cells.map((cell) => {
              const share = total > 0 ? cell.value / total : 0;
              // Tint by the code's absolute depth in the codebook (not the
              // current drill level), so a subtree reads as progressively
              // lighter the deeper it goes no matter where you're looking at it.
              const tint = tintFor(0, tree.byId.get(cell.id)?.depth ?? 0);
              const labelOk = canLabel(cell);
              return (
                <g
                  key={cell.id}
                  data-testid="treemap-cell"
                  className="cursor-pointer"
                  onClick={() => cell.code.children.length && setDrillId(cell.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    openExcerpts({ codeIds: [cell.id], includeDescendants: !ownOnly });
                  }}
                >
                  <rect
                    x={cell.x}
                    y={cell.y}
                    width={Math.max(0, cell.w - 1)}
                    height={Math.max(0, cell.h - 1)}
                    style={{
                      fill: `color-mix(in srgb, ${cell.code.color} ${Math.round((1 - tint) * 100)}%, var(--bg-panel))`,
                    }}
                    stroke="var(--bg-panel)"
                    strokeWidth={1}
                  >
                    <title>
                      {t("analysis.treemap.cellTitle", {
                        path: pathOf(tree, cell.id),
                        count: cell.value,
                        percent: (share * 100).toFixed(1),
                        of:
                          current.id === ALL_CODES_ID ? t("analysis.allCodesLower") : current.name,
                        drillHint: cell.code.children.length ? t("analysis.treemap.drillHint") : "",
                      })}
                    </title>
                  </rect>
                  {labelOk ? (
                    <text
                      x={cell.x + 4}
                      y={cell.y + 14}
                      fontSize={11}
                      fill="var(--accent-fg)"
                      style={{
                        pointerEvents: "none",
                        paintOrder: "stroke",
                        stroke: "rgba(0,0,0,0.35)",
                        strokeWidth: 2,
                      }}
                    >
                      {cell.code.name}
                    </text>
                  ) : null}
                  {labelOk && cell.h >= 44 ? (
                    <text
                      x={cell.x + 4}
                      y={cell.y + 28}
                      fontSize={10}
                      fill="var(--accent-fg)"
                      style={{
                        pointerEvents: "none",
                        paintOrder: "stroke",
                        stroke: "rgba(0,0,0,0.35)",
                        strokeWidth: 2,
                      }}
                    >
                      {cell.value}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-fg-muted">
        {ownOnly ? t("analysis.treemap.footerOwn") : t("analysis.treemap.footerWithSub")}
      </p>
    </div>
  );
}
