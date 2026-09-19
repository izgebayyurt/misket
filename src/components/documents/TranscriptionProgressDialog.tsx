import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { onTranscriptionDone, onTranscriptionProgress } from "@/api/transcribe";
import { formatElapsed, formatEta } from "@/core/transcription";
import { describe } from "@/core/keymap";
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
  const { t } = useTranslation();
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
        toast.info(t("documents.transcribe.stopped"));
        return;
      }
      if (e.status === "failed") {
        toast.error(e.message ?? t("documents.transcribe.failed"));
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
        t("documents.transcribe.toastDone", {
          elapsed: formatElapsed(e.elapsedMs, t),
          shortcut: describe("undo"),
        }),
      );
      if (e.transcriptDocumentId) openDocument(e.transcriptDocumentId);
    })
      .then(keep)
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [qc, openDocument, t]);

  if (!run) return null;
  const eta = formatEta(run.eta, t);

  return (
    <Dialog open onOpenChange={() => useTranscription.getState().stop()}>
      <DialogContent
        title={t("documents.transcribe.progressTitle")}
        description={run.name}
        className="max-w-sm"
      >
        <div className="space-y-2">
          <p className="text-sm text-fg-muted" data-testid="transcription-progress-label">
            {run.percent > 0 ? `${run.percent}%` : t("documents.transcribe.readingRecording")}
            {run.segmentsDone > 0
              ? ` · ${t("documents.transcribe.segmentCount", { count: run.segmentsDone })}`
              : ""}
            {eta ? ` · ${eta}` : ""}
          </p>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={t("documents.transcribe.transcribingAriaLabel", { name: run.name })}
            aria-valuenow={run.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${run.percent}%` }}
            />
          </div>
          <p className="text-xs text-fg-muted">{t("documents.transcribe.runningLocallyHint")}</p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={run.stopping}
            onClick={() => useTranscription.getState().stop()}
            data-testid="transcription-cancel"
          >
            {run.stopping
              ? t("documents.transcribe.stoppingEllipsis")
              : t("documents.transcribe.stop")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
