import { useState } from "react";
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
        title={files.length === 1 ? "Import this recording?" : `Import ${files.length} recordings?`}
        description="Audio and video stay on disk: the project remembers where each file is rather than copying it in, so a project file with hours of interviews in it is still small enough to back up and email."
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
            Copy the files into the project folder
            <span className="block text-xs text-fg-muted">
              Puts a copy in <code>&lt;project&gt;.media/</code> next to the project file and points
              the documents at the copy, so the folder can be moved or shared as one piece. That
              needs {formatBytes(totalBytes)} of disk.
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => decide({ import: false })}>
            Cancel
          </Button>
          <Button onClick={() => decide({ import: true })} data-testid="media-import-confirm">
            Import
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
