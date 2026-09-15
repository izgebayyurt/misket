/**
 * Inverse-command undo stack. Commands run against the backend and carry their
 * own inverse, so undo/redo are ordinary mutations.
 */
export interface Command {
  label: string;
  redo: () => Promise<void>;
  undo: () => Promise<void>;
}

export interface UndoState {
  past: Command[];
  future: Command[];
}

export const MAX_UNDO = 200;

export const emptyUndo = (): UndoState => ({ past: [], future: [] });

export function pushCommand(state: UndoState, cmd: Command): UndoState {
  const past = [...state.past, cmd];
  if (past.length > MAX_UNDO) past.shift();
  return { past, future: [] };
}

/** Returns the command to undo and the next state, or null if nothing to undo. */
export function popUndo(state: UndoState): { cmd: Command; next: UndoState } | null {
  const cmd = state.past[state.past.length - 1];
  if (!cmd) return null;
  return { cmd, next: { past: state.past.slice(0, -1), future: [...state.future, cmd] } };
}

export function popRedo(state: UndoState): { cmd: Command; next: UndoState } | null {
  const cmd = state.future[state.future.length - 1];
  if (!cmd) return null;
  return { cmd, next: { past: [...state.past, cmd], future: state.future.slice(0, -1) } };
}
