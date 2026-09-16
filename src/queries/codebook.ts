import { useMutation } from "@tanstack/react-query";
import * as api from "@/api/codebook";
import type { CodebookImportMode } from "@/api/types";
import { useUndoStore } from "@/state/undoStore";
import { useInvalidateCodes } from "./codes";

/** Not undoable: clears the undo stack on success. */
export function useImportCodebook() {
  const invalidate = useInvalidateCodes();
  return useMutation({
    mutationFn: (args: { path: string; mode: CodebookImportMode; parentId?: string | null }) =>
      api.importCodebook(args.path, args.mode, args.parentId),
    onSuccess: () => {
      useUndoStore.getState().clear();
      invalidate();
    },
  });
}
