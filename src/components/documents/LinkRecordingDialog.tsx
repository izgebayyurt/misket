import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Film, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MEDIA_EXTENSIONS } from "@/core/media";
import { formatDuration } from "@/core/media";
import type { DocumentSummary } from "@/api/types";
import { useDocuments } from "@/queries/documents";
import { useLinkMediaDocument } from "@/queries/align";
import { historyBeginGroup, historyEndGroup } from "@/api/history";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/state/toasts";
import { cn } from "@/lib/utils";
import { useImportFiles } from "./useImportFiles";

/**
 * "Link recording…": pick the recording a transcript belongs to, or import
 * one and link it in the same step.
 *
 * The link lives on the text document (`documents.linked_media_id`), and
 * setting it is undoable on its own; importing-and-linking is wrapped in one
 * history group, so one undo takes both back.
 */
export function LinkRecordingDialog({
  doc,
  onClose,
}: {
  doc: DocumentSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: docs } = useDocuments();
  const link = useLinkMediaDocument();
  const { importPaths } = useImportFiles();
  const [picked, setPicked] = useState<string | null>(doc.linkedMediaId);
  const [importing, setImporting] = useState(false);

  const recordings = (docs ?? []).filter((d) => d.kind === "video");

  async function linkTo(mediaId: string) {
    try {
      await link.mutateAsync({ documentId: doc.id, mediaId });
      onClose();
    } catch (e) {
      toast.error(e);
    }
  }

  async function importAndLink() {
    const file = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Audio and video", extensions: [...MEDIA_EXTENSIONS] }],
    });
    if (typeof file !== "string") return;
    setImporting(true);
    await historyBeginGroup(t("documents.importedAndLinked", { name: doc.name }));
    try {
      const created = await importPaths([file], { openAfter: false });
      const mediaId = created[0];
      if (!mediaId) return;
      await link.mutateAsync({ documentId: doc.id, mediaId });
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      await historyEndGroup();
      setImporting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("documents.linkRecordingTitle", { name: doc.name })}
        description={t("documents.linkRecordingDescription")}
      >
        {recordings.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("documents.noRecordingsYet")}</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto" data-testid="link-recording-list">
            {recordings.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                    picked === r.id && "bg-muted",
                  )}
                  onClick={() => setPicked(r.id)}
                  onDoubleClick={() => void linkTo(r.id)}
                  aria-current={picked === r.id ? "true" : undefined}
                  data-testid="link-recording-item"
                >
                  <Film className="size-4 shrink-0 text-fg-muted" />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="shrink-0 text-xs text-fg-muted">
                    {formatDuration(r.media?.durationMs ?? 0)}
                  </span>
                  {r.transcriptId && r.transcriptId !== doc.id ? (
                    <span className="shrink-0 text-xs text-fg-muted">
                      {t("documents.alreadyTranscribed")}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => void importAndLink()}
            disabled={importing}
            data-testid="link-recording-import"
          >
            <Upload /> {t("documents.importRecordingEllipsis")}
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!picked || importing}
            onClick={() => picked && void linkTo(picked)}
            data-testid="link-recording-confirm"
          >
            {t("documents.link")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
