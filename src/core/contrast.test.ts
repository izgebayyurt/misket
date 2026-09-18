import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTE } from "./codeTree";

const CSS_PATH = path.resolve(__dirname, "../styles/globals.css");

/** A hex-only reading of one `selector { --name: #rrggbb; ... }` block. */
function readTokens(css: string, selector: string): Record<string, string> {
  const block = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  if (!block) throw new Error(`no ${selector} block in globals.css`);
  const tokens: Record<string, string> = {};
  for (const m of block[1]!.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[m[1]!] = m[2]!.toLowerCase();
  }
  return tokens;
}

const css = readFileSync(CSS_PATH, "utf8");
// `:root` also matches inside `@theme inline`'s selector text on some engines,
// so anchor to the literal declaration block at the top of the file.
const LIGHT = readTokens(css, ":root");
const DARK = readTokens(css, "\\.dark");

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG contrast ratio between two colors, 1 (none) to 21 (black on white). */
function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Channel-wise sRGB mix, matching `color-mix(in srgb, a <pct>%, b)`. */
function mix(a: string, b: string, pctA: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const p = pctA / 100;
  const ch = (x: number, y: number) => Math.round(x * p + y * (1 - p));
  return `#${[ch(ar, br), ch(ag, bg), ch(ab, bb)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const AA_TEXT = 4.5;
const AA_UI = 3.0;

interface Pair {
  /** Token name carrying the foreground colour (text or icon/border stroke). */
  fg: string;
  /** Token name carrying the background it sits on. */
  bg: string;
  min: number;
  /** What actually pairs these two tokens in the app, for a failure message. */
  where: string;
}

// Every token pair the app actually draws one colour on top of the other,
// per src/styles/globals.css and the components that reference the token
// (see ui/input.tsx, ui/button.tsx, layout/Toaster.tsx, layout/LogViewerDialog.tsx…).
// Pure dividers (`border-b border-border`, floating-panel outlines) are left
// out: WCAG 1.4.11 covers a control's own boundary, not decorative
// separators, and `--border` is deliberately faint for those.
const PAIRS: Pair[] = [
  { fg: "fg", bg: "bg", min: AA_TEXT, where: "body text on the page" },
  { fg: "fg", bg: "bg-panel", min: AA_TEXT, where: "body text in a dialog/card" },
  { fg: "fg", bg: "bg-muted", min: AA_TEXT, where: "body text on a muted row" },
  { fg: "fg-muted", bg: "bg", min: AA_TEXT, where: "secondary text on the page" },
  { fg: "fg-muted", bg: "bg-panel", min: AA_TEXT, where: "secondary text in a dialog/card" },
  { fg: "fg-muted", bg: "bg-muted", min: AA_TEXT, where: "secondary text on a muted row" },
  { fg: "accent-fg", bg: "accent", min: AA_TEXT, where: "the default button's label" },
  { fg: "accent", bg: "bg", min: AA_TEXT, where: "a link-styled button or accent text" },
  { fg: "accent", bg: "bg-panel", min: AA_TEXT, where: "accent text in a dialog/card" },
  { fg: "danger", bg: "bg", min: AA_TEXT, where: "an error toast or destructive label" },
  { fg: "danger", bg: "bg-panel", min: AA_TEXT, where: "error text in a dialog" },
  { fg: "warn", bg: "bg", min: AA_TEXT, where: "a warning log line (LogViewerDialog)" },
  {
    fg: "border-strong",
    bg: "bg-panel",
    min: AA_UI,
    where: "an input/select/outline-button edge on a card",
  },
  { fg: "border-strong", bg: "bg", min: AA_UI, where: "an input/select/outline-button edge" },
  { fg: "focus", bg: "bg", min: AA_UI, where: "the focus ring on the page" },
  { fg: "focus", bg: "bg-panel", min: AA_UI, where: "the focus ring in a dialog/card" },
  { fg: "focus", bg: "bg-muted", min: AA_UI, where: "the focus ring on a muted row" },
];

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
])("contrast (%s theme)", (_theme, tokens) => {
  it.each(PAIRS)("$fg on $bg ($where) clears $min:1", ({ fg, bg, min }) => {
    const a = tokens[fg];
    const b = tokens[bg];
    expect(a, `--${fg} not found`).toBeTruthy();
    expect(b, `--${bg} not found`).toBeTruthy();
    expect(contrastRatio(a!, b!)).toBeGreaterThanOrEqual(min);
  });
});

describe("highlight tint readability", () => {
  // The `.seg` rule mixes 14% of a code's colour into the segment's
  // background over `--bg` (see globals.css); body text (`--fg`) still has
  // to read on top of the darkest and lightest colours a code can have.
  const TINT_PCT = 14;
  const byLuminance = [...PALETTE].sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
  const darkest = byLuminance[0]!;
  const lightest = byLuminance[byLuminance.length - 1]!;

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("%s theme: body text over the darkest and lightest code tints", (_name, tokens) => {
    for (const code of [darkest, lightest]) {
      const tinted = mix(code, tokens.bg!, TINT_PCT);
      expect(contrastRatio(tokens.fg!, tinted)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});
