import { useMutation } from "@tanstack/react-query";
import * as api from "@/api/refi";
import type { RefiImportMode } from "@/api/types";
import { queryClient } from "./client";

/**
 * A `.qdpx` brings documents, codes, excerpts, codings, memos, attributes
 * and sets at once, so nothing in the cache is still known fresh.
 */
export function useImportRefi() {
  return useMutation({
    mutationFn: (args: { path: string; mode: RefiImportMode }) =>
      api.importRefi(args.path, args.mode),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
