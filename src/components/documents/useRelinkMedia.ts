import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { MEDIA_EXTENSIONS } from "@/core/media";
import { useRelinkMediaDocument } from "@/queries/documents";
import { toast } from "@/state/toasts";

/**
 * Ask for the file an audio or video document should point at now.
 *
 * A recording is held by reference, so it can be moved, renamed or arrive on
 * another machine — relinking is the ordinary repair, offered from the
 * document row, the viewer and the project overview. It is one undoable step
 * (`document.relinked`), which is why the toast says so.
 */
export function useRelinkMedia() {
  const relink = useRelinkMediaDocument();

  const pickAndRelink = useCallback(
    async (documentId: string): Promise<boolean> => {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Audio and video", extensions: [...MEDIA_EXTENSIONS] }],
      });
      if (typeof picked !== "string") return false;
      try {
        await relink.mutateAsync({ id: documentId, path: picked });
        toast.info("Relinked. Undo with Ctrl/⌘+Z if that was the wrong file.");
        return true;
      } catch (e) {
        toast.error(e);
        return false;
      }
    },
    [relink],
  );

  return { pickAndRelink, isPending: relink.isPending };
}
