import { useMutation } from "@tanstack/react-query";
import * as api from "@/api/codebook";
import type { CodebookImportMode } from "@/api/types";
import { useInvalidateCodes } from "./codes";

/** Undoable: the whole import is one step, so one undo takes it back out. */
export function useImportCodebook() {
  const invalidate = useInvalidateCodes();
  return useMutation({
    mutationFn: (args: { path: string; mode: CodebookImportMode; parentId?: string | null }) =>
      api.importCodebook(args.path, args.mode, args.parentId),
    onSuccess: invalidate,
  });
}
