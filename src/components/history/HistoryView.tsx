import { useEffect, useMemo, useRef, useState } from "react";
import {
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
import { compactPreview, edgePath, headIsOnOrBelow, layoutHistory } from "@/core/historyGraph";
import type { LaidOutNode } from "@/core/historyGraph";
import { absoluteTime, kindGroup, kindLabel, relativeTime } from "@/core/activity";
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

const LANE_WIDTH = 18;
const ROW_HEIGHT = 44;

/**
 * The whole undo tree as a branch graph: a dot and a line per step, newest
 * at the top. Clicking a row moves the project there; the row menu can fork
 * a named branch from it, rename an existing one, or throw away everything
 * that led up to it.
 */
export function HistoryView() {
  const { data: nodes, isLoading } = useHistoryTree();
  const [kindFilter, setKindFilter] = useState("");
  const [query, setQuery] = useState("");
  const [forkTarget, setForkTarget] = useState<HistoryNodeSummary | null>(null);
  const [renameTarget, setRenameTarget] = useState<HistoryNodeSummary | null>(null);
  const [compactTarget, setCompactTarget] = useState<HistoryNodeSummary | null>(null);
  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  const scrolledOnce = useRef(false);
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const busy = useUndoStore((s) => s.busy);

  const { rows, edges, laneCount } = useMemo(() => layoutHistory(nodes ?? []), [nodes]);
  const kindGroups = useMemo(
    () => Array.from(new Set((nodes ?? []).map((n) => kindGroup(n.kind)))).sort(),
    [nodes],
  );
  const headRow = rows.find((r) => r.node.isHead);

  const jumpToCurrent = () => {
    if (!headRow) return;
    rowRefs.current.get(headRow.node.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  // Land on the current step once, the first time the tree loads.
  useEffect(() => {
    if (scrolledOnce.current || !headRow) return;
    scrolledOnce.current = true;
    rowRefs.current.get(headRow.node.id)?.scrollIntoView({ block: "center" });
  }, [headRow]);

  async function checkout(node: HistoryNodeSummary) {
    if (node.isHead) return;
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
      await forkHistoryNode(target.id, name);
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
      toast.error(
        "Go to that step (or a step below it) first: compacting from here would drop where the project is.",
      );
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

  const matches = (node: HistoryNodeSummary) => {
    if (kindFilter && kindGroup(node.kind) !== kindFilter) return false;
    if (query.trim() && !node.summary.toLowerCase().includes(query.trim().toLowerCase())) {
      return false;
    }
    return true;
  };

  return (
    <div className="flex h-full flex-col" data-testid="history-view">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <HistoryIcon className="size-4 shrink-0 text-fg-muted" aria-hidden />
        <h1 className="mr-2 text-sm font-medium">History</h1>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="h-7 rounded-md border border-border bg-panel px-1.5 text-xs text-fg"
          aria-label="Filter by kind"
          data-testid="history-kind-filter"
        >
          <option value="">All kinds</option>
          {kindGroups.map((g) => (
            <option key={g} value={g}>
              {kindLabel(g)}
            </option>
          ))}
        </select>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search summaries…"
          aria-label="Search history"
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
          <Crosshair /> Jump to current
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void undo()}>
            <Undo2 /> Undo
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void redo()}>
            <Redo2 /> Redo
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="p-4 text-sm text-fg-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-sm text-fg-muted" data-testid="history-empty">
          Nothing recorded yet. Coding, editing the codebook and writing memos all show up here.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex">
            <div
              className="sticky left-0 z-10 shrink-0 bg-bg"
              style={{ width: laneCount * LANE_WIDTH }}
              aria-hidden
            >
              <svg
                width={laneCount * LANE_WIDTH}
                height={rows.length * ROW_HEIGHT}
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
                {rows.map((r) => (
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
                ))}
              </svg>
            </div>
            <ul className="min-w-0 flex-1 divide-y divide-border" data-testid="history-rows">
              {rows.map((r) => (
                <HistoryRow
                  key={r.node.id}
                  laid={r}
                  future={!!headRow && r.lane === headRow.lane && r.row < headRow.row}
                  dimmed={!matches(r.node)}
                  rowRef={(el) => {
                    if (el) rowRefs.current.set(r.node.id, el);
                    else rowRefs.current.delete(r.node.id);
                  }}
                  onCheckout={() => void checkout(r.node)}
                  onFork={() => setForkTarget(r.node)}
                  onRename={() => setRenameTarget(r.node)}
                  onCompact={() => openCompact(r.node)}
                />
              ))}
            </ul>
          </div>
        </div>
      )}

      {forkTarget ? (
        <NamePromptDialog
          title="Fork here…"
          description={`Name the branch that grows from "${forkTarget.summary}".`}
          placeholder="Branch name"
          submitLabel="Fork"
          onSubmit={submitFork}
          onClose={() => setForkTarget(null)}
        />
      ) : null}

      {renameTarget ? (
        <NamePromptDialog
          title="Rename branch…"
          description="Clear the name to remove it."
          placeholder="Branch name"
          initialValue={renameTarget.branchName ?? ""}
          submitLabel="Save"
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

function HistoryRow({
  laid,
  future,
  dimmed,
  rowRef,
  onCheckout,
  onFork,
  onRename,
  onCompact,
}: {
  laid: LaidOutNode;
  future: boolean;
  dimmed: boolean;
  rowRef: (el: HTMLLIElement | null) => void;
  onCheckout: () => void;
  onFork: () => void;
  onRename: () => void;
  onCompact: () => void;
}) {
  const { node } = laid;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          ref={rowRef}
          style={{ height: ROW_HEIGHT }}
          className={cn(
            "group flex items-center gap-2 px-3 text-sm hover:bg-muted",
            node.isHead && "bg-muted/70 font-medium",
          )}
          data-testid="history-row"
          data-head={node.isHead || undefined}
        >
          <button
            type="button"
            onClick={onCheckout}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 text-left",
              (future || dimmed) && "opacity-50",
              node.undoable === false && "italic text-fg-muted",
            )}
            title={node.isHead ? undefined : "Move the project to this step"}
            data-testid="history-row-checkout"
          >
            <span className="min-w-0 flex-1 truncate">{node.summary}</span>
            {node.branchName ? (
              <span
                className="shrink-0 rounded-full border border-border bg-panel px-1.5 py-0.5 text-[10px] text-fg-muted"
                data-testid="history-branch-chip"
              >
                {node.branchName}
              </span>
            ) : null}
            <span className="shrink-0 text-xs text-fg-muted">{node.actor}</span>
            <span
              className="shrink-0 whitespace-nowrap text-xs tabular-nums text-fg-muted"
              title={absoluteTime(node.at)}
            >
              {relativeTime(node.at)}
            </span>
            {node.isHead ? (
              <span
                className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-fg"
                data-testid="history-here-marker"
              >
                You are here
              </span>
            ) : null}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="shrink-0 rounded p-0.5 text-fg-muted opacity-0 hover:bg-border group-hover:opacity-100 data-[state=open]:opacity-100"
                aria-label="History step actions"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <HistoryRowMenuItems
                node={node}
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
  onFork,
  onRename,
  onCompact,
  menu,
}: {
  node: HistoryNodeSummary;
  onFork: () => void;
  onRename: () => void;
  onCompact: () => void;
  menu: MenuPrimitives;
}) {
  const { Item } = menu;
  return (
    <>
      <Item onSelect={onFork} data-testid="history-fork">
        <GitFork /> Fork here…
      </Item>
      {node.branchName ? (
        <Item onSelect={onRename} data-testid="history-rename-branch">
          <Pencil /> Rename branch…
        </Item>
      ) : null}
      <Item onSelect={onCompact} data-testid="history-compact">
        <Scissors /> Compact history before here…
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
              Cancel
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
  const { dropped, droppedBranches } = useMemo(
    () => compactPreview(nodes, target.id),
    [nodes, target.id],
  );
  const description =
    dropped === 0
      ? "Nothing leads up to this step, so there is nothing to drop."
      : `This drops ${dropped.toLocaleString()} step${dropped === 1 ? "" : "s"} that ` +
        `${dropped === 1 ? "does" : "do"} not lead to or from "${target.summary}"` +
        (droppedBranches.length > 0
          ? `, including the branch${droppedBranches.length === 1 ? "" : "es"} ${droppedBranches.map((b) => `"${b}"`).join(", ")}`
          : "") +
        ". This cannot be undone.";
  return (
    <ConfirmDialog
      title="Compact history before here?"
      description={description}
      confirmLabel="Compact"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
