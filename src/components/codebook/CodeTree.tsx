import { describe } from "@/core/keymap";
import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import type { Code } from "@/api/types";
import { useCodes, useCodeTree, useMoveCode, useUpdateCode } from "@/queries/codes";
import { flattenTree, matchesQuery, type CodeNode } from "@/core/codeTree";
import { useWorkspace } from "@/state/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorDot } from "./ColorSwatch";
import { CodeDialog } from "./CodeDialog";
import { DeleteCodeDialog } from "./DeleteCodeDialog";
import { MergeCodeDialog } from "./MergeCodeDialog";
import { MoveExcerptsDialog } from "./MoveExcerptsDialog";
import { cn } from "@/lib/utils";
import { toast } from "@/state/toasts";

type DialogState =
  | { kind: "create"; parentId: string | null }
  | { kind: "edit"; code: Code }
  | { kind: "delete"; code: Code }
  | { kind: "merge"; code: Code }
  | { kind: "moveExcerpts"; code: Code }
  | null;

interface DropTarget {
  id: string;
  /** before/after = sibling positions; inside = become last child */
  where: "before" | "after" | "inside";
}

export function CodeTree() {
  const { data: codes, isLoading } = useCodes();
  const tree = useCodeTree();
  const move = useMoveCode();
  const selectedId = useWorkspace((s) => s.selectedCodeId);
  const setSelectedId = useWorkspace((s) => s.setSelectedCodeId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const rows = useMemo(() => {
    const all = flattenTree(tree, query ? undefined : collapsed);
    return query ? all.filter((n) => matchesQuery(tree, n.code.id, query)) : all;
  }, [tree, collapsed, query]);

  function toggle(id: string) {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function focusRow(id: string) {
    setSelectedId(id);
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-code-id="${id}"]`)?.focus();
    });
  }

  function onKeyDown(e: React.KeyboardEvent, node: CodeNode, index: number) {
    if (renamingId) return;
    const id = node.code.id;
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = rows[index + 1];
        if (next) focusRow(next.code.id);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev = rows[index - 1];
        if (prev) focusRow(prev.code.id);
        break;
      }
      case "ArrowRight":
        e.preventDefault();
        if (node.children.length && collapsed.has(id)) toggle(id);
        else if (node.children[0]) focusRow(node.children[0].code.id);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (node.children.length && !collapsed.has(id)) toggle(id);
        else if (node.code.parentId) focusRow(node.code.parentId);
        break;
      case "F2":
        e.preventDefault();
        setRenamingId(id);
        break;
      case "Enter":
        e.preventDefault();
        setDialog({ kind: "edit", code: node.code });
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        setDialog({ kind: "delete", code: node.code });
        break;
      case "n":
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        setDialog({ kind: "create", parentId: id });
        break;
    }
  }

  async function handleDrop(target: DropTarget) {
    if (!dragId || dragId === target.id) return;
    const targetNode = tree.byId.get(target.id);
    if (!targetNode) return;
    let newParentId: string | null;
    let index: number;
    if (target.where === "inside") {
      newParentId = target.id;
      index = targetNode.children.length;
    } else {
      newParentId = targetNode.code.parentId;
      const siblings = newParentId ? (tree.byId.get(newParentId)?.children ?? []) : tree.roots;
      const without = siblings.filter((n) => n.code.id !== dragId);
      const pos = without.findIndex((n) => n.code.id === target.id);
      index = target.where === "before" ? pos : pos + 1;
    }
    try {
      await move.mutateAsync({ id: dragId, newParentId, index });
      if (newParentId)
        setCollapsed((s) =>
          s.has(newParentId) ? new Set([...s].filter((x) => x !== newParentId)) : s,
        );
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 p-2">
        <Input
          placeholder="Filter codes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-7 text-xs"
          aria-label="Filter codes"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialog({ kind: "create", parentId: null })}
          title="New code"
          data-testid="new-code"
        >
          <Plus />
        </Button>
      </div>
      {codes && codes.length === 0 ? (
        <p className="px-3 py-1 text-xs text-fg-muted">
          No codes yet. Create one, or type <kbd>&gt;name</kbd> in the palette (
          {describe("palette")}) while coding.
        </p>
      ) : null}
      {isLoading ? null : (
        <ul
          ref={listRef}
          role="tree"
          aria-label="Codebook"
          className="flex-1 overflow-y-auto pb-4"
          onDragLeave={(e) => {
            if (!listRef.current?.contains(e.relatedTarget as Node)) setDropTarget(null);
          }}
        >
          {rows.map((node, index) => (
            <CodeRow
              key={node.code.id}
              node={node}
              index={index}
              selected={selectedId === node.code.id}
              collapsed={collapsed.has(node.code.id)}
              renaming={renamingId === node.code.id}
              dragging={dragId === node.code.id}
              dropTarget={dropTarget?.id === node.code.id ? dropTarget.where : null}
              onToggle={() => toggle(node.code.id)}
              onSelect={() => setSelectedId(node.code.id)}
              onKeyDown={(e) => onKeyDown(e, node, index)}
              onRenameDone={() => setRenamingId(null)}
              onAction={(kind) => {
                if (kind === "rename") setRenamingId(node.code.id);
                else if (kind === "addChild") setDialog({ kind: "create", parentId: node.code.id });
                else setDialog({ kind, code: node.code });
              }}
              onDragStart={() => setDragId(node.code.id)}
              onDragEnd={() => {
                setDragId(null);
                setDropTarget(null);
              }}
              onDragOver={(where) => setDropTarget({ id: node.code.id, where })}
              onDrop={() => {
                if (dropTarget) void handleDrop(dropTarget);
                setDragId(null);
                setDropTarget(null);
              }}
            />
          ))}
        </ul>
      )}
      {dialog?.kind === "create" ? (
        <CodeDialog
          mode="create"
          parentId={dialog.parentId}
          onClose={() => setDialog(null)}
          onCreated={(c) => setSelectedId(c.id)}
        />
      ) : dialog?.kind === "edit" ? (
        <CodeDialog mode="edit" code={dialog.code} onClose={() => setDialog(null)} />
      ) : dialog?.kind === "delete" ? (
        <DeleteCodeDialog code={dialog.code} onClose={() => setDialog(null)} />
      ) : dialog?.kind === "merge" ? (
        <MergeCodeDialog code={dialog.code} onClose={() => setDialog(null)} />
      ) : dialog?.kind === "moveExcerpts" ? (
        <MoveExcerptsDialog code={dialog.code} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

interface RowProps {
  node: CodeNode;
  index: number;
  selected: boolean;
  collapsed: boolean;
  renaming: boolean;
  dragging: boolean;
  dropTarget: DropTarget["where"] | null;
  onToggle: () => void;
  onSelect: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onRenameDone: () => void;
  onAction: (kind: "rename" | "edit" | "addChild" | "merge" | "moveExcerpts" | "delete") => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (where: DropTarget["where"]) => void;
  onDrop: () => void;
}

function CodeRow(p: RowProps) {
  const { code, children, depth } = p.node;
  const update = useUpdateCode();

  async function commitRename(name: string) {
    const trimmed = name.trim();
    p.onRenameDone();
    if (!trimmed || trimmed === code.name) return;
    try {
      await update.mutateAsync({ id: code.id, patch: { name: trimmed } });
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <li
      role="treeitem"
      aria-selected={p.selected}
      aria-expanded={children.length ? !p.collapsed : undefined}
      aria-level={depth + 1}
      tabIndex={p.selected ? 0 : -1}
      data-code-id={code.id}
      data-testid="code-item"
      draggable={!p.renaming}
      className={cn(
        "group relative flex cursor-default items-center gap-1.5 py-1 pr-1 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
        p.selected && "bg-muted",
        p.dragging && "opacity-40",
        p.dropTarget === "inside" && "ring-2 ring-inset ring-accent",
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={p.onSelect}
      onDoubleClick={() => p.onAction("rename")}
      onKeyDown={p.onKeyDown}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", code.id);
        p.onDragStart();
      }}
      onDragEnd={p.onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const y = (e.clientY - rect.top) / rect.height;
        p.onDragOver(y < 0.25 ? "before" : y > 0.75 ? "after" : "inside");
      }}
      onDrop={(e) => {
        e.preventDefault();
        p.onDrop();
      }}
    >
      {p.dropTarget === "before" ? <DropLine top /> : null}
      {p.dropTarget === "after" ? <DropLine /> : null}
      <button
        type="button"
        className={cn(
          "rounded p-0.5 text-fg-muted hover:bg-border",
          !children.length && "invisible",
        )}
        onClick={(e) => {
          e.stopPropagation();
          p.onToggle();
        }}
        tabIndex={-1}
        aria-label={p.collapsed ? "Expand" : "Collapse"}
      >
        {p.collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>
      <ColorDot color={code.color} />
      {p.renaming ? (
        <RenameInput initial={code.name} onCommit={commitRename} onCancel={p.onRenameDone} />
      ) : (
        <span className="min-w-0 flex-1 truncate">{code.name}</span>
      )}
      {code.shortcut ? (
        <kbd className="rounded border border-border bg-panel px-1 font-mono text-[10px] text-fg-muted">
          {code.shortcut}
        </kbd>
      ) : null}
      <span className="w-6 text-right text-xs tabular-nums text-fg-muted">
        {code.excerptCount || ""}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-border focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label="Code actions"
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuItem onSelect={() => p.onAction("addChild")}>New sub-code</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => p.onAction("rename")}>Rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => p.onAction("edit")}>Edit…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => p.onAction("merge")}>Merge into…</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => p.onAction("moveExcerpts")}
            disabled={code.excerptCount === 0}
          >
            Move excerpts to…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem danger onSelect={() => p.onAction("delete")}>
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Input
      ref={(el) => el?.select()}
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => onCommit(name)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onCommit(name);
        if (e.key === "Escape") onCancel();
      }}
      className="h-6 px-1 text-sm"
      aria-label="Code name"
    />
  );
}

function DropLine({ top }: { top?: boolean }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-2 right-2 h-0.5 bg-accent",
        top ? "top-0" : "bottom-0",
      )}
    />
  );
}
