import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Code } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useRollUpCodes } from "@/queries/excerpts";
import { toast } from "@/state/toasts";

/**
 * Second-cycle lumping: hand a sub-code's excerpts (or every sub-code's
 * excerpts) to the parent in one step, and decide separately whether the
 * emptied codes should go too.
 *
 * Keeping them is the default, because "lump these back together" is exactly
 * the move people want to try and then reconsider. Deleting them is a code
 * delete like any other — and, since the history keeps a snapshot of each
 * branch it removes, just as reversible.
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
  const { t } = useTranslation();
  const rollUp = useRollUpCodes();
  const [deleteEmptied, setDeleteEmptied] = useState(false);
  const total = children.reduce((n, c) => n + c.excerptCount, 0);
  const what =
    children.length === 1
      ? t("codebook.rollUp.quoted", { name: children[0]!.name })
      : t("codebook.rollUp.subcodeCount", { count: children.length });

  async function run() {
    try {
      const moved = await rollUp.mutateAsync({
        parentId: parent.id,
        childIds: children.map((c) => c.id),
        deleteEmptied,
        label:
          children.length === 1
            ? t("codebook.rollUp.labelOne", { child: children[0]!.name, parent: parent.name })
            : t("codebook.rollUp.labelMany", { count: children.length, parent: parent.name }),
      });
      toast.info(
        deleteEmptied
          ? t("codebook.rollUp.movedAndDeleted", {
              moved: t("excerpts.filters.total", { count: moved }),
              parent: parent.name,
              what,
            })
          : t("codebook.rollUp.moved", {
              moved: t("excerpts.filters.total", { count: moved }),
              parent: parent.name,
            }),
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
            ? t("codebook.rollUp.titleOne", { child: children[0]!.name, parent: parent.name })
            : t("codebook.rollUp.titleMany", { parent: parent.name })
        }
        description={t("codebook.rollUp.descriptionText", {
          total: t("excerpts.filters.total", { count: total }),
          what,
          parent: parent.name,
        })}
      >
        <ul className="max-h-40 overflow-y-auto rounded-md border border-border text-sm">
          {children.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-2 py-1">
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="tabular-nums text-fg-muted">
                {t("excerpts.filters.total", { count: c.excerptCount })}
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
            {t("codebook.rollUp.deleteEmptiedLabel", {
              what: t(
                children.length === 1
                  ? "codebook.rollUp.emptiedSingle"
                  : "codebook.rollUp.emptiedPlural",
              ),
            })}
            <span className="block text-xs text-fg-muted">
              {deleteEmptied
                ? t("codebook.rollUp.deleteEmptiedOnHint")
                : t("codebook.rollUp.deleteEmptiedOffHint")}
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={deleteEmptied ? "danger" : "default"}
            disabled={rollUp.isPending}
            onClick={() => void run()}
            data-testid="roll-up-confirm"
          >
            {t(deleteEmptied ? "codebook.rollUp.rollUpAndDelete" : "codebook.rollUp.rollUp")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
