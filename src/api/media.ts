/**
 * URLs for the `misket-media` protocol registered in `src-tauri/src/lib.rs`,
 * which serves the image bytes stored inside the open project.
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

/** `<img src={mediaUrl(id)}>` renders the document's stored image. */
export function mediaUrl(documentId: string): string {
  return mediaUrlFor(documentId, isWindows());
}

/** The platform split, exposed for tests. */
export function mediaUrlFor(documentId: string, windows: boolean): string {
  const path = `/document/${encodeURIComponent(documentId)}`;
  return windows ? `http://${SCHEME}.localhost${path}` : `${SCHEME}://localhost${path}`;
}
