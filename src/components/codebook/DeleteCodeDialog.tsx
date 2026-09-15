import { useEffect, useState } from "react";
import type { ChildrenStrategy, Code, CodeImpact } from "@/api/types";
import { countCodeImpact } from "@/api/codes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useDeleteCode } from "@/queries/codes";
import { toast } from "@/state/toasts";
import { useWorkspace } from "@/state/workspace";

export function DeleteCodeDialog({ code, onClose }: { code: Code; onClose: () => void }) {
  const [impact, setImpact] = useState<CodeImpact | null>(null);
  const [strategy, setStrategy] = useState<ChildrenStrategy>("promote");
  const del = useDeleteCode();
  useEffect(() => {
    countCodeImpact(code.id).then(setImpact).catch(toast.error);
  }, [code.id]);

  const hasChildren = (impact?.descendantCount ?? 0) > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Delete "${code.name}"?`} description="This cannot be undone.">
        {impact ? (
          <div className="space-y-3 text-sm">
            <p>
              {impact.excerptCount === 0
                ? "No excerpts use this code."
                : `${impact.excerptCount} excerpt${impact.excerptCount === 1 ? "" : "s"} will lose ${hasChildren && strategy === "delete" ? "these codes" : "this code"}. The excerpts themselves are kept.`}
            </p>
            {hasChildren ? (
              <fieldset className="space-y-1.5">
                <legend className="text-xs font-medium text-fg-muted">
                  It has {impact.descendantCount} sub-code{impact.descendantCount === 1 ? "" : "s"}
                </legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={strategy === "promote"}
                    onChange={() => setStrategy("promote")}
                  />
                  Keep sub-codes and move them up one level
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={strategy === "delete"}
                    onChange={() => setStrategy("delete")}
                  />
                  Delete the sub-codes too
                </label>
              </fieldset>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">Checking…</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
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
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
