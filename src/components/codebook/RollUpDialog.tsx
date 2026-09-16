import { useState } from "react";
import type { Code } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useRollUpCodes } from "@/queries/excerpts";
import { toast } from "@/state/toasts";

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Second-cycle lumping: hand a sub-code's excerpts (or every sub-code's
 * excerpts) to the parent in one step, and decide separately whether the
 * emptied codes should go too.
 *
 * Keeping them is the reversible half and the default, because "lump these
 * back together" is exactly the move people want to try and then reconsider.
 * Deleting them is a code delete like any other: it confirms here and clears
 * the undo history.
 */
export function RollUpDialog({
  parent,
  children,
  onClose,
}: {
  parent: Code;
  children: Code[];
  onClose: () => void;
}) {
  const rollUp = useRollUpCodes();
  const [deleteEmptied, setDeleteEmptied] = useState(false);
  const total = children.reduce((n, c) => n + c.excerptCount, 0);
  const what = children.length === 1 ? `"${children[0]!.name}"` : `${children.length} sub-codes`;

  async function run() {
    try {
      const moved = await rollUp.mutateAsync({
        parentId: parent.id,
        childIds: children.map((c) => c.id),
        deleteEmptied,
        label:
          children.length === 1
            ? `Roll "${children[0]!.name}" up into "${parent.name}"`
            : `Roll ${children.length} sub-codes up into "${parent.name}"`,
      });
      toast.info(
        `Moved ${plural(moved, "excerpt")} to "${parent.name}"${
          deleteEmptied ? `, and deleted ${what}.` : "."
        }`,
      );
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={
          children.length === 1
            ? `Roll "${children[0]!.name}" up into "${parent.name}"?`
            : `Roll the sub-codes of "${parent.name}" up into it?`
        }
        description={`${plural(total, "excerpt")} tagged with ${what} will be tagged with "${parent.name}" instead. An excerpt that already carries "${parent.name}" simply loses the sub-code.`}
      >
        <ul className="max-h-40 overflow-y-auto rounded-md border border-border text-sm">
          {children.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-2 py-1">
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="tabular-nums text-fg-muted">
                {plural(c.excerptCount, "excerpt")}
              </span>
            </li>
          ))}
        </ul>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={deleteEmptied}
            onChange={(e) => setDeleteEmptied(e.target.checked)}
            data-testid="roll-up-delete"
          />
          <span>
            Delete {children.length === 1 ? "the emptied sub-code" : "the emptied sub-codes"}{" "}
            afterwards
            <span className="block text-xs text-fg-muted">
              {deleteEmptied
                ? "Their own sub-codes move up to the parent. Deleting codes cannot be undone, and clears the undo history."
                : "Off: the sub-codes stay in the codebook with no excerpts, and the whole roll-up can be undone."}
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={deleteEmptied ? "danger" : "default"}
            disabled={rollUp.isPending}
            onClick={() => void run()}
            data-testid="roll-up-confirm"
          >
            {deleteEmptied ? "Roll up and delete" : "Roll up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
