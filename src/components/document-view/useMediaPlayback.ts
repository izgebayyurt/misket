import { useCallback, useEffect, useRef, useState } from "react";
import { loadMediaServer, mediaFileUrl, mediaServer } from "@/api/media";
import { clampPosition, MIN_RANGE_MS } from "@/core/media";
import { useProjectInfo } from "@/queries/project";
import { useReadingPositions } from "@/state/readingPositions";

/**
 * Playing one recording, wherever it is being played from.
 *
 * Two views drive the same media document: `MediaView`, which owns the
 * waveform, the timeline and in/out coding, and the compact strip at the top
 * of a transcript that is linked to it. They are never on screen at the same
 * time (one document is open at a time), but a coder moves between them
 * constantly — so the playhead, the speed and the remembered position are
 * kept per *media document* rather than per component, and picking the other
 * view up carries on where the first left off.
 *
 * `LIVE` is that memory for the session; `useReadingPositions` is the
 * persisted half, the same store the text viewer keeps a reading position in
 * (one in code points, one in milliseconds — both answer "where had I got
 * to").
 */
const LIVE = new Map<string, { positionMs: number; speed: number }>();

function live(documentId: string) {
  return LIVE.get(documentId) ?? { positionMs: 0, speed: 1 };
}

export interface MediaPlaybackOptions {
  /** The recording's duration, as soon as the document row is loaded. */
  durationMs: number;
  /** False while the document (and so its duration) is still loading. */
  ready: boolean;
  /** Seek here on arrival instead of picking up where the coder left off. */
  seekToMs?: number;
  /** Something else is about to seek (an excerpt to focus): do not restore. */
  skipRestore?: boolean;
}

export interface MediaPlayback {
  /** Attach to the `<audio>`/`<video>` element that plays this recording. */
  ref: React.RefObject<(HTMLVideoElement & HTMLAudioElement) | null>;
  /** The loopback URL to play from, or `null` until the server has answered. */
  src: string | null;
  /** Set when the recording cannot be played at all; the view says so. */
  error: string | null;
  setError: (message: string | null) => void;
  positionMs: number;
  /** The live playhead, for key handlers that must not re-register per frame. */
  positionRef: React.RefObject<number>;
  playing: boolean;
  speed: number;
  setSpeed: (speed: number) => void;
  /**
   * The furthest the playhead goes. Not the last millisecond: seeking a
   * WebKit media element to exactly the end makes it ask the server for
   * `Range: bytes=<length>-`, which is unsatisfiable — the loopback server
   * answers `416`, WebKit turns that into `MEDIA_ERR_NETWORK` and stops
   * playing (measured in `e2e/`).
   */
  playableLimit: number;
  seekTo: (ms: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  /** Record where the player is; the element's `onTimeUpdate` calls it. */
  notePosition: (ms: number) => void;
  /** `onPlay`/`onPause`/`onTimeUpdate`/`onCanPlay` for the media element. */
  elementProps: {
    onPlay: () => void;
    onPause: () => void;
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => void;
    onCanPlay: () => void;
  };
}

/** Everything both views need to play one recording. */
export function useMediaPlayback(
  /** `null` while nothing is linked: the hook then simply has no source. */
  mediaDocumentId: string | null,
  { durationMs, ready, seekToMs, skipRestore }: MediaPlaybackOptions,
): MediaPlayback {
  const documentId = mediaDocumentId ?? "";
  const { data: projectInfo } = useProjectInfo();
  const projectPath = projectInfo?.path ?? "";
  const ref = useRef<(HTMLVideoElement & HTMLAudioElement) | null>(null);
  const positionRef = useRef(live(documentId).positionMs);
  const [positionMs, setPositionMs] = useState(() => live(documentId).positionMs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(live(documentId).speed);
  const [error, setError] = useState<string | null>(null);
  // Where a media element can reach a recording (`src/api/media.ts`). Asked
  // for once per run; `false` while the answer is still on its way.
  const [serverReady, setServerReady] = useState(() => !!mediaServer());
  const mediaSrc = serverReady && documentId ? mediaFileUrl(documentId) : null;

  useEffect(() => {
    if (serverReady) return;
    let cancelled = false;
    void loadMediaServer().then((info) => {
      if (cancelled) return;
      if (info) setServerReady(true);
      else
        setError(
          "Misket could not open the local connection it plays recordings through, so this one cannot be played. Restarting the app usually fixes it.",
        );
    });
    return () => {
      cancelled = true;
    };
  }, [serverReady]);

  const playableLimit = Math.max(0, durationMs - MIN_RANGE_MS);

  const notePosition = useCallback(
    (ms: number) => {
      positionRef.current = ms;
      setPositionMs(ms);
      LIVE.set(documentId, { positionMs: ms, speed: live(documentId).speed });
    },
    [documentId],
  );

  const seekTo = useCallback(
    (ms: number) => {
      const at = clampPosition(ms, playableLimit);
      notePosition(at);
      const player = ref.current;
      if (player) player.currentTime = at / 1000;
    },
    [notePosition, playableLimit],
  );

  const play = useCallback(() => {
    void ref.current?.play().catch(() => setPlaying(false));
  }, []);
  const pause = useCallback(() => ref.current?.pause(), []);
  const togglePlay = useCallback(() => {
    const player = ref.current;
    if (!player) return;
    if (player.paused) play();
    else player.pause();
  }, [play]);

  const setSpeed = useCallback(
    (next: number) => {
      setSpeedState(next);
      LIVE.set(documentId, { positionMs: live(documentId).positionMs, speed: next });
    },
    [documentId],
  );

  useEffect(() => {
    const player = ref.current;
    if (player) player.playbackRate = speed;
  }, [speed, error, mediaSrc]);

  // Where the coder left off: this session's live position first, then the
  // one remembered in the project. Once per arrival at a document.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !documentId || restoredFor.current === documentId) return;
    restoredFor.current = documentId;
    if (skipRestore) return;
    const remembered = projectPath
      ? useReadingPositions.getState().recall(projectPath, documentId)
      : null;
    const at = seekToMs ?? (live(documentId).positionMs || remembered);
    if (at === null || at <= 0 || at >= durationMs) return;
    // After this render: the element has to exist before it can be seeked.
    const raf = requestAnimationFrame(() => seekTo(at));
    return () => cancelAnimationFrame(raf);
    // Only on first arrival at a document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, ready, projectPath]);

  useEffect(() => {
    if (!projectPath || positionMs <= 0) return;
    const t = setTimeout(
      () => useReadingPositions.getState().remember(projectPath, documentId, positionMs),
      600,
    );
    return () => clearTimeout(t);
  }, [documentId, positionMs, projectPath]);

  return {
    ref,
    src: mediaSrc,
    error,
    setError,
    positionMs,
    positionRef,
    playing,
    speed,
    setSpeed,
    playableLimit,
    seekTo,
    play,
    pause,
    togglePlay,
    notePosition,
    elementProps: {
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onTimeUpdate: (e) => notePosition(Math.round(e.currentTarget.currentTime * 1000)),
      // A `currentTime` set before the element had its headers is ignored, so
      // the playhead is re-applied the moment it can honour it: that is what
      // makes "play this excerpt" land in the right place on a player that
      // was only just mounted.
      onCanPlay: () => {
        const player = ref.current;
        if (!player) return;
        const want = positionRef.current / 1000;
        if (Math.abs(player.currentTime - want) > 0.25) player.currentTime = want;
      },
    },
  };
}
