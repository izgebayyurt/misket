import { useQuery } from "@tanstack/react-query";
import * as api from "@/api/coders";
import { keys } from "./keys";

/**
 * Everyone whose work is in the open project, with how much of it is theirs.
 * Under "coders" rather than "project" so a coding change refreshes the
 * counts; the local coder is first and carries `isLocal`.
 */
export function useCoders() {
  return useQuery({ queryKey: keys.coders, queryFn: api.listCoders });
}

/** Just the local coder, for "is this coding mine?". */
export function useLocalCoder() {
  const { data } = useCoders();
  return data?.find((c) => c.isLocal);
}
