import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import "./styles/globals.css";
import { initThemeWatcher } from "./state/theme";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

// Tracks the OS appearance until settings load, then follows the "theme"
// setting (see src/state/settings.ts).
initThemeWatcher();

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
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
        <App />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
