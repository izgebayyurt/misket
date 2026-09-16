import { resolveDark, type Theme } from "@/core/theme";

const media =
  typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

let current: Theme = "system";

function apply() {
  document.documentElement.classList.toggle("dark", resolveDark(current, media?.matches ?? false));
}

/** Set the app's theme choice and immediately update the `dark` class. */
export function setTheme(theme: Theme) {
  current = theme;
  apply();
}

/**
 * Apply the current theme once and keep it in sync with the OS setting while
 * `current` is "system". Call once at startup; returns a cleanup function.
 */
export function initThemeWatcher(): () => void {
  apply();
  media?.addEventListener("change", apply);
  return () => media?.removeEventListener("change", apply);
}
