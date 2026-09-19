import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Code } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCodeTree, useMergeCode } from "@/queries/codes";
import { descendantIds, flattenTree, matchesQuery, pathOf } from "@/core/codeTree";
import { ColorDot } from "./ColorSwatch";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";

export function MergeCodeDialog({ code, onClose }: { code: Code; onClose: () => void }) {
  const { t } = useTranslation();
  const tree = useCodeTree();
  const merge = useMergeCode();
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const excluded = useMemo(() => descendantIds(tree, code.id), [tree, code.id]);
  const candidates = flattenTree(tree).filter(
    (n) => !excluded.has(n.code.id) && matchesQuery(tree, n.code.id, query),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("codebook.mergeDialog.title", { name: code.name })}
        description={t("codebook.mergeDialog.description")}
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
          <Button
            disabled={!targetId || merge.isPending}
            onClick={async () => {
              if (!targetId) return;
              try {
                await merge.mutateAsync({ sourceId: code.id, targetId });
                onClose();
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            {t("codebook.mergeDialog.merge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
