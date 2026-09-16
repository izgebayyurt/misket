import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { openProject, takePendingOpenPath } from "@/api/project";
import { useWorkspace } from "@/state/workspace";
import { toast } from "@/state/toasts";

const OPEN_FILE_EVENT = "misket://open-file";

/**
 * Opens a `.misket` file the OS handed to the app: at launch (double-click,
 * "Open with", command-line argument) or while the app is already running.
 */
export function useOpenFileRequests() {
  const qc = useQueryClient();
  const busy = useRef(false);

  useEffect(() => {
    async function open(path: string) {
      if (busy.current) return;
      busy.current = true;
      try {
        await openProject(path);
        useWorkspace.getState().reset();
        qc.resetQueries();
      } catch (e) {
        toast.error(e);
      } finally {
        busy.current = false;
      }
    }

    takePendingOpenPath()
      .then((path) => {
        if (path) void open(path);
      })
      .catch(() => {
        /* not running inside Tauri */
      });

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<string>(OPEN_FILE_EVENT, (event) => void open(event.payload))
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [qc]);
}
