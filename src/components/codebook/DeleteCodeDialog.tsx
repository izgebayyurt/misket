import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChildrenStrategy, Code, CodeImpact } from "@/api/types";
import { countCodeImpact } from "@/api/codes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useDeleteCode } from "@/queries/codes";
import { toast } from "@/state/toasts";
import { useWorkspace } from "@/state/workspace";

export function DeleteCodeDialog({ code, onClose }: { code: Code; onClose: () => void }) {
  const { t } = useTranslation();
  const [impact, setImpact] = useState<CodeImpact | null>(null);
  const [strategy, setStrategy] = useState<ChildrenStrategy>("promote");
  const del = useDeleteCode();
  useEffect(() => {
    countCodeImpact(code.id).then(setImpact).catch(toast.error);
  }, [code.id]);

  const hasChildren = (impact?.descendantCount ?? 0) > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("codebook.deleteDialog.title", { name: code.name })}
        description={t("codebook.deleteDialog.description")}
      >
        {impact ? (
          <div className="space-y-3 text-sm">
            <p>
              {impact.excerptCount === 0
                ? t("codebook.deleteDialog.noExcerpts")
                : t("codebook.deleteDialog.willLose", {
                    count: impact.excerptCount,
                    what: t(
                      hasChildren && strategy === "delete"
                        ? "codebook.deleteDialog.theseCodes"
                        : "codebook.deleteDialog.thisCode",
                    ),
                  })}
            </p>
            {hasChildren ? (
              <fieldset className="space-y-1.5">
                <legend className="text-xs font-medium text-fg-muted">
                  {t("codebook.deleteDialog.hasSubcodes", { count: impact.descendantCount })}
                </legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={strategy === "promote"}
                    onChange={() => setStrategy("promote")}
                  />
                  {t("codebook.deleteDialog.keepPromote")}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={strategy === "delete"}
                    onChange={() => setStrategy("delete")}
                  />
                  {t("codebook.deleteDialog.deleteSubcodesToo")}
                </label>
              </fieldset>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">{t("codebook.deleteDialog.checking")}</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={!impact || del.isPending}
            onClick={async () => {
              try {
                await del.mutateAsync({ id: code.id, children: strategy });
                const ws = useWorkspace.getState();
                if (ws.selectedCodeId === code.id) ws.setSelectedCodeId(null);
                onClose();
              } catch (e) {
                toast.error(e);
              }
            }}
          >
            {t("common.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
