import { QueryClient } from "@tanstack/react-query";

/**
 * The one query cache, in a module rather than in `main.tsx`, so code outside
 * React can invalidate it. Undo moves any part of the project at once, so the
 * undo store empties the whole cache rather than guessing which keys moved.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
