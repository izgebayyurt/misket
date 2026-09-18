import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The same provider tree `main.tsx` mounts the app under, minus StrictMode
 * (which double-invokes effects and is noise for a static-shell a11y check).
 * Each call gets its own `QueryClient` so tests don't share cached queries.
 */
export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}
