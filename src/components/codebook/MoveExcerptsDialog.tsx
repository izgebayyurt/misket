import { useState } from "react";
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
    const target = tree.byId.get(targetId)?.code.name ?? "another code";
    try {
      const report = await retag.mutateAsync({
        fromCodeId: code.id,
        toCodeId: targetId,
        label: `Move ${count} excerpt${count === 1 ? "" : "s"} to ${target}`,
      });
      const moved = report.moved.length + report.alreadyHad.length;
      toast.info(
        moved
          ? `Moved ${moved} excerpt${moved === 1 ? "" : "s"} from "${code.name}" to "${target}".`
          : `"${code.name}" has no excerpts to move.`,
      );
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Move excerpts from "${code.name}" to…`}
        description={`Its ${count} excerpt${count === 1 ? "" : "s"} are re-tagged with the code you pick. "${code.name}" stays in the codebook, with its sub-codes and memos, but loses its excerpts. This can be undone.`}
      >
        <Input
          autoFocus
          placeholder="Filter codes"
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
            <li className="px-2 py-2 text-sm text-fg-muted">No other codes.</li>
          ) : null}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!targetId || retag.isPending} onClick={() => void move()}>
            Move excerpts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
