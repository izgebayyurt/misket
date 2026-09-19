import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useImportableFiles } from "@/queries/documents";
import { useImportFiles } from "./useImportFiles";
import { toast } from "@/state/toasts";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * Confirm what a picked folder holds before importing it. The files go through
 * the same per-file pipeline as a manual pick, so the tidy-whitespace prompt
 * and duplicate detection still apply.
 */
export function ImportFolderDialog({ dir, onClose }: { dir: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [recursive, setRecursive] = useState(false);
  const [importing, setImporting] = useState(false);
  const { data: files, isPending, error } = useImportableFiles(dir, recursive);
  const { importPaths } = useImportFiles();

  async function importAll() {
    if (!files?.length) return;
    setImporting(true);
    try {
      await importPaths(files);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("documents.importFolderTitle")}
        description={t("documents.importFolderDescription", { name: fileName(dir) })}
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
            data-testid="import-folder-recursive"
          />
          {t("documents.includeSubfolders")}
        </label>
        <div className="mt-3 rounded-md border border-border">
          <p className="border-b border-border px-2 py-1.5 text-xs text-fg-muted">
            {error
              ? t("documents.folderReadError")
              : isPending
                ? t("documents.scanning")
                : t("documents.filesToImport", { count: files?.length ?? 0 })}
          </p>
          <ul
            className="max-h-48 overflow-y-auto px-2 py-1 text-sm"
            data-testid="import-folder-list"
          >
            {files?.map((path) => (
              <li key={path} className="truncate py-0.5">
                {fileName(path)}
              </li>
            ))}
            {files && files.length === 0 ? (
              <li className="py-1 text-fg-muted">{t("documents.nothingImportable")}</li>
            ) : null}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!files?.length || importing}
            onClick={() => void importAll()}
            data-testid="import-folder-confirm"
          >
            {files?.length
              ? t("documents.importCount", { count: files.length })
              : t("documents.importAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
