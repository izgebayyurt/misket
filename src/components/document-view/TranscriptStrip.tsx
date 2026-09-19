import { AlertTriangle, Film, MapPin, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatTimecode, isVideoMime } from "@/core/media";
import type { DocumentSummary } from "@/api/types";
import { useWorkspace } from "@/state/workspace";
import { Button } from "@/components/ui/button";
import { describe } from "@/core/keymap";
import type { MediaPlayback } from "./useMediaPlayback";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface Props {
  /** The recording this transcript is linked to. */
  media: DocumentSummary;
  playback: MediaPlayback;
  followPlayback: boolean;
  onFollowPlaybackChange: (follow: boolean) => void;
  /** Drop an alignment point at the caret; absent while there is no caret. */
  onAlignHere: () => void;
  onPlaybackError: () => void;
  anchorCount: number;
}

/**
 * The player strip at the top of a transcript that is linked to a recording.
 *
 * Deliberately small: play/pause, where the playhead is, the speed, whether
 * the page should follow along, and "Align here". Everything else about a
 * recording — the waveform, in and out points, coding a stretch — belongs to
 * its own viewer, one click away.
 *
 * The element itself is here rather than in `DocumentView` so there is
 * exactly one player per document; the state behind it is shared with the
 * recording's own viewer by `useMediaPlayback`, so moving between the two
 * keeps the playhead.
 */
export function TranscriptStrip({
  media,
  playback,
  followPlayback,
  onFollowPlaybackChange,
  onAlignHere,
  onPlaybackError,
  anchorCount,
}: Props) {
  const { t } = useTranslation();
  const openDocument = useWorkspace((s) => s.openDocument);
  const { ref: playerRef, src, elementProps } = playback;
  const isVideo = isVideoMime(media.media?.mime ?? "");
  const durationMs = media.media?.durationMs ?? 0;

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-1.5 text-xs"
      data-testid="transcript-strip"
    >
      {media.mediaMissing ? (
        <span className="inline-flex items-center gap-1 text-danger">
          <AlertTriangle className="size-3.5" />
          {t("documentView.transcript.fileIsMissing")}
        </span>
      ) : (
        <>
          <button
            type="button"
            className="rounded p-1 text-fg-muted hover:bg-muted hover:text-fg"
            onClick={playback.togglePlay}
            aria-label={playback.playing ? t("documentView.pause") : t("documentView.play")}
            data-testid="transcript-play"
          >
            {playback.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <span className="tabular-nums text-fg-muted" data-testid="transcript-position">
            {formatTimecode(playback.positionMs)} / {formatTimecode(durationMs)}
          </span>
          <label className="flex items-center gap-1 text-fg-muted">
            {t("documentView.speed")}
            <select
              className="rounded border border-border bg-bg px-1 py-0.5 text-xs text-fg"
              value={playback.speed}
              onChange={(e) => playback.setSpeed(Number(e.target.value))}
              aria-label={t("documentView.playbackSpeed")}
              data-testid="transcript-speed"
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-fg-muted">
            <input
              type="checkbox"
              checked={followPlayback}
              onChange={(e) => onFollowPlaybackChange(e.target.checked)}
              data-testid="transcript-follow"
            />
            {t("documentView.transcript.followPlayback")}
          </label>
          <Button
            size="sm"
            variant="ghost"
            onClick={onAlignHere}
            title={t("documentView.transcript.alignHereHint", { chord: describe("alignHere") })}
            data-testid="transcript-align-here"
          >
            <MapPin className="size-3.5" /> {t("documentView.transcript.alignHere")}
          </Button>
          <span className="text-fg-muted" data-testid="transcript-anchor-count">
            {anchorCount === 0
              ? t("documentView.transcript.notAlignedYet")
              : t("documentView.transcript.alignmentPointCount", { count: anchorCount })}
          </span>
        </>
      )}
      <span className="flex-1" />
      <button
        type="button"
        className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-fg-muted hover:bg-muted hover:text-fg"
        onClick={() => openDocument(media.id)}
        title={t("documentView.transcript.openOwnViewer")}
        data-testid="transcript-open-recording"
      >
        <Film className="size-3.5 shrink-0" />
        <span className="max-w-48 truncate">{media.name}</span>
      </button>
      {/* One media element per document. A video shows a thumbnail-sized
          picture beside the controls; audio has nothing to show. Same as
          MediaView's own player: no caption track to wire a <track> to. */}
      {isVideo ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={playerRef}
          src={src ?? undefined}
          className="h-10 w-auto rounded bg-muted"
          preload="metadata"
          {...elementProps}
          onError={onPlaybackError}
          data-testid="transcript-player"
        />
      ) : (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          ref={playerRef}
          src={src ?? undefined}
          preload="metadata"
          {...elementProps}
          onError={onPlaybackError}
          data-testid="transcript-player"
        />
      )}
    </div>
  );
}
