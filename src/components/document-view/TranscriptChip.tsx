import { useState } from "react";
import { MessagesSquare } from "lucide-react";
import { useTranscript } from "@/queries/transcripts";
import { useDocument } from "@/queries/documents";
import { useBuildTranscriptAnchors, useSetTranscriptAnchors } from "@/queries/align";
import { formatLabel } from "@/core/transcriptFormats";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/state/toasts";
import { TranscriptFormatDialog } from "./TranscriptFormatDialog";

/**
 * "Transcript: Name:, 42 turns, 3 speakers" in the document header — what
 * Misket thinks this document is, and the way in to changing its mind.
 *
 * It is also where a transcript's alignment with its recording is built: a
 * format that captures a timestamp (`[00:12] Name:`, `Name (00:12):`) has
 * every anchor it needs written down already, and "Build anchors from
 * timestamps" reads them.
 *
 * A document nobody has told otherwise shows "Not a transcript" rather than
 * nothing, so a transcript Misket failed to recognize is never a dead end.
 */
export function TranscriptChip({ documentId }: { documentId: string }) {
  const { data } = useTranscript(documentId);
  const { data: doc } = useDocument(documentId);
  const build = useBuildTranscriptAnchors();
  const setAnchors = useSetTranscriptAnchors();
  const [open, setOpen] = useState(false);
  if (!data) return null;

  const turns = data.turns.length;
  const speakers = data.speakers.length;
  const summary =
    data.format.kind === "none" || turns === 0
      ? "Not a transcript"
      : `${formatLabel(data.format)}, ${turns} turn${turns === 1 ? "" : "s"}, ${speakers} speaker${
          speakers === 1 ? "" : "s"
        }`;

  const timed = data.turns.filter((t) => t.time).length;
  const linked = !!doc?.linkedMediaId;
  const anchorCount = doc?.anchorCount ?? 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:bg-muted"
            title="How this document marks who is speaking"
            data-testid="transcript-chip"
          >
            <MessagesSquare className="size-3" />
            <span className="max-w-64 truncate">Transcript: {summary}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem onSelect={() => setOpen(true)} data-testid="transcript-format-item">
            Transcript format…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {timed > 0 ? (
            <DropdownMenuItem
              onSelect={() =>
                void build
                  .mutateAsync(documentId)
                  .then((anchors) =>
                    toast.info(
                      `Built ${anchors.length} alignment point${
                        anchors.length === 1 ? "" : "s"
                      } from the timestamps.`,
                    ),
                  )
                  .catch(toast.error)
              }
              data-testid="build-anchors"
            >
              Build anchors from timestamps ({timed})
            </DropdownMenuItem>
          ) : null}
          {anchorCount > 0 ? (
            <DropdownMenuItem
              danger
              onSelect={() =>
                void setAnchors
                  .mutateAsync({ documentId, anchors: [] })
                  .then(() => toast.info("Cleared the alignment. Undo with Ctrl/⌘+Z."))
                  .catch(toast.error)
              }
              data-testid="clear-anchors"
            >
              Clear the alignment ({anchorCount})
            </DropdownMenuItem>
          ) : null}
          <p className="px-2 py-1 text-[11px] text-fg-muted">
            {!linked
              ? "Link a recording from the document’s menu to play along with the text."
              : anchorCount > 0
                ? "Click a paragraph to seek the recording; Ctrl/⌘+click for the exact spot."
                : timed > 0
                  ? "This transcript carries timestamps — build the anchors and it lines up with the recording."
                  : "Play the recording and press Alt+A to line the cursor up with it."}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      {open ? (
        <TranscriptFormatDialog documentId={documentId} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
