import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/queries/client";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { log } from "@/api/log";
import App from "./App";
import "./styles/globals.css";
import { initThemeWatcher } from "./state/theme";

// Tracks the OS appearance until settings load, then follows the "theme"
// setting (see src/state/settings.ts).
initThemeWatcher();

// Anything that never made it into a component's own try/catch or a query's
// onError: an uncaught exception, or a rejected promise nobody awaited. Logs
// alongside everything else `src/api/log.ts` sends, so it shows up in the
// same log viewer and, if the person turns reporting on, the same reports.
window.addEventListener("error", (e) => {
  log.error(e.message, { stack: e.error instanceof Error ? e.error.stack : undefined });
});
window.addEventListener("unhandledrejection", (e) => {
  const reason: unknown = e.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  log.error(`unhandled rejection: ${message}`, { stack });
});

// The WebView's native context menu (Back/Forward/Reload/Inspect Element)
// has nothing useful to offer in this app; rows have their own menu, opened
// by right-click via Radix `ContextMenu` (see e.g. CodeTree.tsx). Keep the
// native menu for text fields and the document view's selectable text,
// where the browser's own copy/paste menu is the useful one, and keep it
// everywhere in dev builds so "Inspect Element" stays reachable.
document.addEventListener("contextmenu", (e) => {
  if (import.meta.env.DEV) return;
  const target = e.target instanceof Element ? e.target : null;
  const allowsNativeMenu = target?.closest(
    'input, textarea, [contenteditable]:not([contenteditable="false"]), .doc-text',
  );
  if (!allowsNativeMenu) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={400}>
          <App />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
