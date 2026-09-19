import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { onTranscriptionDone, onTranscriptionProgress } from "@/api/transcribe";
import { formatElapsed, formatEta } from "@/core/transcription";
import { keys } from "@/queries/keys";
import { useTranscription } from "@/state/transcription";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";

/**
 * The modal shown while a recording is being transcribed, plus the listeners
 * that drive it. Mounted once near the app root, like `OcrProgressDialog`.
 *
 * The events come from the backend thread (`commands::transcribe`), not from
 * a promise, because a two-hour interview is a long time to hold an `invoke`
 * open.
 */
export function TranscriptionProgressDialog() {
  const run = useTranscription((s) => s.run);
  const qc = useQueryClient();
  const openDocument = useWorkspace((s) => s.openDocument);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    let cancelled = false;
    const keep = (fn: () => void) => (cancelled ? fn() : unlisteners.push(fn));

    void onTranscriptionProgress((e) => {
      useTranscription.getState().update(e.documentId, e.percent, e.segmentsDone, e.eta);
    })
      .then(keep)
      .catch(() => {});

    void onTranscriptionDone((e) => {
      useTranscription.getState().finish(e.documentId);
      if (e.status === "cancelled") {
        toast.info("Transcription stopped.");
        return;
      }
      if (e.status === "failed") {
        toast.error(e.message ?? "Transcription failed.");
        return;
      }
      // The transcript is a new document, linked to the recording and
      // carrying anchors: `linkedMediaId`, `transcriptId` and `anchorCount`
      // all ride on the summaries the list and the viewers read.
      void qc.invalidateQueries({ queryKey: keys.documents });
      void qc.invalidateQueries({ queryKey: keys.document(e.documentId) });
      void qc.invalidateQueries({ queryKey: keys.allTranscriptAnchors });
      void qc.invalidateQueries({ queryKey: keys.history });
      toast.info(
        `Transcribed in ${formatElapsed(e.elapsedMs)}. Undo with Ctrl/⌘+Z if it is not what you wanted.`,
      );
      if (e.transcriptDocumentId) openDocument(e.transcriptDocumentId);
    })
      .then(keep)
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [qc, openDocument]);

  if (!run) return null;
  const eta = formatEta(run.eta);

  return (
    <Dialog open onOpenChange={() => useTranscription.getState().stop()}>
      <DialogContent title="Transcribing" description={run.name} className="max-w-sm">
        <div className="space-y-2">
          <p className="text-sm text-fg-muted" data-testid="transcription-progress-label">
            {run.percent > 0 ? `${run.percent}%` : "Reading the recording…"}
            {run.segmentsDone > 0
              ? ` · ${run.segmentsDone} segment${run.segmentsDone === 1 ? "" : "s"}`
              : ""}
            {eta ? ` · ${eta}` : ""}
          </p>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={`Transcribing ${run.name}`}
            aria-valuenow={run.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${run.percent}%` }}
            />
          </div>
          <p className="text-xs text-fg-muted">
            Running on this machine. You can keep working in other documents.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={run.stopping}
            onClick={() => useTranscription.getState().stop()}
            data-testid="transcription-cancel"
          >
            {run.stopping ? "Stopping…" : "Stop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
