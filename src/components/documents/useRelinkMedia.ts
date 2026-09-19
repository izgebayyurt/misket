import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { MEDIA_EXTENSIONS } from "@/core/media";
import { describe } from "@/core/keymap";
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
  const { t } = useTranslation();
  const relink = useRelinkMediaDocument();

  const pickAndRelink = useCallback(
    async (documentId: string): Promise<boolean> => {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: t("documents.filterMedia"), extensions: [...MEDIA_EXTENSIONS] }],
      });
      if (typeof picked !== "string") return false;
      try {
        await relink.mutateAsync({ id: documentId, path: picked });
        toast.info(t("documents.relinkToast.toastRelinked", { shortcut: describe("undo") }));
        return true;
      } catch (e) {
        toast.error(e);
        return false;
      }
    },
    [relink, t],
  );

  return { pickAndRelink, isPending: relink.isPending };
}
