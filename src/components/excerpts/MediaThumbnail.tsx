import { useState } from "react";
import { AudioLines } from "lucide-react";
import { thumbnailUrl } from "@/api/media";
import { peakSlice, waveformPath } from "@/core/media";
import { useDocuments } from "@/queries/documents";

interface Props {
  documentId: string;
  excerptId: string;
  startMs: number | null;
  endMs: number | null;
  width: number;
  height: number;
}

/**
 * What a coded stretch of a recording looks like in a list.
 *
 * Video gets the frame captured at its in-point (stored in `media_blobs` when
 * the excerpt was created, served at `/thumbnail/<excerptId>`); until one has
 * been captured — or for audio, which has no frame — it gets the slice of the
 * waveform it covers, which says as much about a stretch of tape as a
 * picture of a face would.
 */
export function MediaThumbnail({ documentId, excerptId, startMs, endMs, width, height }: Props) {
  const { data: docs } = useDocuments();
  const [frameFailed, setFrameFailed] = useState(false);
  const doc = docs?.find((d) => d.id === documentId);
  const media = doc?.media ?? null;
  const isVideo = (media?.mime ?? "").startsWith("video/");
  const peaks = peakSlice(media?.peaks, startMs ?? 0, endMs ?? 0, media?.durationMs ?? 0);

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted"
      style={{ width, height }}
      data-testid="media-thumbnail"
    >
      {isVideo && !frameFailed ? (
        <img
          src={thumbnailUrl(excerptId)}
          alt=""
          draggable={false}
          className="size-full object-cover"
          onError={() => setFrameFailed(true)}
        />
      ) : peaks.length > 0 ? (
        // The same envelope the timeline draws, stretched into the box: a
        // slice can be one peak or a thousand, and a path copes with both.
        <svg
          className="size-full"
          viewBox={`0 0 ${peaks.length} 2`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <g transform="translate(0 1)">
            <path d={waveformPath(peaks)} className="fill-fg-muted/60" />
          </g>
        </svg>
      ) : (
        <AudioLines className="size-5 text-fg-muted" aria-hidden="true" />
      )}
    </div>
  );
}
