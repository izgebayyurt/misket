/** Keyboard shortcut definitions, resolved once for the current platform. */

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

/** Whether the platform's primary modifier (Cmd on macOS, Ctrl elsewhere) is held. */
export function mod(e: KeyboardEvent | { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

export const modLabel = isMac ? "⌘" : "Ctrl+";

export type Action =
  | "openProject"
  | "newProject"
  | "import"
  | "overview"
  | "history"
  | "excerptBrowser"
  | "analysis"
  | "tabDocuments"
  | "tabCodes"
  | "newMemo"
  | "palette"
  | "inVivoCode"
  | "quickCode"
  | "find"
  | "findInProject"
  | "settings"
  | "shortcutsHelp"
  | "undo"
  | "redo"
  | "nextExcerpt"
  | "prevExcerpt"
  | "editExcerpt"
  | "deleteExcerpt"
  | "extendSelectionLeft"
  | "extendSelectionRight"
  | "excerptEndLeft"
  | "excerptEndRight"
  | "excerptEndLeftChar"
  | "excerptEndRightChar"
  | "excerptStartLeft"
  | "excerptStartRight"
  | "excerptStartLeftChar"
  | "excerptStartRightChar"
  | "splitExcerpt"
  | "mergeExcerpt"
  | "jumpTop"
  | "jumpBottom"
  | "goToParagraph"
  | "alignHere"
  | "escape"
  | "setWeight1"
  | "setWeight2"
  | "setWeight3"
  | "setWeight4"
  | "setWeight5"
  | "setWeight6"
  | "setWeight7"
  | "setWeight8"
  | "setWeight9";

export interface Shortcut {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Fire even when focus is inside a text field. */
  global?: boolean;
}

export const SHORTCUTS: Record<Action, Shortcut> = {
  openProject: { key: "o", mod: true, global: true },
  newProject: { key: "n", mod: true, global: true },
  import: { key: "i", mod: true, global: true },
  overview: { key: "h", mod: true, shift: true, global: true },
  history: { key: "y", mod: true, shift: true, global: true },
  excerptBrowser: { key: "e", mod: true, global: true },
  analysis: { key: "a", mod: true, shift: true, global: true },
  tabDocuments: { key: "1", mod: true, global: true },
  tabCodes: { key: "2", mod: true, global: true },
  newMemo: { key: "m", mod: true, global: true },
  palette: { key: "k", mod: true, global: true },
  // Name a code after the selected text. Not `global`: it acts on a document
  // selection, which typing in a field does not have. Not `Ctrl`/`⌘`+`Shift`+`I`:
  // that chord opens WebKitGTK's Web Inspector in debug builds on Linux, so it
  // never reaches the page's own key handler there.
  inVivoCode: { key: "k", mod: true, shift: true },
  // Repeat the last code applied. Not `global`: a full stop belongs to the
  // text field the user is typing in.
  quickCode: { key: ".", mod: true },
  find: { key: "f", mod: true, global: true },
  findInProject: { key: "f", mod: true, shift: true, global: true },
  settings: { key: ",", mod: true, global: true },
  shortcutsHelp: { key: "/", mod: true, global: true },
  undo: { key: "z", mod: true },
  redo: { key: "z", mod: true, shift: true },
  nextExcerpt: { key: "Tab" },
  prevExcerpt: { key: "Tab", shift: true },
  editExcerpt: { key: "Enter" },
  deleteExcerpt: { key: "Backspace" },
  extendSelectionLeft: { key: "ArrowLeft", alt: true, shift: true },
  extendSelectionRight: { key: "ArrowRight", alt: true, shift: true },
  // Excerpt boundaries. `Alt` + arrows move the end edge, `Ctrl`/`⌘` picks
  // the start edge instead, and `Shift` steps by one character rather than
  // one word. The end edge's character step is the one exception: it drops
  // `Alt`, because `Alt`+`Shift`+arrows already extends the selection.
  excerptEndLeft: { key: "ArrowLeft", alt: true },
  excerptEndRight: { key: "ArrowRight", alt: true },
  excerptEndLeftChar: { key: "ArrowLeft", mod: true, shift: true },
  excerptEndRightChar: { key: "ArrowRight", mod: true, shift: true },
  excerptStartLeft: { key: "ArrowLeft", mod: true, alt: true },
  excerptStartRight: { key: "ArrowRight", mod: true, alt: true },
  excerptStartLeftChar: { key: "ArrowLeft", mod: true, alt: true, shift: true },
  excerptStartRightChar: { key: "ArrowRight", mod: true, alt: true, shift: true },
  splitExcerpt: { key: "s", mod: true, shift: true },
  mergeExcerpt: { key: "m", mod: true, shift: true },
  // Document orientation. Home/End keep their plain meaning (and their
  // meaning inside a text field); only the modified chords are ours.
  jumpTop: { key: "Home", mod: true },
  jumpBottom: { key: "End", mod: true },
  goToParagraph: { key: "g", mod: true },
  // Line the cursor up with the playhead, in a transcript linked to a
  // recording. `Alt` alone: the chord has to be free while the recording is
  // playing and the hands are on the text, and `Ctrl`/`⌘`+`A` is select-all.
  alignHere: { key: "a", alt: true },
  escape: { key: "Escape", global: true },
  // With an excerpt focused, `1`-`9` rate the last applied code on its
  // weight scale (a no-op if it has none). Not `global`: a text field's own
  // digits take priority, same reasoning as `quickCode`'s full stop.
  setWeight1: { key: "1" },
  setWeight2: { key: "2" },
  setWeight3: { key: "3" },
  setWeight4: { key: "4" },
  setWeight5: { key: "5" },
  setWeight6: { key: "6" },
  setWeight7: { key: "7" },
  setWeight8: { key: "8" },
  setWeight9: { key: "9" },
};

// ------------------------------------------------------- audio and video

/**
 * What the audio/video viewer's keys do. These live apart from [`SHORTCUTS`]
 * on purpose.
 *
 * They are **bare, unmodified keys** — the conventional ones from every
 * editing tool: space to play, `J`/`L` to scrub, comma and full stop to
 * nudge, brackets to mark in and out. A bare full stop everywhere else in
 * Misket is just a full stop, so these must not go through [`matchAction`],
 * which the application-wide listener uses. `MediaView` calls
 * [`matchMediaAction`] itself and acts only while the player has the focus.
 *
 * Coding the marked stretch is not here: `Enter` (`editExcerpt`) and
 * `Ctrl`/`⌘`+`K` (`palette`) already mean "act on what is selected", and the
 * viewer registers handlers for both.
 */
export type MediaAction =
  | "mediaPlayPause"
  | "mediaBack"
  | "mediaForward"
  | "mediaStepBack"
  | "mediaStepForward"
  | "mediaSetIn"
  | "mediaSetOut";

export const MEDIA_SHORTCUTS: Record<MediaAction, Shortcut> = {
  mediaPlayPause: { key: " " },
  mediaBack: { key: "j" },
  mediaForward: { key: "l" },
  mediaStepBack: { key: "," },
  mediaStepForward: { key: "." },
  mediaSetIn: { key: "[" },
  mediaSetOut: { key: "]" },
};

/** `i18next` keys for each media action's label; resolve them with `t()`. */
export const MEDIA_LABELS: Record<MediaAction, string> = {
  mediaPlayPause: "keymap.media.playPause",
  mediaBack: "keymap.media.back",
  mediaForward: "keymap.media.forward",
  mediaStepBack: "keymap.media.stepBack",
  mediaStepForward: "keymap.media.stepForward",
  mediaSetIn: "keymap.media.setIn",
  mediaSetOut: "keymap.media.setOut",
};

/** How far `J`/`L` scrub, in milliseconds. */
export const MEDIA_SEEK_MS = 5_000;

/** How far `,`/`.` nudge, in milliseconds. */
export const MEDIA_STEP_MS = 100;

/**
 * Match a keyboard event to a media action, or null. Never matches inside a
 * text field, and never with a modifier held, so a code hotkey chord or an
 * application shortcut is left alone.
 */
export function matchMediaAction(e: KeyboardEvent): MediaAction | null {
  if (isTextField(e.target) || mod(e) || e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) {
    return null;
  }
  for (const [action, s] of Object.entries(MEDIA_SHORTCUTS) as [MediaAction, Shortcut][]) {
    if (s.key.length === 1 ? e.key.toLowerCase() === s.key : e.key === s.key) return action;
  }
  return null;
}

/**
 * Is `target` a genuine text-entry surface (typing there should keep its own
 * keys)? A `<button>`, a menu trigger/item, or anything else that is merely
 * *focusable* is not: shortcuts without `global` still fire normally there.
 * This matters right after a dropdown-menu action (delete, rename, add to
 * set…), where focus can land on the trigger button rather than back on the
 * document — undo/redo must still work without an extra click. See issue #37.
 */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** Match a keyboard event to an action, or null. */
export function matchAction(e: KeyboardEvent): Action | null {
  const inField = isTextField(e.target);
  for (const [action, s] of Object.entries(SHORTCUTS) as [Action, Shortcut][]) {
    if (inField && !s.global) continue;
    const keyMatches = s.key.length === 1 ? e.key.toLowerCase() === s.key : e.key === s.key;
    if (!keyMatches) continue;
    if (!!s.mod !== mod(e)) continue;
    if (!!s.shift !== e.shiftKey) continue;
    if (!!s.alt !== e.altKey) continue;
    return action;
  }
  return null;
}

/** Arrow keys read better as glyphs than as their DOM key names. */
const KEY_GLYPHS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  " ": "Space",
};

export function describe(action: Action): string {
  return describeShortcut(SHORTCUTS[action]);
}

/** The printable form of one chord, for the reference overlay. */
export function describeShortcut(s: Shortcut): string {
  const parts: string[] = [];
  if (s.mod) parts.push(modLabel);
  if (s.shift) parts.push("⇧");
  if (s.alt) parts.push(isMac ? "⌥" : "Alt+");
  parts.push(KEY_GLYPHS[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key));
  return parts.join("");
}

export function describeMedia(action: MediaAction): string {
  return describeShortcut(MEDIA_SHORTCUTS[action]);
}

/**
 * `i18next` keys for each action's human-readable name, shown in the keyboard
 * reference overlay. This module stays framework-free (no `react-i18next`
 * import — see CLAUDE.md), so it hands out *keys*; a component resolves them
 * with `t(label(action))`. `src/locales/en/common.json`'s `keymap.*` block is
 * the English text these keys point to, and `keymap.test.ts` checks that
 * text (not the key) still appears in the docs site's cheatsheet.
 */
export const LABELS: Record<Action, string> = {
  openProject: "keymap.openProject",
  newProject: "keymap.newProject",
  import: "keymap.import",
  overview: "keymap.overview",
  history: "keymap.history",
  excerptBrowser: "keymap.excerptBrowser",
  analysis: "keymap.analysis",
  find: "keymap.find",
  findInProject: "keymap.findInProject",
  tabDocuments: "keymap.tabDocuments",
  tabCodes: "keymap.tabCodes",
  newMemo: "keymap.newMemo",
  palette: "keymap.palette",
  inVivoCode: "keymap.inVivoCode",
  quickCode: "keymap.quickCode",
  settings: "keymap.settings",
  shortcutsHelp: "keymap.shortcutsHelp",
  undo: "keymap.undo",
  redo: "keymap.redo",
  nextExcerpt: "keymap.nextExcerpt",
  prevExcerpt: "keymap.prevExcerpt",
  editExcerpt: "keymap.editExcerpt",
  deleteExcerpt: "keymap.deleteExcerpt",
  extendSelectionLeft: "keymap.extendSelectionLeft",
  extendSelectionRight: "keymap.extendSelectionRight",
  excerptEndLeft: "keymap.excerptEndLeft",
  excerptEndRight: "keymap.excerptEndRight",
  excerptEndLeftChar: "keymap.excerptEndLeftChar",
  excerptEndRightChar: "keymap.excerptEndRightChar",
  excerptStartLeft: "keymap.excerptStartLeft",
  excerptStartRight: "keymap.excerptStartRight",
  excerptStartLeftChar: "keymap.excerptStartLeftChar",
  excerptStartRightChar: "keymap.excerptStartRightChar",
  splitExcerpt: "keymap.splitExcerpt",
  mergeExcerpt: "keymap.mergeExcerpt",
  jumpTop: "keymap.jumpTop",
  jumpBottom: "keymap.jumpBottom",
  goToParagraph: "keymap.goToParagraph",
  alignHere: "keymap.alignHere",
  escape: "keymap.escape",
  // One shared key across all nine digits: they are one control, not nine
  // different shortcuts (see `keymap.setWeight` in the locale file).
  setWeight1: "keymap.setWeight",
  setWeight2: "keymap.setWeight",
  setWeight3: "keymap.setWeight",
  setWeight4: "keymap.setWeight",
  setWeight5: "keymap.setWeight",
  setWeight6: "keymap.setWeight",
  setWeight7: "keymap.setWeight",
  setWeight8: "keymap.setWeight",
  setWeight9: "keymap.setWeight",
};

/** The `i18next` key for each action's label; resolve it with `t()`. */
export function label(action: Action): string {
  return LABELS[action];
}

/** The `i18next` key for each media action's label; resolve it with `t()`. */
export function mediaLabel(action: MediaAction): string {
  return MEDIA_LABELS[action];
}
