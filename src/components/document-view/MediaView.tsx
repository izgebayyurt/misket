import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Pause, Play } from "lucide-react";
import { loadMediaServer, mediaFileUrl, mediaServer } from "@/api/media";
import { useCodes } from "@/queries/codes";
import { useApplyCodes, useDeleteExcerpt, useDocumentExcerpts } from "@/queries/excerpts";
import {
  useDocument,
  useSetExcerptThumbnail,
  useSetMediaMeasurements,
  useSetMediaPeaks,
} from "@/queries/documents";
import { useRelinkMedia } from "@/components/documents/useRelinkMedia";
import { useProjectInfo } from "@/queries/project";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "@/queries/keys";
import {
  clampPosition,
  downsamplePeaks,
  formatDuration,
  formatTimecode,
  isCodableRange,
  isVideoMime,
  MIN_RANGE_MS,
  setInPoint,
  setOutPoint,
  unsupportedHint,
  waveformPath,
  type MediaRange,
} from "@/core/media";
import { extensionOf } from "@/core/importers";
import { isTextField, matchMediaAction, MEDIA_SEEK_MS, MEDIA_STEP_MS } from "@/core/keymap";
import { useWorkspace } from "@/state/workspace";
import { useShortcutActions } from "@/state/shortcutActions";
import { useSettings } from "@/state/settings";
import { useReadingPositions } from "@/state/readingPositions";
import { toast, TOAST_KEYS } from "@/state/toasts";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DocumentTitle } from "./DocumentTitle";

/** How many peaks a waveform is reduced to; a timeline is ~1000 px wide. */
const PEAK_COUNT = 1500;

/**
 * Caps on computing a waveform. Decoding audio costs roughly
 * `duration x sampleRate x 4` bytes of PCM, so a long recording is left with
 * a plain timeline rather than risking the webview. Everything else about the
 * viewer — seeking, bands, in/out points, coding — works either way.
 */
const MAX_PEAK_DURATION_MS = 45 * 60 * 1000;
const MAX_PEAK_BYTES = 150 * 1024 * 1024;

/** Match `CHUNK` in `src-tauri/src/media.rs`: one ranged response's size. */
const FETCH_CHUNK = 4 * 1024 * 1024;

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** The height of one excerpt band and the gap under the waveform. */
const BAND_HEIGHT = 10;
const BAND_GAP = 2;

interface Props {
  documentId: string;
  /** Focus this excerpt and seek to its in-point once the excerpts load. */
  focusExcerptId?: string;
  /**
   * Seek here on arrival, in milliseconds, when there is no excerpt to focus.
   * The history panel uses it to show where a deleted stretch was.
   */
  seekToMs?: number;
}

interface Band {
  id: string;
  startMs: number;
  endMs: number;
  color: string;
  codeCount: number;
  label: string;
}

/**
 * Audio and video documents.
 *
 * The file is held by reference (`documents.sourcePath`) and served through
 * the `misket-media` protocol, which answers range requests so the element
 * can seek. Under the player is a timeline: the waveform if one could be
 * computed, one band per coded stretch, and the playhead. `[` and `]` mark an
 * in- and an out-point, which become the workspace's pending selection — so
 * the code palette and the code hotkeys apply codes to a stretch of tape
 * exactly as they do to selected text.
 */
export function MediaView({ documentId, focusExcerptId, seekToMs }: Props) {
  const { data: doc, error } = useDocument(documentId);
  const { data: excerpts } = useDocumentExcerpts(documentId);
  const { data: codes } = useCodes();
  const { data: projectInfo } = useProjectInfo();
  const applyCodes = useApplyCodes();
  const deleteExcerpt = useDeleteExcerpt();
  const relink = useRelinkMedia();
  const setPeaks = useSetMediaPeaks();
  const setThumbnail = useSetExcerptThumbnail();
  const setMeasurements = useSetMediaMeasurements();
  const qc = useQueryClient();

  const rootRef = useRef<HTMLDivElement>(null);
  // The keys read the position from a ref: `timeupdate` fires several times a
  // second, and re-registering a listener that often would be silly.
  const positionRef = useRef(0);
  const playerRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const pending = useWorkspace((s) => s.pendingSelection);
  const setPending = useWorkspace((s) => s.setPendingSelection);
  const focusedId = useWorkspace((s) => s.focusedExcerptId);
  const setFocusedId = useWorkspace((s) => s.setFocusedExcerptId);
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);

  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  // Where a media element can reach a recording (`src/api/media.ts`). Asked
  // for once per run; `null` while the answer is still on its way.
  const [serverReady, setServerReady] = useState(() => !!mediaServer());
  const [renaming, setRenaming] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const media = doc?.media ?? null;
  const durationMs = media?.durationMs ?? 0;
  const isVideo = isVideoMime(media?.mime ?? "");
  const missing = doc?.mediaMissing ?? false;
  const ext = extensionOf(doc?.sourcePath ?? "");
  const projectPath = projectInfo?.path ?? "";

  useEffect(() => {
    if (serverReady) return;
    let cancelled = false;
    void loadMediaServer().then((info) => {
      if (cancelled) return;
      if (info) setServerReady(true);
      else
        setPlaybackError(
          "Misket could not open the local connection it plays recordings through, so this one cannot be played. Restarting the app usually fixes it.",
        );
    });
    return () => {
      cancelled = true;
    };
  }, [serverReady]);

  const src = serverReady ? mediaFileUrl(documentId) : null;

  const colorById = useMemo(() => new Map((codes ?? []).map((c) => [c.id, c.color])), [codes]);

  /** Coded stretches, earliest first; each becomes one band row. */
  const bands = useMemo<Band[]>(() => {
    const out: Band[] = [];
    for (const e of excerpts ?? []) {
      if (e.kind !== "video_range" || e.startPos === null || e.endPos === null) continue;
      out.push({
        id: e.id,
        startMs: e.startPos,
        endMs: e.endPos,
        color: colorById.get(e.codeIds[0] ?? "") ?? "#9a9a9a",
        codeCount: e.codeIds.length,
        label: e.snapshot ?? "",
      });
    }
    return out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  }, [excerpts, colorById]);

  /** The marked stretch, when it belongs to this document. */
  const range = useMemo<MediaRange | null>(
    () =>
      pending?.kind === "media" && pending.documentId === documentId
        ? { startMs: pending.startMs, endMs: pending.endMs }
        : null,
    [documentId, pending],
  );

  const markRange = useCallback(
    (next: MediaRange | null) => {
      setPending(next ? { documentId, kind: "media", ...next } : null);
    },
    [documentId, setPending],
  );

  // --- the player ----------------------------------------------------------

  /** Record where the player is, for the render and for the keys. */
  const notePosition = useCallback((ms: number) => {
    positionRef.current = ms;
    setPositionMs(ms);
  }, []);

  /**
   * The furthest the playhead goes. Not the last millisecond: seeking a
   * WebKit media element to exactly the end makes it ask the server for
   * `Range: bytes=<length>-`, which is by definition unsatisfiable — the
   * loopback server answers `416`, as any HTTP server would, and WebKit
   * turns that into `MEDIA_ERR_NETWORK` and stops playing (measured in
   * `e2e/`). A playhead 100 ms from the end is the same thing to a coder,
   * and an out-point can still reach the very end (`atEnd` below).
   */
  const playableLimit = Math.max(0, durationMs - MIN_RANGE_MS);

  const seekTo = useCallback(
    (ms: number) => {
      const player = playerRef.current;
      const at = clampPosition(ms, playableLimit);
      notePosition(at);
      if (player) player.currentTime = at / 1000;
    },
    [notePosition, playableLimit],
  );

  /**
   * Where an in- or out-point goes when the playhead is as far as it can go:
   * the coder means "the end of the recording", not "100 ms before it".
   */
  const markAt = useCallback(
    () => (positionRef.current >= playableLimit ? durationMs : positionRef.current),
    [durationMs, playableLimit],
  );

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.paused) void player.play().catch(() => setPlaying(false));
    else player.pause();
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (player) player.playbackRate = speed;
  }, [speed, playbackError]);

  // Remembered playback position, reused from the text viewer's store: both
  // answer "where had I got to in this document", one in code points and one
  // in milliseconds.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!projectPath || !doc || restored.current === documentId) return;
    restored.current = documentId;
    if (focusExcerptId) return;
    // Somewhere a caller asked for beats where the reader left off.
    const at = seekToMs ?? useReadingPositions.getState().recall(projectPath, documentId);
    if (at === null || at <= 0 || at >= durationMs) return;
    // After this render: the element has to exist before it can be seeked.
    const raf = requestAnimationFrame(() => seekTo(at));
    return () => cancelAnimationFrame(raf);
    // Only on first arrival at a document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, !!doc, projectPath]);

  useEffect(() => {
    if (!projectPath || positionMs <= 0) return;
    const t = setTimeout(
      () => useReadingPositions.getState().remember(projectPath, documentId, positionMs),
      600,
    );
    return () => clearTimeout(t);
  }, [documentId, positionMs, projectPath]);

  // --- jumping in from the excerpt browser ---------------------------------
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    if (!focusExcerptId || bands.length === 0 || jumped.current === focusExcerptId) return;
    const band = bands.find((b) => b.id === focusExcerptId);
    if (!band) return;
    jumped.current = focusExcerptId;
    setFocusedId(focusExcerptId);
    const raf = requestAnimationFrame(() => seekTo(band.startMs));
    return () => cancelAnimationFrame(raf);
  }, [bands, focusExcerptId, seekTo, setFocusedId]);

  /**
   * What the player now knows about the file, for a document imported
   * without it: a REFI-QDA package names a recording but records no
   * duration, and without one there is no timeline to code against.
   */
  const measured = useRef<string | null>(null);
  const onLoadedMetadata = useCallback(() => {
    const player = playerRef.current;
    if (!player || measured.current === documentId) return;
    const seconds = player.duration;
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const ms = Math.round(seconds * 1000);
    const width = (player as HTMLVideoElement).videoWidth ?? 0;
    const height = (player as HTMLVideoElement).videoHeight ?? 0;
    const knownSize = (media?.width ?? 0) > 0;
    if (ms <= durationMs && (knownSize || width === 0)) return;
    measured.current = documentId;
    setMeasurements.mutate({ id: documentId, durationMs: ms, width, height });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, durationMs, media?.width]);

  // --- the waveform --------------------------------------------------------
  const peaks = media?.peaks ?? null;
  const computing = useRef<string | null>(null);
  useEffect(() => {
    if (!doc || missing || peaks || !serverReady || computing.current === documentId) return;
    if (durationMs <= 0 || durationMs > MAX_PEAK_DURATION_MS) return;
    if ((media?.sizeBytes ?? 0) > MAX_PEAK_BYTES) return;
    computing.current = documentId;
    let cancelled = false;
    void (async () => {
      const computed = await computePeaks(documentId, media?.sizeBytes ?? 0);
      if (cancelled || !computed || computed.length === 0) return;
      try {
        await setPeaks.mutateAsync({ id: documentId, peaks: computed });
      } catch {
        // The waveform is a cache; a failed write just means no waveform.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once per document, as soon as it is known to have no peaks yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, !!doc, missing, !!peaks, durationMs, serverReady]);

  // --- coding --------------------------------------------------------------

  /**
   * Capture the frame showing at a video excerpt's in-point and store it.
   *
   * Drawn from the live element rather than a second hidden one: it is
   * already decoded and already at (or near) that position, which is the
   * cheapest frame available. Audio has no frame — the browser shows its
   * waveform slice instead.
   */
  const captureThumbnail = useCallback(
    async (excerptId: string, atMs: number) => {
      const player = playerRef.current;
      if (!isVideo || !player || player.readyState < 2) return;
      try {
        const width = 192;
        const height = Math.max(
          1,
          Math.round((width * (player.videoHeight || 9)) / (player.videoWidth || 16)),
        );
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await seekAndWait(player, atMs / 1000);
        ctx.drawImage(player, 0, 0, width, height);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.6),
        );
        if (!blob) return;
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        await setThumbnail.mutateAsync({ excerptId, mime: "image/jpeg", bytes });
      } catch {
        // A frame is a nicety; a tainted canvas or a stubborn seek is not an
        // error the coder needs to hear about.
      }
    },
    [isVideo, setThumbnail],
  );

  const codeRange = useCallback(
    async (codeIds: string[]) => {
      const target = range;
      if (!isCodableRange(target, durationMs)) return false;
      try {
        const result = await applyCodes.mutateAsync({
          documentId,
          kind: "video_range",
          startPos: target.startMs,
          endPos: target.endMs,
          codeIds,
        });
        markRange(null);
        setFocusedId(result.excerpt.id);
        void captureThumbnail(result.excerpt.id, target.startMs);
        return true;
      } catch (e) {
        toast.error(e);
        return false;
      }
    },
    [applyCodes, captureThumbnail, documentId, durationMs, markRange, range, setFocusedId],
  );

  /** One code onto the marked stretch, else onto the focused band. */
  const applyCodeToTarget = useCallback(
    (codeId: string): boolean => {
      if (isCodableRange(range, durationMs)) {
        void codeRange([codeId]);
        return true;
      }
      const band = bands.find((b) => b.id === focusedId);
      if (!band) return false;
      applyCodes.mutate({
        documentId,
        kind: "video_range",
        startPos: band.startMs,
        endPos: band.endMs,
        codeIds: [codeId],
      });
      return true;
    },
    [applyCodes, bands, codeRange, documentId, durationMs, focusedId, range],
  );

  const moveFocus = useCallback(
    (delta: 1 | -1) => {
      if (bands.length === 0) return;
      const idx = focusedId ? bands.findIndex((b) => b.id === focusedId) : -1;
      const at =
        idx === -1
          ? delta === 1
            ? 0
            : bands.length - 1
          : (idx + delta + bands.length) % bands.length;
      const next = bands[at];
      if (!next) return;
      setFocusedId(next.id);
      seekTo(next.startMs);
    },
    [bands, focusedId, seekTo, setFocusedId],
  );

  // Enter and the palette chord act on the marked stretch; Tab walks the
  // bands; Backspace deletes the focused one — the same contract the text and
  // image viewers register.
  useEffect(() => {
    return useShortcutActions.getState().register({
      nextExcerpt: () => moveFocus(1),
      prevExcerpt: () => moveFocus(-1),
      editExcerpt: () => {
        if (isCodableRange(range, durationMs) || focusedId) setPaletteOpen(true);
      },
      deleteExcerpt: () => {
        if (!focusedId) return;
        if (useSettings.getState().settings.confirmDeleteExcerpt) setConfirmDeleteId(focusedId);
        else deleteExcerpt.mutate({ id: focusedId, documentId });
      },
      quickCode: () => {
        const codeId = useWorkspace.getState().lastAppliedCodeId;
        if (!codeId) {
          toast.info("No code has been applied yet — pick one from the palette first.", {
            key: TOAST_KEYS.quickCode,
          });
          return;
        }
        if (!applyCodeToTarget(codeId))
          toast.info("Mark a stretch with [ and ] to code it first.", {
            key: TOAST_KEYS.mediaTarget,
          });
      },
      escape: () => {
        const ws = useWorkspace.getState();
        if (ws.pendingSelection) {
          ws.setPendingSelection(null);
          return;
        }
        ws.setFocusedExcerptId(null);
      },
    });
  }, [
    applyCodeToTarget,
    deleteExcerpt,
    documentId,
    durationMs,
    focusedId,
    moveFocus,
    range,
    setPaletteOpen,
  ]);

  // --- the media keys ------------------------------------------------------
  const hasFocus = useCallback(() => {
    const root = rootRef.current;
    const active = document.activeElement;
    if (!root) return false;
    // "The player has the focus" also covers "nothing in particular does",
    // which is where focus sits right after opening a document.
    return !active || active === document.body || root.contains(active);
  }, []);

  const shortcutToCode = useMemo(
    () => new Map((codes ?? []).filter((c) => c.shortcut).map((c) => [c.shortcut!, c.id])),
    [codes],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (useWorkspace.getState().paletteOpen || !hasFocus()) return;
      const action = matchMediaAction(e);
      if (action) {
        e.preventDefault();
        const at = positionRef.current;
        switch (action) {
          case "mediaPlayPause":
            togglePlay();
            return;
          case "mediaBack":
            seekTo(at - MEDIA_SEEK_MS);
            return;
          case "mediaForward":
            seekTo(at + MEDIA_SEEK_MS);
            return;
          case "mediaStepBack":
            seekTo(at - MEDIA_STEP_MS);
            return;
          case "mediaStepForward":
            seekTo(at + MEDIA_STEP_MS);
            return;
          case "mediaSetIn":
            markRange(setInPoint(range, markAt(), durationMs));
            return;
          case "mediaSetOut":
            markRange(setOutPoint(range, markAt(), durationMs));
            return;
        }
      }
      // A code's own hotkey, as in the text and image viewers.
      if (isTextField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;
      const codeId = shortcutToCode.get(e.key.toLowerCase());
      if (codeId && applyCodeToTarget(codeId)) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    applyCodeToTarget,
    durationMs,
    hasFocus,
    markAt,
    markRange,
    range,
    seekTo,
    shortcutToCode,
    togglePlay,
  ]);

  /**
   * A player that will not start is usually a codec this build cannot
   * decode — but it is also what a file deleted a moment ago looks like, so
   * the row is re-read before anything is claimed about the codec.
   */
  const onPlaybackError = useCallback(() => {
    void qc.invalidateQueries({ queryKey: keys.document(documentId) });
    void qc.invalidateQueries({ queryKey: keys.documents });
    setPlaybackError(unsupportedHint(doc?.name ?? "This recording", ext));
  }, [doc?.name, documentId, ext, qc]);

  // --- relinking -----------------------------------------------------------
  const pickRelink = useCallback(async () => {
    if (await relink.pickAndRelink(documentId)) setPlaybackError(null);
  }, [documentId, relink]);

  // --- the timeline --------------------------------------------------------
  const fraction = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  const scrubTo = useCallback(
    (clientX: number) => {
      const el = timelineRef.current;
      if (!el || durationMs <= 0) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;
      seekTo(((clientX - r.left) / r.width) * durationMs);
    },
    [durationMs, seekTo],
  );

  if (error) return <div className="p-6 text-danger">{String(error)}</div>;
  if (!doc) return null;

  const codable = isCodableRange(range, durationMs);

  return (
    <div
      ref={rootRef}
      className="flex h-full flex-col"
      data-testid="media-view"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "F2" || isTextField(e.target)) return;
        e.preventDefault();
        setRenaming(true);
      }}
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <DocumentTitle
          documentId={documentId}
          name={doc.name}
          editing={renaming}
          onEditingChange={setRenaming}
          className="min-w-0 max-w-80 truncate font-serif text-lg font-medium"
        />
        <span className="shrink-0 text-xs text-fg-muted" data-testid="media-duration">
          {isVideo ? "video" : "audio"} · {formatDuration(durationMs)}
        </span>
        {missing ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded bg-danger/10 px-1.5 py-0.5 text-xs text-danger"
            data-testid="media-missing-badge"
          >
            <AlertTriangle className="size-3.5" />
            File missing
          </span>
        ) : null}
        <span className="flex-1" />
        <span className="hidden text-xs text-fg-muted lg:inline">
          space plays · J/L ±5s · [ and ] mark in and out
        </span>
        <label className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
          Speed
          <select
            className="rounded border border-border bg-bg px-1 py-0.5 text-xs text-fg"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            aria-label="Playback speed"
            data-testid="media-speed"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {missing ? (
          <MissingMediaNotice
            name={doc.name}
            sourcePath={doc.sourcePath}
            onRelink={() => void pickRelink()}
            pending={relink.isPending}
          />
        ) : (
          <>
            <div
              className={`flex min-h-0 items-center justify-center bg-muted ${
                isVideo ? "flex-1 p-2" : "px-4 py-6"
              }`}
            >
              {playbackError ? (
                <PlaybackErrorNotice message={playbackError} onRelink={() => void pickRelink()} />
              ) : isVideo ? (
                <video
                  ref={playerRef}
                  src={src ?? undefined}
                  className="max-h-full max-w-full"
                  preload="metadata"
                  onClick={togglePlay}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onLoadedMetadata={onLoadedMetadata}
                  onTimeUpdate={(e) => notePosition(Math.round(e.currentTarget.currentTime * 1000))}
                  onError={onPlaybackError}
                  data-testid="media-player"
                />
              ) : (
                <audio
                  ref={playerRef}
                  src={src ?? undefined}
                  className="w-full max-w-2xl"
                  controls
                  preload="metadata"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onLoadedMetadata={onLoadedMetadata}
                  onTimeUpdate={(e) => notePosition(Math.round(e.currentTarget.currentTime * 1000))}
                  onError={onPlaybackError}
                  data-testid="media-player"
                />
              )}
            </div>

            <div className="border-t border-border px-4 py-3">
              <div className="mb-2 flex items-center gap-3">
                <button
                  type="button"
                  className="rounded p-1 text-fg-muted hover:bg-muted hover:text-fg"
                  onClick={togglePlay}
                  aria-label={playing ? "Pause" : "Play"}
                  data-testid="media-play"
                >
                  {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                </button>
                <span className="text-xs tabular-nums text-fg-muted" data-testid="media-position">
                  {formatTimecode(positionMs)} / {formatTimecode(durationMs)}
                </span>
                <span className="flex-1" />
                <InOutControls
                  range={range}
                  onSetIn={() => markRange(setInPoint(range, markAt(), durationMs))}
                  onSetOut={() => markRange(setOutPoint(range, markAt(), durationMs))}
                  onClear={() => markRange(null)}
                  onCode={() => setPaletteOpen(true)}
                  codable={codable}
                />
              </div>

              <Timeline
                ref={timelineRef}
                peaks={peaks}
                bands={bands}
                durationMs={durationMs}
                fraction={fraction}
                range={range}
                focusedId={focusedId}
                onScrub={scrubTo}
                onPickBand={(id, startMs) => {
                  setFocusedId(id);
                  seekTo(startMs);
                }}
              />
            </div>
          </>
        )}
      </div>

      {confirmDeleteId ? (
        <ConfirmDialog
          title="Delete this excerpt?"
          description="Its codes and memos go with it. You can undo with Ctrl/⌘+Z."
          onConfirm={() => {
            deleteExcerpt.mutate({ id: confirmDeleteId, documentId });
            setConfirmDeleteId(null);
          }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      ) : null}
    </div>
  );
}

/** Seek and wait for the frame to be there, so a capture is not of the old one. */
function seekAndWait(player: HTMLVideoElement, seconds: number): Promise<void> {
  if (Math.abs(player.currentTime - seconds) < 0.05) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      player.removeEventListener("seeked", done);
      resolve();
    };
    player.addEventListener("seeked", done, { once: true });
    player.currentTime = seconds;
    setTimeout(done, 1500);
  });
}

/**
 * Read the whole file through the media protocol and reduce it to peaks.
 *
 * The protocol caps one response at `CHUNK` bytes, so this asks for explicit
 * ranges and joins them. Decoding happens in an `OfflineAudioContext` at
 * 8 kHz: a waveform only needs to show where the loud parts are, and a low
 * rate keeps a long recording's PCM to a size a webview can hold. Video is
 * decoded the same way, through its audio track.
 */
async function computePeaks(documentId: string, sizeBytes: number): Promise<number[] | null> {
  try {
    const url = mediaFileUrl(documentId);
    if (!url) return null;
    const parts: Uint8Array[] = [];
    let at = 0;
    let total = sizeBytes;
    do {
      const res = await fetch(url, { headers: { Range: `bytes=${at}-${at + FETCH_CHUNK - 1}` } });
      if (!res.ok) return null;
      const contentRange = res.headers.get("content-range");
      const stated = contentRange?.match(/\/(\d+)$/)?.[1];
      if (stated) total = Number(stated);
      const chunk = new Uint8Array(await res.arrayBuffer());
      if (chunk.byteLength === 0) break;
      parts.push(chunk);
      at += chunk.byteLength;
      if (res.status !== 206) break;
    } while (at < total && at < MAX_PEAK_BYTES);

    const joined = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let offset = 0;
    for (const p of parts) {
      joined.set(p, offset);
      offset += p.byteLength;
    }

    const Offline = window.OfflineAudioContext;
    if (!Offline) return null;
    const ctx = new Offline(1, 1, 8000);
    // Older WebKit only has the callback form; newer ones return a promise.
    const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
      const maybe = ctx.decodeAudioData(joined.buffer as ArrayBuffer, resolve, reject);
      if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
    });
    return downsamplePeaks(buffer.getChannelData(0), PEAK_COUNT);
  } catch {
    // No audio track, a codec the webview cannot decode, a file that moved
    // mid-read: the timeline simply goes without a waveform.
    return null;
  }
}

function InOutControls({
  range,
  onSetIn,
  onSetOut,
  onClear,
  onCode,
  codable,
}: {
  range: MediaRange | null;
  onSetIn: () => void;
  onSetOut: () => void;
  onClear: () => void;
  onCode: () => void;
  codable: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Button size="sm" variant="ghost" onClick={onSetIn} title="Set the in-point here ( [ )">
        Set in
      </Button>
      <Button size="sm" variant="ghost" onClick={onSetOut} title="Set the out-point here ( ] )">
        Set out
      </Button>
      {range ? (
        <span className="tabular-nums text-fg-muted" data-testid="media-range">
          [{formatTimecode(range.startMs)}–{formatTimecode(range.endMs)}]
        </span>
      ) : (
        <span className="text-fg-muted">no stretch marked</span>
      )}
      {codable ? (
        <>
          <Button size="sm" onClick={onCode} data-testid="media-code">
            Code
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </>
      ) : null}
    </div>
  );
}

interface TimelineProps {
  ref: React.Ref<HTMLDivElement>;
  peaks: readonly number[] | null;
  bands: Band[];
  durationMs: number;
  fraction: number;
  range: MediaRange | null;
  focusedId: string | null;
  onScrub: (clientX: number) => void;
  onPickBand: (id: string, startMs: number) => void;
}

/**
 * The waveform, the marked stretch, the playhead and one row per coded
 * stretch. Positions are percentages of the duration, so nothing has to be
 * measured and the whole thing reflows with the window.
 */
function Timeline({
  ref,
  peaks,
  bands,
  durationMs,
  fraction,
  range,
  focusedId,
  onScrub,
  onPickBand,
}: TimelineProps) {
  const pct = (ms: number) => (durationMs > 0 ? (ms / durationMs) * 100 : 0);
  return (
    <div className="select-none" data-testid="media-timeline">
      <div
        ref={ref}
        className="relative h-16 cursor-pointer overflow-hidden rounded border border-border bg-muted"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onScrub(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) onScrub(e.clientX);
        }}
        data-testid="media-scrubber"
      >
        {peaks && peaks.length > 0 ? (
          // One path in peak coordinates, stretched to the timeline's width:
          // a couple of thousand peaks cannot be a couple of thousand
          // elements in a few hundred pixels.
          <svg
            className="absolute inset-0 size-full"
            viewBox={`0 0 ${peaks.length} 2`}
            preserveAspectRatio="none"
            aria-hidden="true"
            data-testid="media-waveform"
          >
            <g transform="translate(0 1)">
              <path d={waveformPath(peaks)} className="fill-fg-muted/50" />
            </g>
          </svg>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-fg-muted">
            {durationMs > 0 ? "" : "no timeline"}
          </div>
        )}
        {range ? (
          <div
            className="absolute inset-y-0 border-x-2 border-accent bg-accent/20"
            style={{
              left: `${pct(range.startMs)}%`,
              width: `${pct(range.endMs - range.startMs)}%`,
            }}
            data-testid="media-range-overlay"
          />
        ) : null}
        <div
          className="absolute inset-y-0 w-0.5 bg-focus"
          style={{ left: `${fraction * 100}%` }}
          data-testid="media-playhead"
        />
      </div>
      {bands.length > 0 ? (
        <div className="relative mt-1" style={{ height: bands.length * (BAND_HEIGHT + BAND_GAP) }}>
          {bands.map((b, i) => (
            <button
              key={b.id}
              type="button"
              className="absolute rounded-sm"
              style={{
                top: i * (BAND_HEIGHT + BAND_GAP),
                height: BAND_HEIGHT,
                left: `${pct(b.startMs)}%`,
                width: `max(3px, ${pct(b.endMs - b.startMs)}%)`,
                backgroundColor: b.color,
                opacity: b.codeCount === 0 ? 0.35 : 0.85,
                outline: b.id === focusedId ? "2px solid var(--focus)" : undefined,
              }}
              title={b.label}
              aria-label={`Excerpt ${b.label}`}
              onClick={() => onPickBand(b.id, b.startMs)}
              data-testid="media-band"
              data-x={b.id}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MissingMediaNotice({
  name,
  sourcePath,
  onRelink,
  pending,
}: {
  name: string;
  sourcePath: string | null;
  onRelink: () => void;
  pending: boolean;
}) {
  return (
    <div
      className="m-6 max-w-xl rounded-md border border-border bg-panel p-4"
      data-testid="media-missing"
    >
      <h3 className="mb-1 flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 text-danger" />
        The file for “{name}” is not where it was
      </h3>
      <p className="text-sm text-fg-muted">
        Audio and video are not copied into the project file, so a recording lives on disk and the
        project remembers where. This one is no longer at:
      </p>
      <p className="my-2 break-all rounded bg-muted px-2 py-1 font-mono text-xs">
        {sourcePath ?? "(no path recorded)"}
      </p>
      <p className="text-sm text-fg-muted">
        Everything coded from it is safe — the excerpts, codes and memos are inside the project.
        Point it at the file again and they all come back into view.
      </p>
      <div className="mt-3">
        <Button onClick={onRelink} disabled={pending} data-testid="media-relink">
          Relink…
        </Button>
      </div>
    </div>
  );
}

function PlaybackErrorNotice({ message, onRelink }: { message: string; onRelink: () => void }) {
  return (
    <div
      className="m-6 max-w-xl rounded-md border border-border bg-panel p-4"
      data-testid="media-error"
    >
      <h3 className="mb-1 flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 text-danger" />
        This recording could not be played
      </h3>
      <p className="text-sm text-fg-muted">{message}</p>
      <div className="mt-3">
        <Button variant="ghost" onClick={onRelink}>
          Relink to another file…
        </Button>
      </div>
    </div>
  );
}
