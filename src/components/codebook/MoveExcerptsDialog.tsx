import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Code } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCodeTree } from "@/queries/codes";
import { useRetagCode } from "@/queries/excerpts";
import { flattenTree, matchesQuery, pathOf } from "@/core/codeTree";
import { ColorDot } from "./ColorSwatch";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";

/**
 * Re-tag every excerpt under one code with another. Unlike merging, both codes
 * survive — this is the "I split this theme in two" move — so it is undoable.
 */
export function MoveExcerptsDialog({ code, onClose }: { code: Code; onClose: () => void }) {
  const { t } = useTranslation();
  const tree = useCodeTree();
  const retag = useRetagCode();
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const candidates = flattenTree(tree).filter(
    (n) => n.code.id !== code.id && matchesQuery(tree, n.code.id, query),
  );
  const count = code.excerptCount;

  async function move() {
    if (!targetId) return;
    const target =
      tree.byId.get(targetId)?.code.name ?? t("codebook.moveExcerptsDialog.anotherCode");
    try {
      const report = await retag.mutateAsync({
        fromCodeId: code.id,
        toCodeId: targetId,
        label: t("codebook.moveExcerptsDialog.moveLabel", { count, target }),
      });
      const moved = report.moved.length + report.alreadyHad.length;
      toast.info(
        moved
          ? t("codebook.moveExcerptsDialog.moved", { count: moved, from: code.name, to: target })
          : t("codebook.moveExcerptsDialog.noneToMove", { name: code.name }),
      );
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("codebook.moveExcerptsDialog.title", { name: code.name })}
        description={t("codebook.moveExcerptsDialog.description", { count, name: code.name })}
      >
        <Input
          autoFocus
          placeholder={t("codebook.mergeDialog.filterCodes")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="mt-2 max-h-64 overflow-y-auto rounded-md border border-border">
          {candidates.map((n) => (
            <li key={n.code.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted",
                  targetId === n.code.id && "bg-muted font-medium",
                )}
                onClick={() => setTargetId(n.code.id)}
              >
                <ColorDot color={n.code.color} />
                <span className="truncate">{pathOf(tree, n.code.id)}</span>
              </button>
            </li>
          ))}
          {candidates.length === 0 ? (
            <li className="px-2 py-2 text-sm text-fg-muted">
              {t("codebook.mergeDialog.noOtherCodes")}
            </li>
          ) : null}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!targetId || retag.isPending} onClick={() => void move()}>
            {t("codebook.moveExcerptsDialog.moveExcerpts")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
