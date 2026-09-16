import { useState } from "react";
import { MessagesSquare } from "lucide-react";
import { useTranscript } from "@/queries/transcripts";
import { formatLabel } from "@/core/transcriptFormats";
import { TranscriptFormatDialog } from "./TranscriptFormatDialog";

/**
 * "Transcript: Name:, 42 turns, 3 speakers" in the document header — what
 * Misket thinks this document is, and the way in to changing its mind.
 *
 * A document nobody has told otherwise shows nothing at all when it does not
 * look like a transcript; the dialog is still reachable from the menu beside
 * it, so a transcript Misket failed to recognize is not a dead end.
 */
export function TranscriptChip({ documentId }: { documentId: string }) {
  const { data } = useTranscript(documentId);
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

  return (
    <>
      <button
        className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:bg-muted"
        onClick={() => setOpen(true)}
        title="How this document marks who is speaking"
        data-testid="transcript-chip"
      >
        <MessagesSquare className="size-3" />
        <span className="max-w-64 truncate">Transcript: {summary}</span>
      </button>
      {open ? (
        <TranscriptFormatDialog documentId={documentId} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
