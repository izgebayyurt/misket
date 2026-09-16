import { useState } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import type { SetInfo, SetKind } from "@/api/types";
import {
  useDeleteSet,
  useRemoveFromSet,
  useRenameSet,
  useSetMembers,
  useSets,
} from "@/queries/sets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "@/state/toasts";
import { SetDialog, type MemberOption } from "./SetDialog";

/**
 * The "Sets" list that sits under the code tree and under the document list.
 * `options` is every candidate member in display order, which is also what
 * the create / edit dialogs check off and what an expanded row shows.
 */
export function SetsSection({
  kind,
  title,
  options,
  onOpen,
}: {
  kind: SetKind;
  title: string;
  options: MemberOption[];
  onOpen: (set: SetInfo) => void;
}) {
  const { data: sets } = useSets(kind);
  const [dialog, setDialog] = useState<{ set?: SetInfo } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rename = useRenameSet();
  const remove = useDeleteSet();

  function toggle(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="border-t border-border" data-testid={`${kind}-sets`}>
      <div className="flex items-center gap-1 px-3 py-1.5">
        <h3 className="flex-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
          {title}
        </h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDialog({})}
          title={`New ${kind} set`}
          aria-label={`New ${kind} set`}
          data-testid={`new-${kind}-set`}
        >
          <Plus />
        </Button>
      </div>
      {sets && sets.length === 0 ? (
        <p className="px-3 pb-2 text-xs text-fg-muted">
          No sets yet. Group {kind === "code" ? "codes" : "documents"} you keep coming back to.
        </p>
      ) : null}
      <ul className="pb-2">
        {sets?.map((s) => (
          <li key={s.id}>
            <div className="group flex items-center gap-1 px-1 py-1 text-sm hover:bg-muted">
              <button
                type="button"
                className="rounded p-0.5 text-fg-muted hover:bg-border"
                onClick={() => toggle(s.id)}
                aria-label={expanded.has(s.id) ? "Collapse" : "Expand"}
                aria-expanded={expanded.has(s.id)}
              >
                {expanded.has(s.id) ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>
              {renamingId === s.id ? (
                <RenameInput
                  initial={s.name}
                  onCancel={() => setRenamingId(null)}
                  onCommit={async (name) => {
                    setRenamingId(null);
                    try {
                      await rename.mutateAsync({ id: s.id, name, previous: s.name });
                    } catch (e) {
                      toast.error(e);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => onOpen(s)}
                  title={`Show excerpts in "${s.name}"`}
                  data-testid="set-item"
                >
                  {s.name}
                </button>
              )}
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-fg-muted">
                {s.memberCount || ""}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-border focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                    aria-label="Set actions"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setRenamingId(s.id)}>Rename</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog({ set: s })}>
                    Edit members…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    danger
                    onSelect={async () => {
                      try {
                        await remove.mutateAsync(s);
                      } catch (e) {
                        toast.error(e);
                      }
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {expanded.has(s.id) ? <Members set={s} options={options} /> : null}
          </li>
        ))}
      </ul>
      {dialog ? (
        <SetDialog kind={kind} set={dialog.set} options={options} onClose={() => setDialog(null)} />
      ) : null}
    </section>
  );
}

function Members({ set, options }: { set: SetInfo; options: MemberOption[] }) {
  const { data: memberIds, isLoading } = useSetMembers(set.id);
  const remove = useRemoveFromSet();
  if (isLoading) return null;
  const members = (memberIds ?? [])
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is MemberOption => !!o);
  if (members.length === 0)
    return <p className="px-3 pb-1 pl-8 text-xs text-fg-muted">Empty set.</p>;
  return (
    <ul className="pb-1">
      {members.map((m) => (
        <li
          key={m.id}
          className={cn("group/member flex items-center gap-2 py-0.5 pr-1 text-xs text-fg-muted")}
          style={{ paddingLeft: 30 + (m.depth ?? 0) * 10 }}
        >
          {m.color ? (
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: m.color }} />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{m.label}</span>
          <button
            type="button"
            className="rounded px-1 opacity-0 hover:bg-border focus-visible:opacity-100 group-hover/member:opacity-100"
            aria-label={`Remove ${m.label} from ${set.name}`}
            onClick={async () => {
              try {
                await remove.mutateAsync({
                  setId: set.id,
                  memberId: m.id,
                  label: `Remove "${m.label}" from "${set.name}"`,
                });
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
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
      aria-label="Set name"
    />
  );
}
