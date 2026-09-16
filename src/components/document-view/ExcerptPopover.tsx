import { Plus, Trash2, X } from "lucide-react";
import type { ExcerptWithCodes } from "@/api/types";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useCodeTree } from "@/queries/codes";
import { useRemoveExcerptCode } from "@/queries/excerpts";
import { pathOf } from "@/core/codeTree";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";

interface Props {
  excerpt: ExcerptWithCodes;
  anchor: HTMLElement;
  onClose: () => void;
  /** Requests deletion of this excerpt; the caller decides whether to confirm first. */
  onDelete: () => void;
}

/** Inline editor for a focused excerpt: its codes, and delete. */
export function ExcerptPopover({ excerpt, anchor, onClose, onDelete }: Props) {
  const tree = useCodeTree();
  const removeCode = useRemoveExcerptCode();
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);

  return (
    <Popover open onOpenChange={(o) => !o && onClose()}>
      <PopoverAnchor virtualRef={{ current: anchor }} />
      <PopoverContent
        side="bottom"
        align="start"
        className="w-80 p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        data-testid="excerpt-popover"
      >
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Excerpt
          </span>
          <button
            className="rounded p-0.5 text-fg-muted hover:bg-muted"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <ul className="max-h-48 overflow-y-auto">
          {excerpt.codeIds.map((id) => (
            <li
              key={id}
              className="group flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
            >
              <ColorDot color={tree.byId.get(id)?.code.color ?? "#999"} />
              <span className="min-w-0 flex-1 truncate">
                {pathOf(tree, id) || "(deleted code)"}
              </span>
              <button
                className="rounded p-0.5 text-fg-muted opacity-0 hover:bg-border group-hover:opacity-100"
                aria-label="Remove code"
                onClick={() =>
                  removeCode
                    .mutateAsync({ id: excerpt.id, documentId: excerpt.documentId, codeId: id })
                    .catch(toast.error)
                }
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
          {excerpt.codeIds.length === 0 ? (
            <li className="px-1 py-1 text-sm text-fg-muted">No codes yet.</li>
          ) : null}
        </ul>
        <div className="mt-2 flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => setPaletteOpen(true)}>
            <Plus /> Add code
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" className="text-danger" onClick={onDelete}>
            <Trash2 /> Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
