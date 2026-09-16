import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useBackups, useRestoreBackup } from "@/queries/backup";
import { toast } from "@/state/toasts";
import type { BackupInfo } from "@/api/types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function BackupsDialog({ onClose }: { onClose: () => void }) {
  const { data: backups, isLoading } = useBackups();
  const restore = useRestoreBackup();
  const [pending, setPending] = useState<BackupInfo | null>(null);

  async function confirmRestore() {
    if (!pending) return;
    const path = pending.path;
    setPending(null);
    try {
      await restore.mutateAsync(path);
      toast.info(`Restored backup from ${fileName(path)}`);
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Backups"
        description="A timestamped copy is kept automatically before deletes and merges."
      >
        {isLoading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : !backups || backups.length === 0 ? (
          <p className="text-sm text-fg-muted">No backups yet.</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {backups.map((b) => (
              <li
                key={b.path}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">{new Date(b.createdAt).toLocaleString()}</div>
                  <div className="truncate text-xs text-fg-muted">
                    {b.reason} · {formatSize(b.sizeBytes)}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setPending(b)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
      {pending ? (
        <ConfirmDialog
          title="Restore this backup?"
          description="Replace the current project with this backup? A copy of the current state is kept first."
          confirmLabel="Restore"
          onConfirm={() => void confirmRestore()}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </Dialog>
  );
}
