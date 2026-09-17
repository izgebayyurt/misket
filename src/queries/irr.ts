import { useQuery } from "@tanstack/react-query";
import * as api from "@/api/irr";
import type { IrrRequest } from "@/api/types";
import { keys } from "./keys";

/**
 * One inter-rater comparison. Disabled until two different coders are picked,
 * which is also what the Rust side refuses.
 */
export function useIrrReport(request: IrrRequest | null) {
  return useQuery({
    queryKey: keys.irr(request ?? { coderA: "", coderB: "" }),
    queryFn: () => api.irrCompare(request!),
    enabled: !!request && !!request.coderA && !!request.coderB && request.coderA !== request.coderB,
    placeholderData: (prev) => prev,
  });
}
