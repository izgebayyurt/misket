import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { formatDuration } from "@/core/media";
import { useSettings } from "@/state/settings";
import {
  useMediaImportPrompt,
  type MediaImportFile,
  type MediaImportRequest,
} from "@/state/mediaImportPrompt";

/**
 * Asked once per batch of recordings, because how they are stored is the one
 * thing about importing audio and video that is not obvious.
 *
 * Rendered whenever `useMediaImportPrompt` has a pending request, near the
 * app root so both the picker and the drop zone reach it.
 */
export function MediaImportDialog() {
  const request = useMediaImportPrompt((s) => s.request);
  if (!request) return null;
  return <MediaImportDialogContent key={request.files.map((f) => f.path).join("|")} {...request} />;
}

function MediaImportDialogContent({ files, copyIntoProject }: MediaImportRequest) {
  const { t } = useTranslation();
  const [copy, setCopy] = useState(copyIntoProject);
  const respond = useMediaImportPrompt((s) => s.respond);
  const update = useSettings((s) => s.update);
  const totalBytes = files.reduce((n, f) => n + f.sizeBytes, 0);

  const decide = (choice: { import: boolean }) => {
    if (choice.import) {
      // The answer becomes the default for the next batch.
      update({ copyMediaIntoProject: copy });
      respond({ import: true, copyIntoProject: copy });
    } else {
      respond({ import: false });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && decide({ import: false })}>
      <DialogContent
        title={t("documents.importRecordingsTitle", { count: files.length })}
        description={t("documents.importRecordingsDescription")}
        className="max-w-xl"
      >
        <ul
          className="max-h-56 divide-y divide-border overflow-y-auto rounded border border-border"
          data-testid="media-import-list"
        >
          {files.map((f) => (
            <MediaRow key={f.path} file={f} />
          ))}
        </ul>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={copy}
            onChange={(e) => setCopy(e.target.checked)}
            data-testid="media-import-copy"
          />
          <span>
            {t("documents.copyIntoProjectFolder")}
            <span className="block text-xs text-fg-muted">
              <Trans
                i18nKey="documents.copyIntoProjectFolderHint"
                values={{ path: "<project>.media/", size: formatBytes(totalBytes) }}
                components={{ code: <code /> }}
              />
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => decide({ import: false })}>
            {t("common.cancel")}
          </Button>
          <Button
            autoFocus
            onClick={() => decide({ import: true })}
            data-testid="media-import-confirm"
          >
            {t("documents.importAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediaRow({ file }: { file: MediaImportFile }) {
  return (
    <li className="flex items-baseline gap-3 px-2.5 py-1.5 text-sm">
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="shrink-0 tabular-nums text-xs text-fg-muted">
        {formatDuration(file.durationMs)}
      </span>
      <span className="shrink-0 text-xs text-fg-muted">{formatBytes(file.sizeBytes)}</span>
    </li>
  );
}

function formatBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} GB`;
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)} MB`;
  return `${Math.max(1, Math.round(n / 1_000))} kB`;
}
