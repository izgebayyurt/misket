import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ProjectInfo } from "@/api/types";
import { useSaveProjectCopy } from "@/queries/backup";
import { useOpenProject, useRemoveRecent } from "@/queries/project";
import { toast } from "@/state/toasts";

const STORAGE_PREFIX = "misket:dismissedSyncWarning:";

/** Remembered per project path, in this browser only — a fresh dismissal is
 * needed on another machine, which is the point (that machine may not have
 * synced yet). */
function isDismissed(path: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + path) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed(path: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + path, "1");
  } catch {
    // Private browsing / blocked storage: it just asks again next time.
  }
}

const FILTER = [{ name: "Misket project", extensions: ["misket"] }];

/**
 * Shown once per project (dismissal remembered by path) when the open
 * project file lives inside a folder a cloud sync client manages — a
 * documented cause of SQLite corruption in other QDA tools. "Move project…"
 * writes a copy elsewhere, opens it, and removes the original from Recent
 * without deleting it.
 */
export function SyncWarningBanner({ project }: { project: ProjectInfo }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(() => isDismissed(project.path));
  const [moving, setMoving] = useState(false);
  const saveCopy = useSaveProjectCopy();
  const openProject = useOpenProject();
  const removeRecent = useRemoveRecent();

  if (!project.syncWarning || dismissed) return null;

  function onDismiss() {
    rememberDismissed(project.path);
    setDismissed(true);
  }

  async function onMove() {
    try {
      const path = await save({ defaultPath: `${project.name}.misket`, filters: FILTER });
      if (!path) return;
      const withExt = path.endsWith(".misket") ? path : `${path}.misket`;
      setMoving(true);
      const originalPath = project.path;
      await saveCopy.mutateAsync(withExt);
      await openProject.mutateAsync(withExt);
      removeRecent.mutate(originalPath);
      toast.info(t("syncWarning.moved"));
    } catch (e) {
      toast.error(e);
    } finally {
      setMoving(false);
    }
  }

  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-border bg-muted px-4 py-2 text-sm"
      data-testid="sync-warning-banner"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <p className="flex-1 leading-snug">{project.syncWarning}</p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void onMove()}
        disabled={moving}
        data-testid="move-project"
      >
        {moving ? t("syncWarning.moving") : t("syncWarning.moveProject")}
      </Button>
      <button
        className="rounded p-1 text-fg-muted hover:bg-panel"
        onClick={onDismiss}
        aria-label={t("common.dismiss")}
        data-testid="dismiss-sync-warning"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
