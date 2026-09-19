import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      return { ok: true, value: previewCodebookImport(text, existingPaths, t) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [text, existingPaths, t]);
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
        t("codebook.import.importedSummary", {
          created: report.created,
          matched: report.matched,
          skippedSuffix: skipped ? t("codebook.import.skippedSuffix", { count: skipped }) : ".",
        }),
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
        title={t("codebook.import.title")}
        description={t("codebook.import.description", { name: fileName ?? path })}
      >
        <div className="space-y-4">
          {preview.ok ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p>
                {t("codebook.import.summary", {
                  count: preview.value.totalCodes,
                  format: preview.value.format.toUpperCase(),
                  matchSuffix:
                    preview.value.matchedCount > 0
                      ? t("codebook.import.summaryMatched", {
                          matched: preview.value.matchedCount,
                          added: preview.value.newCount,
                        })
                      : t("codebook.import.summaryNoneMatched"),
                })}
              </p>
            </div>
          ) : (
            <p className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              {t("codebook.import.couldNotRead", { error: preview.error })}
            </p>
          )}

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-fg-muted">
              {t("codebook.import.mode")}
            </legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                className="mt-0.5"
                checked={mode === "merge"}
                onChange={() => setMode("merge")}
              />
              <span>
                <Trans
                  i18nKey="codebook.import.modeMerge"
                  components={{ b: <span className="font-medium" /> }}
                />
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
                <Trans
                  i18nKey="codebook.import.modeAddUnder"
                  components={{ b: <span className="font-medium" /> }}
                />
              </span>
            </label>
          </fieldset>

          {mode === "add-under" ? (
            <div>
              <p className="mb-1 text-xs font-medium text-fg-muted">
                {t("codebook.import.parentOptional")}
              </p>
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
                    {t("codebook.import.atRoot")}
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
            {t("common.cancel")}
          </Button>
          <Button disabled={!preview.ok || importCodebook.isPending} onClick={confirm}>
            {t("documents.importAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
