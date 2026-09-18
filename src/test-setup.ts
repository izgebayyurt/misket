import "@testing-library/jest-dom/vitest";

// jsdom has no layout engine and doesn't implement matchMedia; the theme
// watcher (src/state/theme.ts) reads it at module load time to follow the OS
// appearance, so any test that imports a component pulling that in needs it
// stubbed to "no match" (i.e. not dark, not reduced motion).
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
