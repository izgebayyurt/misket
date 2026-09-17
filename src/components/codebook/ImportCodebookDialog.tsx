import { useMemo, useState } from "react";
import type { CodebookImportMode } from "@/api/types";
import { previewCodebookImport, type CodebookImportPreview } from "@/core/codebookImport";
import { flattenTree, pathOf } from "@/core/codeTree";
import { useCodeTree, useCodes } from "@/queries/codes";
import { useImportCodebook } from "@/queries/codebook";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";
import { ColorDot } from "./ColorSwatch";

/**
 * Confirms and previews a codebook import already picked and read by the
 * caller (see `pickCodebookFile` in `CodeTree.tsx`). Import is not undoable
 * yet, so this dialog doubles as the confirmation.
 */
export function ImportCodebookDialog({
  path,
  text,
  onClose,
}: {
  path: string;
  text: string;
  onClose: () => void;
}) {
  const { data: codes } = useCodes();
  const tree = useCodeTree();
  const importCodebook = useImportCodebook();
  const [mode, setMode] = useState<CodebookImportMode>("merge");
  const [parentId, setParentId] = useState<string | null>(null);

  const existingPaths = useMemo(() => (codes ?? []).map((c) => pathOf(tree, c.id)), [codes, tree]);
  const preview = useMemo<
    { ok: true; value: CodebookImportPreview } | { ok: false; error: string }
  >(() => {
    try {
      return { ok: true, value: previewCodebookImport(text, existingPaths) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [text, existingPaths]);
  const parentCandidates = flattenTree(tree);

  async function confirm() {
    try {
      const report = await importCodebook.mutateAsync({
        path,
        mode,
        parentId: mode === "add-under" ? parentId : null,
      });
      const skipped = report.skippedShortcuts.length;
      toast.info(
        `Imported: ${report.created} created, ${report.matched} matched` +
          (skipped
            ? `, ${skipped} shortcut${skipped === 1 ? "" : "s"} skipped (already taken)`
            : "."),
      );
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }

  const fileName = path.split(/[\\/]/).pop();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Import codebook"
        description={`Importing ${fileName ?? path}. You can undo the whole import from History.`}
      >
        <div className="space-y-4">
          {preview.ok ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p>
                <span className="font-medium">{preview.value.totalCodes}</span> code
                {preview.value.totalCodes === 1 ? "" : "s"} in this{" "}
                {preview.value.format.toUpperCase()} file
                {preview.value.matchedCount > 0
                  ? ` — ${preview.value.matchedCount} match existing codes by name, ${preview.value.newCount} would be new.`
                  : "; none match an existing code by name."}
              </p>
            </div>
          ) : (
            <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              Could not read this file: {preview.error}
            </p>
          )}

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-fg-muted">Mode</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                className="mt-0.5"
                checked={mode === "merge"}
                onChange={() => setMode("merge")}
              />
              <span>
                <span className="font-medium">Merge</span> — match existing codes by name; fill in
                missing descriptions and colors, and add anything new.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                className="mt-0.5"
                checked={mode === "add-under"}
                onChange={() => setMode("add-under")}
              />
              <span>
                <span className="font-medium">Add under a code</span> — import everything as new,
                nested under a code you pick (or at the root), without matching.
              </span>
            </label>
          </fieldset>

          {mode === "add-under" ? (
            <div>
              <p className="mb-1 text-xs font-medium text-fg-muted">Parent (optional)</p>
              <ul className="max-h-40 overflow-y-auto rounded-md border border-border">
                <li>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center px-2 py-1.5 text-left text-sm hover:bg-muted",
                      parentId === null && "bg-muted font-medium",
                    )}
                    onClick={() => setParentId(null)}
                  >
                    At the root
                  </button>
                </li>
                {parentCandidates.map((n) => (
                  <li key={n.code.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted",
                        parentId === n.code.id && "bg-muted font-medium",
                      )}
                      onClick={() => setParentId(n.code.id)}
                    >
                      <ColorDot color={n.code.color} />
                      <span className="truncate">{pathOf(tree, n.code.id)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!preview.ok || importCodebook.isPending} onClick={confirm}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
