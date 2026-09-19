import { Film, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { posToMs } from "@/core/align";
import { formatTimecode } from "@/core/media";
import { useDocument } from "@/queries/documents";
import { useCodeRecordingForExcerpt, useTranscriptAnchors } from "@/queries/align";
import { usePlayRequest } from "@/state/playRequest";
import { useWorkspace } from "@/state/workspace";
import { Button } from "@/components/ui/button";
import { toast } from "@/state/toasts";

interface Props {
  excerptId: string;
  documentId: string;
  kind: string;
  startPos: number | null;
  endPos: number | null;
  /** The browser's rows want one small button; the inspector wants both. */
  compact?: boolean;
}

/**
 * What a passage of an aligned transcript can do with its recording: hear it,
 * and code the tape for it.
 *
 * Shown wherever an excerpt is (the inspector, the browser's rows) and only
 * when it earns its place: a text excerpt, in a document linked to a
 * recording, with an alignment to work out *when* from.
 */
export function TranscriptExcerptActions({
  excerptId,
  documentId,
  kind,
  startPos,
  endPos,
  compact,
}: Props) {
  const { t } = useTranslation();
  const isText = kind === "text" && startPos !== null && endPos !== null;
  const { data: doc } = useDocument(isText ? documentId : null);
  const linkedMediaId = doc?.linkedMediaId ?? null;
  const { data: anchors } = useTranscriptAnchors(documentId, isText && !!linkedMediaId);
  const codeRecording = useCodeRecordingForExcerpt();
  const openDocument = useWorkspace((s) => s.openDocument);

  if (!isText || !linkedMediaId || !anchors || anchors.length === 0) return null;
  const startMs = posToMs(anchors, startPos);
  const endMs = Math.max(startMs + 1, posToMs(anchors, endPos));

  /** Open the transcript (its strip is the player) and ask it to play. */
  const play = () => {
    openDocument(documentId);
    usePlayRequest.getState().play(documentId, startMs, endMs);
  };

  return (
    <div className={compact ? "flex shrink-0 items-center pr-3 pt-2.5" : "mt-2 flex gap-1.5"}>
      <Button
        size="sm"
        variant="ghost"
        onClick={play}
        title={t("excerpts.playRange", {
          start: formatTimecode(startMs),
          end: formatTimecode(endMs),
        })}
        aria-label={
          compact
            ? t("excerpts.playRange", {
                start: formatTimecode(startMs),
                end: formatTimecode(endMs),
              })
            : undefined
        }
        data-testid="play-excerpt"
      >
        <Play className="size-3.5" />
        {compact ? null : t("excerpts.playThis")}
      </Button>
      {compact ? null : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void codeRecording
              .mutateAsync(excerptId)
              .then(() => toast.info(t("excerpts.codedRecording")))
              .catch(toast.error)
          }
          title={t("excerpts.codeRecordingHint")}
          data-testid="code-recording"
        >
          <Film className="size-3.5" /> {t("excerpts.codeRecording")}
        </Button>
      )}
    </div>
  );
}
