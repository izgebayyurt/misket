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
  | "excerptBrowser"
  | "analysis"
  | "tabDocuments"
  | "tabCodes"
  | "newMemo"
  | "palette"
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
  | "escape";

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
  excerptBrowser: { key: "e", mod: true, global: true },
  analysis: { key: "a", mod: true, shift: true, global: true },
  tabDocuments: { key: "1", mod: true, global: true },
  tabCodes: { key: "2", mod: true, global: true },
  newMemo: { key: "m", mod: true, global: true },
  palette: { key: "k", mod: true, global: true },
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
  escape: { key: "Escape", global: true },
};

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

export function describe(action: Action): string {
  const s = SHORTCUTS[action];
  const parts: string[] = [];
  if (s.mod) parts.push(modLabel);
  if (s.shift) parts.push("⇧");
  if (s.alt) parts.push(isMac ? "⌥" : "Alt+");
  parts.push(s.key.length === 1 ? s.key.toUpperCase() : s.key);
  return parts.join("");
}

/** Human-readable name for each action, shown in the keyboard reference overlay. */
export const LABELS: Record<Action, string> = {
  openProject: "Open project",
  newProject: "New project",
  import: "Import documents",
  excerptBrowser: "Excerpt browser",
  analysis: "Analysis views",
  find: "Find in document",
  findInProject: "Find in project",
  tabDocuments: "Switch to Documents tab",
  tabCodes: "Switch to Codes tab",
  newMemo: "New memo",
  palette: "Open code palette",
  settings: "Open settings",
  shortcutsHelp: "Keyboard shortcuts",
  undo: "Undo",
  redo: "Redo",
  nextExcerpt: "Next excerpt",
  prevExcerpt: "Previous excerpt",
  editExcerpt: "Edit focused excerpt",
  deleteExcerpt: "Delete focused excerpt",
  extendSelectionLeft: "Extend selection left",
  extendSelectionRight: "Extend selection right",
  escape: "Cancel / close",
};

export function label(action: Action): string {
  return LABELS[action];
}
