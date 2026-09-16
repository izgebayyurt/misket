import { useState } from "react";
import { TagPlus, TagX, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ColorDot } from "@/components/codebook/ColorSwatch";
import { pathOf } from "@/core/codeTree";
import { useCodeTree } from "@/queries/codes";
import {
  useAddCodesToExcerpts,
  useDeleteExcerpts,
  useRemoveCodesFromExcerpts,
} from "@/queries/excerpts";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";

interface Props {
  /** The selected excerpt ids, in row order. */
  ids: string[];
  /** Codes carried by at least one selected excerpt. */
  codeIds: string[];
  onClear: () => void;
}

/** Floating bar over the excerpt list while a multi-selection is active. */
export function BulkActionBar({ ids, codeIds, onClear }: Props) {
  const tree = useCodeTree();
  const openCodePicker = useWorkspace((s) => s.openCodePicker);
  const addCodes = useAddCodesToExcerpts();
  const removeCodes = useRemoveCodesFromExcerpts();
  const deleteExcerpts = useDeleteExcerpts();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const count = ids.length;
  const excerpts = `${count} excerpt${count === 1 ? "" : "s"}`;
  const busy = addCodes.isPending || removeCodes.isPending || deleteExcerpts.isPending;
  const nameOf = (codeId: string) => tree.byId.get(codeId)?.code.name ?? "code";

  function addCode() {
    openCodePicker({
      label: `Add to ${excerpts}`,
      onPick: async (codeId) => {
        try {
          const affected = await addCodes.mutateAsync({
            ids,
            codeIds: [codeId],
            label: `Add ${nameOf(codeId)} to ${excerpts}`,
          });
          toast.info(
            affected
              ? `Added ${nameOf(codeId)} to ${affected} excerpt${affected === 1 ? "" : "s"}.`
              : `Every selected excerpt already has ${nameOf(codeId)}.`,
          );
        } catch (e) {
          toast.error(e);
        }
      },
    });
  }

  async function removeCode(codeId: string) {
    setRemoveOpen(false);
    try {
      const affected = await removeCodes.mutateAsync({
        ids,
        codeIds: [codeId],
        label: `Remove ${nameOf(codeId)} from ${excerpts}`,
      });
      toast.info(`Removed ${nameOf(codeId)} from ${affected} excerpt${affected === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e);
    }
  }

  async function confirmDelete() {
    setConfirmingDelete(false);
    try {
      const deleted = await deleteExcerpts.mutateAsync({ ids });
      onClear();
      toast.info(`Deleted ${deleted} excerpt${deleted === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <>
      <div
        className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-panel px-3 py-2 shadow-xl"
        data-testid="bulk-action-bar"
      >
        <span className="whitespace-nowrap px-1 text-sm font-medium tabular-nums">
          {excerpts} selected
        </span>
        <Button size="sm" variant="outline" onClick={addCode} disabled={busy}>
          <TagPlus /> Add code…
        </Button>
        <Popover open={removeOpen} onOpenChange={setRemoveOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" disabled={busy || codeIds.length === 0}>
              <TagX /> Remove code…
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1">
            <p className="px-2 py-1 text-xs text-fg-muted">Codes in this selection</p>
            <ul className="max-h-64 overflow-y-auto">
              {codeIds.map((codeId) => (
                <li key={codeId}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => void removeCode(codeId)}
                  >
                    <ColorDot color={tree.byId.get(codeId)?.code.color ?? "#999"} />
                    <span className="truncate">{pathOf(tree, codeId)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
        <Button
          size="sm"
          variant="danger"
          onClick={() => setConfirmingDelete(true)}
          disabled={busy}
          data-testid="bulk-delete"
        >
          <Trash2 /> Delete
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
          <X /> Clear selection
        </Button>
      </div>
      {confirmingDelete ? (
        <ConfirmDialog
          title={`Delete ${excerpts}?`}
          description="The text stays in the document; only the coded excerpts and their memos are removed. This can be undone."
          confirmLabel={`Delete ${excerpts}`}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setConfirmingDelete(false)}
        />
      ) : null}
    </>
  );
}
