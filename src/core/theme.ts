/** Pure theme resolution: no DOM, no media queries. */

export type Theme = "system" | "light" | "dark";

/** Whether the app should render dark for this theme choice. */
export function resolveDark(theme: Theme, prefersDark: boolean): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return prefersDark;
}
