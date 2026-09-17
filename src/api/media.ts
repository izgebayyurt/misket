/**
 * URLs for the `misket-media` protocol registered in `src-tauri/src/media.rs`,
 * which serves an image document's stored bytes, an audio or video
 * document's file on disk (with range support, so `<video>` can seek), and
 * the frame captured for a coded stretch of video.
 *
 * The shape differs by platform, exactly as Tauri's own `convertFileSrc`
 * does: Linux and macOS address a custom scheme directly, while Windows and
 * Android map custom schemes onto `http://<scheme>.localhost`.
 */
const SCHEME = "misket-media";

function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  return /Windows/i.test(ua);
}

/**
 * `<img src={mediaUrl(id)}>` renders the document's stored image;
 * `<video src={mediaUrl(id)}>` plays its recording.
 */
export function mediaUrl(documentId: string): string {
  return mediaUrlFor(documentId, isWindows());
}

/** `<img src={thumbnailUrl(excerptId)}>` shows a video excerpt's frame. */
export function thumbnailUrl(excerptId: string): string {
  return urlFor(`/thumbnail/${encodeURIComponent(excerptId)}`, isWindows());
}

/** A file staged for import, before it is a document (`stageMediaProbe`). */
export function probeUrl(token: string): string {
  return urlFor(`/probe/${encodeURIComponent(token)}`, isWindows());
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
