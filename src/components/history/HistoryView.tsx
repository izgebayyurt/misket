import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Crosshair,
  GitFork,
  History as HistoryIcon,
  MoreHorizontal,
  Pencil,
  Redo2,
  Scissors,
  Undo2,
} from "lucide-react";
import {
  checkoutHistoryNode,
  compactHistoryBefore,
  forkHistoryNode,
  renameHistoryBranch,
  useHistoryTree,
} from "@/queries/history";
import {
  branchesOf,
  collapseDays,
  compactPreview,
  currentBranchName,
  dayKey,
  defaultExpandedDays,
  edgePath,
  formatDayDate,
  headIsOnOrBelow,
  layoutHistory,
  undivergedBranches,
} from "@/core/historyGraph";
import type {
  BranchInfo,
  DayDigest,
  DayHeaderRow,
  DayLabel,
  DisplayRow,
  StepRow,
} from "@/core/historyGraph";
import { absoluteTime, kindGroup, kindLabel, relativeTime } from "@/core/activity";
import { currentLocale } from "@/lib/i18n";
import {
  effectiveExpanded,
  readDayState,
  toggleDay,
  writeDayState,
  type DayState,
} from "@/state/historyDays";
import { useProjectInfo } from "@/queries/project";
import { useUndoStore } from "@/state/undoStore";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  contextMenuPrimitives,
  dropdownMenuPrimitives,
  type MenuPrimitives,
} from "@/components/ui/menu";
import type { HistoryNodeSummary } from "@/api/types";
import { HistoryDetail } from "./HistoryDetail";

const LANE_WIDTH = 18;
const ROW_HEIGHT = 44;

/** What the list has selected: one step, or one day's header. */
type Selection = { kind: "step"; id: number } | { kind: "day"; day: string } | null;

const rowKey = (row: DisplayRow) => (row.kind === "day" ? `day:${row.day}` : `step:${row.node.id}`);

const selectionKey = (s: NonNullable<Selection>) =>
  s.kind === "day" ? `day:${s.day}` : `step:${s.id}`;

function trackRow(map: Map<string, HTMLElement>, key: string, el: HTMLElement | null) {
  if (el) map.set(key, el);
  else map.delete(key);
}

/**
 * The whole undo tree as a branch graph, grouped by day: a dot and a line per
 * step, newest at the top, under a header per calendar day.
 *
 * Two deliberate choices here, both from using it:
 *
 * - A click **inspects**. It selects the step and describes it in the panel on
 *   the right; moving the project there is "Go to this point", a button of its
 *   own (and `G`). A single click used to check out, which is far too much to
 *   happen on the way to reading something.
 * - Days start **closed**, except the day the project is at and any day that
 *   holds a fork or a branch name — folding is here to shorten a long list,
 *   never to hide the shape of the tree. A closed day is still one row of the
 *   graph, with every lane running through it.
 */
export function HistoryView() {
  const { t } = useTranslation();
  const { data: nodes, isLoading } = useHistoryTree();
  const { data: project } = useProjectInfo();
  const projectId = project?.projectId ?? "";
  const [kindFilter, setKindFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selection>(null);
  // What is remembered for this project, and what has been changed since,
  // kept per project id so opening another project cannot inherit its days.
  const persistedDays = useMemo(() => readDayState(projectId), [projectId]);
  const [dayEdits, setDayEdits] = useState<Record<string, DayState>>({});
  const dayState = dayEdits[projectId] ?? persistedDays;
  const [forkTarget, setForkTarget] = useState<HistoryNodeSummary | null>(null);
  const [renameTarget, setRenameTarget] = useState<HistoryNodeSummary | null>(null);
  const [compactTarget, setCompactTarget] = useState<HistoryNodeSummary | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const scrolledOnce = useRef(false);
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const busy = useUndoStore((s) => s.busy);

  const { rows, laneCount } = useMemo(() => layoutHistory(nodes ?? []), [nodes]);
  const kindGroups = useMemo(
    () => Array.from(new Set((nodes ?? []).map((n) => kindGroup(n.kind)))).sort(),
    [nodes],
  );
  const headRow = rows.find((r) => r.node.isHead);
  const branches = useMemo(() => branchesOf(nodes ?? []), [nodes]);
  const branchName = useMemo(() => currentBranchName(nodes ?? []), [nodes]);
  const stubs = useMemo(() => undivergedBranches(nodes ?? []), [nodes]);

  const matches = useCallback(
    (node: HistoryNodeSummary) => {
      if (kindFilter && kindGroup(node.kind) !== kindFilter) return false;
      const q = query.trim().toLowerCase();
      if (q && !node.summary.toLowerCase().includes(q)) return false;
      return true;
    },
    [kindFilter, query],
  );
  const filtering = kindFilter !== "" || query.trim() !== "";

  const allDays = useMemo(() => [...new Set(rows.map((r) => dayKey(r.node.at)))], [rows]);
  const expandedDays = useMemo(() => {
    const open = effectiveExpanded(defaultExpandedDays(rows), dayState);
    // A filter can do nothing against a closed day, so any day holding a
    // match opens itself for as long as the filter is on.
    if (filtering) {
      for (const r of rows) if (matches(r.node)) open.add(dayKey(r.node.at));
    }
    return open;
  }, [rows, dayState, filtering, matches]);

  const { rows: displayRows, edges } = useMemo(
    () => collapseDays(rows, expandedDays),
    [rows, expandedDays],
  );

  const selectedStepId = selected?.kind === "step" ? selected.id : null;
  const selectedNode = nodes?.find((n) => n.id === selectedStepId) ?? null;
  /** The spare column a fork with no line of its own is drawn into. */
  const graphWidth = (laneCount + (stubs.size > 0 ? 1 : 0)) * LANE_WIDTH;

  const scrollTo = (key: string) =>
    rowRefs.current.get(key)?.scrollIntoView({ block: "center", behavior: "smooth" });

  const setDayOpen = useCallback(
    (day: string, open: boolean) => {
      setDayEdits((edits) => {
        const next = toggleDay(edits[projectId] ?? persistedDays, day, open);
        writeDayState(projectId, next);
        return { ...edits, [projectId]: { ...next, at: Date.now() } };
      });
    },
    [projectId, persistedDays],
  );

  /** Select a step, unfolding its day first when it is closed. */
  const selectStep = useCallback(
    (id: number) => {
      setSelected({ kind: "step", id });
      const node = nodes?.find((n) => n.id === id);
      if (node) {
        const day = dayKey(node.at);
        if (!expandedDays.has(day)) setDayOpen(day, true);
      }
      // After the render that unfolds the day it belongs to.
      requestAnimationFrame(() => scrollTo(`step:${id}`));
    },
    [nodes, expandedDays, setDayOpen],
  );

  const jumpToCurrent = () => {
    if (headRow) selectStep(headRow.node.id);
  };

  const setAllDays = (open: boolean) => {
    const next = open ? { expanded: allDays, collapsed: [] } : { expanded: [], collapsed: allDays };
    writeDayState(projectId, next);
    setDayEdits((edits) => ({ ...edits, [projectId]: { ...next, at: Date.now() } }));
  };

  // Land on the current step once, the first time the tree loads.
  useEffect(() => {
    if (scrolledOnce.current || !headRow) return;
    scrolledOnce.current = true;
    setSelected({ kind: "step", id: headRow.node.id });
    rowRefs.current.get(`step:${headRow.node.id}`)?.scrollIntoView({ block: "center" });
  }, [headRow]);

  async function checkout(node: HistoryNodeSummary | null) {
    if (!node || node.isHead) return;
    try {
      await checkoutHistoryNode(node.id);
    } catch (e) {
      toast.error(e);
    }
  }

  async function submitFork(name: string) {
    const target = forkTarget;
    setForkTarget(null);
    if (!target) return;
    try {
      const node = await forkHistoryNode(target.id, name);
      // The whole point of a fork is seeing that it happened: unfold its day,
      // select it, scroll it into view. The graph draws it as a stub until
      // something is built on it.
      selectStep(node.id);
    } catch (e) {
      toast.error(e);
    }
  }

  async function submitRename(name: string) {
    const target = renameTarget;
    setRenameTarget(null);
    if (!target) return;
    try {
      await renameHistoryBranch(target.id, name.trim() || null);
    } catch (e) {
      toast.error(e);
    }
  }

  function openCompact(node: HistoryNodeSummary) {
    if (!nodes || !headIsOnOrBelow(nodes, node.id)) {
      toast.error(t("history.unsafeCompact"));
      return;
    }
    setCompactTarget(node);
  }

  async function confirmCompact() {
    const target = compactTarget;
    setCompactTarget(null);
    if (!target) return;
    try {
      await compactHistoryBefore(target.id);
    } catch (e) {
      toast.error(e);
    }
  }

  /** Arrows move the selection, Enter unfolds a day, `G` goes to the step. */
  function onKeyDown(e: React.KeyboardEvent) {
    if (displayRows.length === 0) return;
    const at = selected ? displayRows.findIndex((r) => rowKey(r) === selectionKey(selected)) : -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      const wanted = at === -1 ? (step === 1 ? 0 : displayRows.length - 1) : at + step;
      const row = displayRows[Math.max(0, Math.min(displayRows.length - 1, wanted))];
      if (!row) return;
      setSelected(
        row.kind === "day" ? { kind: "day", day: row.day } : { kind: "step", id: row.node.id },
      );
      scrollTo(rowKey(row));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = at === -1 ? undefined : displayRows[at];
      if (row?.kind === "day") setDayOpen(row.day, !row.expanded);
      else if (row) scrollTo(rowKey(row));
      return;
    }
    if (e.key.toLowerCase() === "g" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      void checkout(selectedNode);
    }
  }

  return (
    <div className="flex h-full flex-col" data-testid="history-view">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <HistoryIcon className="size-4 shrink-0 text-fg-muted" aria-hidden />
        <h1 className="mr-2 text-sm font-medium">{t("history.title")}</h1>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="h-7 rounded-md border border-border bg-panel px-1.5 text-xs text-fg"
          aria-label={t("history.filterByKind")}
          data-testid="history-kind-filter"
        >
          <option value="">{t("history.allKinds")}</option>
          {kindGroups.map((g) => (
            <option key={g} value={g}>
              {kindLabel(g)}
            </option>
          ))}
        </select>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("history.searchPlaceholder")}
          aria-label={t("history.searchLabel")}
          className="h-7 max-w-52 text-xs"
          data-testid="history-search"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={jumpToCurrent}
          disabled={!headRow}
          data-testid="history-jump-to-current"
        >
          <Crosshair /> {t("history.jumpToCurrent")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setAllDays(true)}
          data-testid="history-expand-all"
        >
          {t("history.expandAll")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setAllDays(false)}
          data-testid="history-collapse-all"
        >
          {t("history.collapseAll")}
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void undo()}>
            <Undo2 /> {t("history.undo")}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void redo()}>
            <Redo2 /> {t("history.redo")}
          </Button>
        </div>
      </div>

      {branches.length > 0 ? (
        <BranchStrip
          branches={branches}
          onCheckoutTip={(id) => void checkout(nodes?.find((n) => n.id === id) ?? null)}
          onForkPoint={selectStep}
        />
      ) : null}

      {isLoading ? (
        <p className="p-4 text-sm text-fg-muted">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-sm text-fg-muted" data-testid="history-empty">
          {t("history.empty")}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Each row below is a real, independently tabbable button; the
              arrow/Enter/G handling here is a second, optional way to move
              the highlighted step and act on it without leaving the list,
              not a replacement widget of its own. */}
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div
            ref={listRef}
            className="min-w-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-label={t("history.stepsLabel")}
            data-testid="history-scroller"
          >
            <div className="flex">
              <div
                className="sticky left-0 z-10 shrink-0 bg-bg"
                style={{ width: graphWidth }}
                aria-hidden
              >
                <svg
                  width={graphWidth}
                  height={displayRows.length * ROW_HEIGHT}
                  data-testid="history-graph"
                >
                  {edges.map((e) => (
                    <path
                      key={`${e.fromId}-${e.toId}`}
                      d={edgePath(e, LANE_WIDTH, ROW_HEIGHT)}
                      fill="none"
                      stroke="var(--color-border)"
                      strokeWidth={2}
                    />
                  ))}
                  {displayRows.map((r) =>
                    r.kind === "day" ? (
                      // A day's header carries a marker in every lane
                      // running through it, so a closed day reads as part
                      // of the graph rather than as a gap in it.
                      r.lanes.map((lane) => (
                        <circle
                          key={`${r.day}-${lane}`}
                          cx={lane * LANE_WIDTH + LANE_WIDTH / 2}
                          cy={r.row * ROW_HEIGHT + ROW_HEIGHT / 2}
                          r={r.expanded ? 2 : 3}
                          fill={r.hasHead ? "var(--color-accent)" : "var(--color-border)"}
                          data-testid="history-day-dot"
                        />
                      ))
                    ) : (
                      <circle
                        key={r.node.id}
                        cx={r.lane * LANE_WIDTH + LANE_WIDTH / 2}
                        cy={r.row * ROW_HEIGHT + ROW_HEIGHT / 2}
                        r={r.node.isHead ? 6 : 4.5}
                        fill={r.node.isHead ? "var(--color-accent)" : "var(--color-fg-muted)"}
                        stroke="var(--color-bg)"
                        strokeWidth={r.node.isHead ? 2 : 0}
                        data-testid="history-dot"
                      />
                    ),
                  )}
                  {/* A fork nobody has built on yet owns no lane, so it would
                      otherwise leave no mark at all: draw it as a short stub
                      into the spare column, ending in a hollow tip. */}
                  {displayRows.map((r) => {
                    if (r.kind !== "step") return null;
                    const name = stubs.get(r.node.id);
                    if (!name) return null;
                    const x1 = r.lane * LANE_WIDTH + LANE_WIDTH / 2;
                    const y1 = r.row * ROW_HEIGHT + ROW_HEIGHT / 2;
                    const x2 = laneCount * LANE_WIDTH + LANE_WIDTH / 2;
                    const y2 = y1 - ROW_HEIGHT * 0.34;
                    return (
                      <g key={`stub-${r.node.id}`} data-testid="history-branch-stub">
                        <title>{t("history.branchStartsHereUndiverged", { name })}</title>
                        <path
                          d={`M${x1},${y1} C${x1},${y2} ${x2},${y1} ${x2},${y2}`}
                          fill="none"
                          stroke="var(--color-accent)"
                          strokeWidth={2}
                          strokeDasharray="3 2"
                        />
                        <circle
                          cx={x2}
                          cy={y2}
                          r={3.5}
                          fill="var(--color-bg)"
                          stroke="var(--color-accent)"
                          strokeWidth={2}
                        />
                      </g>
                    );
                  })}
                </svg>
              </div>
              <ul className="min-w-0 flex-1" data-testid="history-rows">
                {displayRows.map((r) =>
                  r.kind === "day" ? (
                    <DayRow
                      key={rowKey(r)}
                      header={r}
                      selected={selected?.kind === "day" && selected.day === r.day}
                      rowRef={(el) => trackRow(rowRefs.current, rowKey(r), el)}
                      onSelect={() => setSelected({ kind: "day", day: r.day })}
                      onToggle={() => setDayOpen(r.day, !r.expanded)}
                      onExpand={() => setDayOpen(r.day, true)}
                    />
                  ) : (
                    <HistoryRow
                      key={rowKey(r)}
                      laid={r}
                      branchName={branchName}
                      undiverged={stubs.has(r.node.id)}
                      selected={selected?.kind === "step" && selected.id === r.node.id}
                      future={!!headRow && r.lane === headRow.lane && r.row < headRow.row}
                      dimmed={!matches(r.node)}
                      rowRef={(el) => trackRow(rowRefs.current, rowKey(r), el)}
                      onSelect={() => {
                        setSelected({ kind: "step", id: r.node.id });
                        listRef.current?.focus({ preventScroll: true });
                      }}
                      onCheckout={() => void checkout(r.node)}
                      onFork={() => setForkTarget(r.node)}
                      onRename={() => setRenameTarget(r.node)}
                      onCompact={() => openCompact(r.node)}
                    />
                  ),
                )}
              </ul>
            </div>
          </div>
          <HistoryDetail
            nodeId={selectedStepId}
            onCheckout={() => void checkout(selectedNode)}
            onFork={() => selectedNode && setForkTarget(selectedNode)}
            onSelectNode={selectStep}
          />
        </div>
      )}

      {forkTarget ? (
        <NamePromptDialog
          title={t("history.forkTitle")}
          description={t("history.forkDescription", { summary: forkTarget.summary })}
          placeholder={t("history.branchNamePlaceholder")}
          submitLabel={t("history.fork")}
          onSubmit={submitFork}
          onClose={() => setForkTarget(null)}
        />
      ) : null}

      {renameTarget ? (
        <NamePromptDialog
          title={t("history.renameTitle")}
          description={t("history.renameDescription")}
          placeholder={t("history.branchNamePlaceholder")}
          initialValue={renameTarget.branchName ?? ""}
          submitLabel={t("common.save")}
          allowEmpty
          onSubmit={submitRename}
          onClose={() => setRenameTarget(null)}
        />
      ) : null}

      {compactTarget && nodes ? (
        <CompactConfirmDialog
          target={compactTarget}
          nodes={nodes}
          onConfirm={confirmCompact}
          onCancel={() => setCompactTarget(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One chip per named branch, plus `main`: where its tip is, and the way back
 * to where it forked. The chip itself goes to the tip; the crosshair beside it
 * only selects the fork point, moving nothing.
 */
function BranchStrip({
  branches,
  onCheckoutTip,
  onForkPoint,
}: {
  branches: BranchInfo[];
  onCheckoutTip: (tipId: number) => void;
  onForkPoint: (forkPointId: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-border bg-panel px-4 py-1.5"
      data-testid="history-branches"
    >
      <span className="mr-1 text-[11px] uppercase tracking-wide text-fg-muted">
        {t("history.branches")}
      </span>
      {branches.map((b) => (
        <span
          key={`${b.name}-${b.forkPointId}`}
          className={cn(
            "flex items-center rounded-full border text-xs",
            b.isCurrent ? "border-accent bg-accent/10 font-medium" : "border-border bg-bg",
          )}
          data-testid="history-branch-chip"
          data-current={b.isCurrent || undefined}
        >
          <button
            type="button"
            className="flex max-w-56 items-center gap-1 rounded-l-full py-0.5 pl-2 pr-1 hover:bg-muted"
            onClick={() => onCheckoutTip(b.tipId)}
            title={t("history.goToTip", { name: b.name, summary: b.tipSummary })}
          >
            <GitFork className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{b.name}</span>
            {b.diverged ? null : (
              <span className="shrink-0 text-[10px] text-fg-muted">{t("history.branchNew")}</span>
            )}
          </button>
          <button
            type="button"
            className="rounded-r-full py-0.5 pl-1 pr-2 text-fg-muted hover:bg-muted hover:text-fg"
            onClick={() => onForkPoint(b.forkPointId)}
            title={t("history.showForkPoint", { name: b.name })}
            aria-label={t("history.showForkPoint", { name: b.name })}
            data-testid="history-branch-fork-point"
          >
            <Crosshair className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** `{ kind: "today" }` etc. as text, in the active locale. */
function formatDayLabel(label: DayLabel, t: TFn, locale: string): string {
  switch (label.kind) {
    case "today":
      return t("history.day.today");
    case "yesterday":
      return t("history.day.yesterday");
    case "undated":
      return t("history.day.undated");
    case "date":
      return formatDayDate(label.day, locale);
  }
}

/**
 * Every `history.digest.*` key `formatDigest` can look up, written out
 * literally and never called: `formatDigest` builds the key at runtime
 * (`` `history.digest.${item.phraseKey}` ``, from `DIGEST_PHRASE_KEYS` in
 * `core/historyGraph.ts`), which `scripts/i18n-extract.mjs` cannot follow —
 * it only finds string literals. This keeps every phrase key checked as
 * "used" instead of the whole `history.digest.*` block reading as dead. Keep
 * it in sync with `DIGEST_PHRASE_KEYS`'s values (plus the `"groupChange"`
 * fallback); a mismatch fails `pnpm i18n:check` on whichever side is stale.
 */
function _digestKeysForExtraction(t: TFn) {
  t("history.digest.coding");
  t("history.digest.bulkCoding");
  t("history.digest.autoCoding");
  t("history.digest.recoding");
  t("history.digest.codeRemoved");
  t("history.digest.excerptDeleted");
  t("history.digest.excerptEdit");
  t("history.digest.codeCreated");
  t("history.digest.codeEdit");
  t("history.digest.codeDeleted");
  t("history.digest.merge");
  t("history.digest.codebookImport");
  t("history.digest.documentImported");
  t("history.digest.documentDeleted");
  t("history.digest.documentRenamed");
  t("history.digest.documentReordered");
  t("history.digest.memo");
  t("history.digest.memoDeleted");
  t("history.digest.descriptorSet");
  t("history.digest.descriptorField");
  t("history.digest.setChange");
  t("history.digest.savedFilter");
  t("history.digest.frameworkEdit");
  t("history.digest.frameworkCell");
  t("history.digest.transcriptSetting");
  t("history.digest.stopWordEdit");
  t("history.digest.projectRenamed");
  t("history.digest.pull");
  t("history.digest.groupChange");
}
void _digestKeysForExtraction;

/**
 * A day's digest as one line — `12 codings, 3 codes created, 1 merge` — by
 * running each structured {@link DayDigest} item through `t()` (picking the
 * right plural form) and joining with `Intl.ListFormat`, so the punctuation
 * between items follows the locale too.
 */
function formatDigest(digest: DayDigest, t: TFn, locale: string): string {
  const parts = digest.items.map((item) =>
    t(`history.digest.${item.phraseKey}`, { count: item.count, group: item.group }),
  );
  if (digest.moreCount > 0) parts.push(t("history.digest.more", { count: digest.moreCount }));
  if (parts.length === 0) return "";
  return new Intl.ListFormat(locale, { type: "unit", style: "short" }).format(parts);
}

/** A day's header: a click folds or unfolds it, a double click unfolds it. */
function DayRow({
  header,
  selected,
  rowRef,
  onSelect,
  onToggle,
  onExpand,
}: {
  header: DayHeaderRow;
  selected: boolean;
  rowRef: (el: HTMLElement | null) => void;
  onSelect: () => void;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  const locale = currentLocale();
  return (
    <li
      ref={rowRef}
      style={{ height: ROW_HEIGHT }}
      className={cn(
        "flex items-center border-b border-border bg-muted/40",
        selected && "ring-1 ring-inset ring-focus",
      )}
      data-testid="history-day"
      data-day={header.day}
      data-expanded={header.expanded || undefined}
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm hover:bg-muted"
        onClick={() => {
          onSelect();
          onToggle();
        }}
        // The two clicks of a double click have already toggled twice, which
        // lands back where it started; this settles it open, which is what
        // double clicking a group is expected to do.
        onDoubleClick={onExpand}
        aria-expanded={header.expanded}
        title={header.expanded ? t("history.foldDay") : t("history.unfoldDay")}
      >
        {header.expanded ? (
          <ChevronDown className="size-4 shrink-0 text-fg-muted" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-fg-muted" />
        )}
        <span className="shrink-0 font-medium">{formatDayLabel(header.label, t, locale)}</span>
        <span className="shrink-0 whitespace-nowrap text-xs text-fg-muted">
          {t("history.stepCount", { count: header.count })}
        </span>
        {header.expanded ? (
          <span className="flex-1" />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-xs text-fg-muted"
            data-testid="history-day-digest"
          >
            {formatDigest(header.digest, t, locale)}
          </span>
        )}
        {header.branchNames.map((name) => (
          <span
            key={name}
            className="shrink-0 rounded-full border border-accent px-1.5 py-0.5 text-[10px]"
            title={t("history.branchStartsHere", { name })}
          >
            {name}
          </span>
        ))}
        {header.hasBranchPoint ? (
          <GitFork
            className="size-3.5 shrink-0 text-fg-muted"
            aria-label={t("history.forksInsideDay")}
          />
        ) : null}
        {header.hasHead ? (
          <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-fg">
            {t("history.youAreHere")}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function HistoryRow({
  laid,
  branchName,
  undiverged,
  selected,
  future,
  dimmed,
  rowRef,
  onSelect,
  onCheckout,
  onFork,
  onRename,
  onCompact,
}: {
  laid: StepRow;
  /** The branch the project is on, for the head row's "You are here". */
  branchName: string;
  /** This step carries a branch name that has not diverged yet. */
  undiverged: boolean;
  selected: boolean;
  future: boolean;
  dimmed: boolean;
  rowRef: (el: HTMLElement | null) => void;
  onSelect: () => void;
  onCheckout: () => void;
  onFork: () => void;
  onRename: () => void;
  onCompact: () => void;
}) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const { node } = laid;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          ref={rowRef}
          style={{ height: ROW_HEIGHT }}
          className={cn(
            "group flex items-center gap-2 border-b border-border px-3 text-sm hover:bg-muted",
            node.isHead && "bg-muted/70 font-medium",
            selected && "ring-1 ring-inset ring-focus",
          )}
          data-testid="history-row"
          data-head={node.isHead || undefined}
          data-selected={selected || undefined}
        >
          <button
            type="button"
            onClick={onSelect}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 text-left",
              (future || dimmed) && "opacity-50",
              node.undoable === false && "italic text-fg-muted",
            )}
            title={t("history.showWhatStepDid")}
            data-testid="history-row-select"
          >
            <span className="min-w-0 flex-1 truncate">{node.summary}</span>
            {node.stepCount > 1 ? (
              <span
                className="shrink-0 text-[10px] text-fg-muted"
                title={t("history.stepUndoneRedone", { count: node.stepCount })}
                data-testid="history-step-count"
              >
                {t("history.stepCount", { count: node.stepCount })}
              </span>
            ) : null}
            {node.branchName ? (
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
                  undiverged ? "border-accent text-fg" : "border-border bg-panel text-fg-muted",
                )}
                title={t(
                  undiverged
                    ? "history.branchStartsHereUndiverged"
                    : "history.branchStartsHereShort",
                  { name: node.branchName },
                )}
                data-testid="history-row-branch-chip"
              >
                <GitFork className="size-2.5" aria-hidden /> {node.branchName}
              </span>
            ) : null}
            <span className="shrink-0 text-xs text-fg-muted">{node.actor}</span>
            <span
              className="shrink-0 whitespace-nowrap text-xs tabular-nums text-fg-muted"
              title={absoluteTime(node.at, locale)}
            >
              {relativeTime(node.at, undefined, locale)}
            </span>
            {node.isHead ? (
              <span
                className="shrink-0 whitespace-nowrap rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-fg"
                data-testid="history-here-marker"
              >
                {t("history.youAreHereOn", { branch: branchName })}
              </span>
            ) : null}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="shrink-0 rounded p-0.5 text-fg-muted opacity-0 hover:bg-border group-hover:opacity-100 data-[state=open]:opacity-100"
                aria-label={t("history.stepActions")}
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <HistoryRowMenuItems
                node={node}
                onCheckout={onCheckout}
                onFork={onFork}
                onRename={onRename}
                onCompact={onCompact}
                menu={dropdownMenuPrimitives}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <HistoryRowMenuItems
          node={node}
          onCheckout={onCheckout}
          onFork={onFork}
          onRename={onRename}
          onCompact={onCompact}
          menu={contextMenuPrimitives}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function HistoryRowMenuItems({
  node,
  onCheckout,
  onFork,
  onRename,
  onCompact,
  menu,
}: {
  node: HistoryNodeSummary;
  onCheckout: () => void;
  onFork: () => void;
  onRename: () => void;
  onCompact: () => void;
  menu: MenuPrimitives;
}) {
  const { t } = useTranslation();
  const { Item } = menu;
  return (
    <>
      {node.isHead ? null : (
        <Item onSelect={onCheckout} data-testid="history-goto">
          <Crosshair /> {t("history.goToThisPoint")}
        </Item>
      )}
      <Item onSelect={onFork} data-testid="history-fork">
        <GitFork /> {t("history.forkHere")}
      </Item>
      {node.branchName ? (
        <Item onSelect={onRename} data-testid="history-rename-branch">
          <Pencil /> {t("history.renameBranch")}
        </Item>
      ) : null}
      <Item onSelect={onCompact} data-testid="history-compact">
        <Scissors /> {t("history.compactBeforeHere")}
      </Item>
    </>
  );
}

function NamePromptDialog({
  title,
  description,
  placeholder,
  submitLabel,
  initialValue = "",
  allowEmpty = false,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  placeholder: string;
  submitLabel: string;
  initialValue?: string;
  /** Allow submitting an empty value (clearing a branch name). */
  allowEmpty?: boolean;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} description={description}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(value);
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            data-testid="history-name-input"
            onFocus={(e) => e.currentTarget.select()}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!allowEmpty && !value.trim()}
              data-testid="history-name-submit"
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CompactConfirmDialog({
  target,
  nodes,
  onConfirm,
  onCancel,
}: {
  target: HistoryNodeSummary;
  nodes: HistoryNodeSummary[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const locale = currentLocale();
  const { dropped, droppedBranches } = useMemo(
    () => compactPreview(nodes, target.id),
    [nodes, target.id],
  );
  const branchNames = droppedBranches.map((b) => `"${b}"`);
  const description =
    dropped === 0
      ? t("history.compactNothingToDrop")
      : t("history.compactDescription", {
          count: dropped,
          summary: target.summary,
          branches:
            branchNames.length > 0
              ? t("history.compactIncludingBranch", {
                  count: branchNames.length,
                  names: new Intl.ListFormat(locale, { type: "conjunction" }).format(branchNames),
                })
              : "",
        });
  return (
    <ConfirmDialog
      title={t("history.compactTitle")}
      description={description}
      confirmLabel={t("history.compactConfirm")}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
