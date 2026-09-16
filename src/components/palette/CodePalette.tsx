import { useMemo, useState } from "react";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useWorkspace } from "@/state/workspace";
import { useCodes, useCodeTree, useCreateCode } from "@/queries/codes";
import { useAddExcerptCodes, useApplyCodes } from "@/queries/excerpts";
import { flattenTree, pathOf } from "@/core/codeTree";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { toast } from "@/state/toasts";
import { useDocumentExcerpts } from "@/queries/excerpts";

/**
 * The coding palette: pick a code to apply to the pending selection or the
 * focused excerpt. `>name` creates a new code and applies it.
 *
 * With a `paletteTarget` set (`openCodePicker`) it is a plain code picker
 * instead, handing the chosen code to the caller — that is how the excerpt
 * browser's bulk "Add code…" reuses it.
 */
export function CodePalette() {
  const open = useWorkspace((s) => s.paletteOpen);
  const setOpen = useWorkspace((s) => s.setPaletteOpen);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[18%] z-50 w-[520px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-panel shadow-2xl outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
          aria-describedby={undefined}
          data-testid="code-palette"
        >
          <DialogPrimitive.Title className="sr-only">Pick a code</DialogPrimitive.Title>
          {open ? <PaletteBody close={() => setOpen(false)} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Mounted only while open, so the query resets on every open. */
function PaletteBody({ close }: { close: () => void }) {
  const picker = useWorkspace((s) => s.paletteTarget);
  const pending = useWorkspace((s) => s.pendingSelection);
  const focusedId = useWorkspace((s) => s.focusedExcerptId);
  const setFocusedId = useWorkspace((s) => s.setFocusedExcerptId);
  const setPending = useWorkspace((s) => s.setPendingSelection);
  const view = useWorkspace((s) => s.view);
  const documentId = view.kind === "document" ? view.documentId : null;
  const { data: codes } = useCodes();
  const tree = useCodeTree();
  const { data: excerpts } = useDocumentExcerpts(documentId);
  const applyCodes = useApplyCodes();
  const addCodes = useAddExcerptCodes();
  const createCode = useCreateCode();
  const [query, setQuery] = useState("");

  const focused = focusedId && !picker ? excerpts?.find((e) => e.id === focusedId) : undefined;
  const target = picker
    ? picker.label
    : pending
      ? "Code selection"
      : focused
        ? "Add to excerpt"
        : "No target";
  const items = useMemo(() => flattenTree(tree), [tree]);
  const creating = query.startsWith(">") && query.slice(1).trim().length > 0;

  async function apply(codeId: string, keepOpen: boolean) {
    try {
      if (picker) {
        await picker.onPick(codeId);
      } else if (pending && documentId) {
        const r = await applyCodes.mutateAsync({
          documentId,
          startPos: pending.start,
          endPos: pending.end,
          codeIds: [codeId],
        });
        window.getSelection()?.removeAllRanges();
        setPending(null);
        setFocusedId(r.excerpt.id);
      } else if (focused) {
        await addCodes.mutateAsync({
          id: focused.id,
          documentId: focused.documentId,
          codeIds: [codeId],
        });
      } else {
        toast.info("Select some text or an excerpt first.");
      }
      if (!keepOpen) close();
      else setQuery("");
    } catch (e) {
      toast.error(e);
    }
  }

  async function createAndApply(keepOpen: boolean) {
    const name = query.slice(1).trim();
    if (!name) return;
    try {
      const code = await createCode.mutateAsync({ name });
      await apply(code.id, keepOpen);
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Command
      label={picker ? picker.label : "Apply a code"}
      shouldFilter={!creating}
      onKeyDown={(e) => {
        if (e.key === "Enter" && creating) {
          e.preventDefault();
          void createAndApply(e.shiftKey);
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <span className="text-xs text-fg-muted">{target}</span>
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Type a code name, or >new code"
          className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-muted"
          data-testid="palette-input"
        />
      </div>
      <Command.List className="max-h-72 overflow-y-auto p-1">
        {creating ? (
          <Command.Item
            value={`create:${query}`}
            onSelect={() => createAndApply(false)}
            className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
          >
            <span className="text-fg-muted">Create code</span>
            <span className="font-medium">{query.slice(1).trim()}</span>
          </Command.Item>
        ) : (
          <>
            <Command.Empty className="px-2 py-3 text-sm text-fg-muted">
              {codes && codes.length === 0
                ? "No codes yet. Type >name to create one."
                : "No matching code. Type >name to create it."}
            </Command.Empty>
            {items.map((n) => {
              const applied = !picker && !pending && focused?.codeIds.includes(n.code.id);
              return (
                <Command.Item
                  key={n.code.id}
                  value={`${pathOf(tree, n.code.id)} ${n.code.shortcut ?? ""}`}
                  keywords={[n.code.name]}
                  disabled={applied}
                  onSelect={() => apply(n.code.id, false)}
                  onKeyDown={undefined}
                  className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm data-[disabled=true]:opacity-40 data-[selected=true]:bg-muted"
                  data-testid="palette-item"
                >
                  <ColorDot color={n.code.color} />
                  <span className="min-w-0 flex-1" style={{ paddingLeft: n.depth * 10 }}>
                    <span className="flex items-baseline gap-2">
                      <span className="truncate">{n.code.name}</span>
                      {n.code.parentId ? (
                        <span className="truncate text-xs text-fg-muted">
                          {pathOf(tree, n.code.parentId)}
                        </span>
                      ) : null}
                    </span>
                    {n.code.description ? (
                      <span className="block truncate text-xs text-fg-muted">
                        {n.code.description}
                      </span>
                    ) : null}
                  </span>
                  {applied ? <span className="text-xs text-fg-muted">applied</span> : null}
                  {n.code.shortcut ? (
                    <kbd className="rounded border border-border px-1 font-mono text-[10px] text-fg-muted">
                      {n.code.shortcut}
                    </kbd>
                  ) : null}
                </Command.Item>
              );
            })}
          </>
        )}
      </Command.List>
      <div className="flex gap-3 border-t border-border px-3 py-1.5 text-[11px] text-fg-muted">
        <span>↵ {picker ? "pick" : "apply"}</span>
        <span>⇧↵ {picker ? "pick" : "apply"} and keep open</span>
        <span>&gt;name creates</span>
        <span>esc close</span>
      </div>
    </Command>
  );
}
