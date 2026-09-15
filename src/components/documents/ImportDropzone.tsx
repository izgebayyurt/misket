import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useImportFiles } from "./useImportFiles";

/** Listens for OS-level file drops onto the window and imports them. */
export function ImportDropzone() {
  const { importPaths } = useImportFiles();
  const [hover, setHover] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") setHover(true);
        else if (p.type === "leave") setHover(false);
        else if (p.type === "drop") {
          setHover(false);
          void importPaths(p.paths);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* not running inside Tauri (e.g. Vite preview) */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [importPaths]);

  if (!hover) return null;
  return (
    <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-bg/80 text-lg text-accent">
      Drop to import
    </div>
  );
}
