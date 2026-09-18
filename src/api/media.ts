/**
 * URLs for the media the open project holds.
 *
 * There are two ways in, because a webview treats pictures and recordings
 * very differently:
 *
 * - **The `misket-media` protocol** (`src-tauri/src/media.rs`) serves an
 *   image document's stored bytes and a video excerpt's captured frame. An
 *   `<img>` loads from a custom scheme happily. Its shape differs by
 *   platform, exactly as Tauri's own `convertFileSrc` does: Linux and macOS
 *   address the scheme directly, while Windows and Android map custom schemes
 *   onto `http://<scheme>.localhost`.
 * - **A loopback HTTP origin** for anything a `<video>` or `<audio>` element
 *   has to play, or that a ranged `fetch` has to read. On Linux, WebKitGTK
 *   hands playback to GStreamer, which refuses a custom scheme (and
 *   `asset://`, and `file://`) outright; loopback HTTP it streams and seeks
 *   in natively. The origin and this run's token come from the backend, so
 *   `loadMediaServer()` has to have answered before `mediaFileUrl` can build
 *   anything.
 */

import { invoke } from "./client";

const SCHEME = "misket-media";

export interface MediaServerInfo {
  origin: string;
  token: string;
}

/** The loopback origin and token, once the backend has been asked for them. */
let server: MediaServerInfo | null = null;

/**
 * Ask the backend where recordings are served, once per run.
 *
 * `null` means the listener could not be bound, in which case audio and video
 * cannot play and the viewer says so rather than showing a dead player.
 */
export async function loadMediaServer(): Promise<MediaServerInfo | null> {
  if (server) return server;
  const info = await invoke<MediaServerInfo | null>("media_server");
  if (info?.origin && info.token) server = info;
  return server;
}

/** What `loadMediaServer` found, without asking again. */
export function mediaServer(): MediaServerInfo | null {
  return server;
}

/** Set the origin directly, for tests. */
export function setMediaServer(info: MediaServerInfo | null): void {
  server = info;
}

function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  return /Windows/i.test(ua);
}

/** `<img src={mediaUrl(id)}>` renders the document's stored image. */
export function mediaUrl(documentId: string): string {
  return mediaUrlFor(documentId, isWindows());
}

/** `<img src={thumbnailUrl(excerptId)}>` shows a video excerpt's frame. */
export function thumbnailUrl(excerptId: string): string {
  return urlFor(`/thumbnail/${encodeURIComponent(excerptId)}`, isWindows());
}

/** The platform split, exposed for tests. */
export function mediaUrlFor(documentId: string, windows: boolean): string {
  return urlFor(`/document/${encodeURIComponent(documentId)}`, windows);
}

/** The platform split for a thumbnail, exposed for tests. */
export function thumbnailUrlFor(excerptId: string, windows: boolean): string {
  return urlFor(`/thumbnail/${encodeURIComponent(excerptId)}`, windows);
}

function urlFor(path: string, windows: boolean): string {
  return windows ? `http://${SCHEME}.localhost${path}` : `${SCHEME}://localhost${path}`;
}

/**
 * `<video src={mediaFileUrl(id)}>` plays the document's recording, and
 * `fetch(mediaFileUrl(id))` reads it — both through the loopback server, with
 * range support. `null` until `loadMediaServer` has answered.
 */
export function mediaFileUrl(documentId: string): string | null {
  return serverUrlWith(server, `/document/${encodeURIComponent(documentId)}`);
}

/** The loopback URL for a file staged for import (`stageMediaProbe`). */
export function probeUrl(token: string): string | null {
  return serverUrlWith(server, `/probe/${encodeURIComponent(token)}`);
}

/** The loopback URL for `path` under `info`, exposed for tests. */
export function serverUrlWith(info: MediaServerInfo | null, path: string): string | null {
  if (!info) return null;
  return `${info.origin}${path}?t=${encodeURIComponent(info.token)}`;
}
