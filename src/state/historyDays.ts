/**
 * Which day groups the history view has open, remembered per project.
 *
 * Two lists, not one: the days the person explicitly *opened* and the ones
 * they explicitly *closed*. Everything else follows the view's own default
 * (the day the project is at, and any day holding a fork or a branch name),
 * so a day that appears after this was last written still opens itself when
 * it holds something the graph must not hide.
 *
 * Mirrored into `localStorage` on a best-effort basis: blocked or full
 * storage just means the view forgets, never that it breaks.
 */

const STORAGE_KEY = "misket:historyDays";

/** How many projects to remember before the least recently used are dropped. */
export const MAX_PROJECTS = 50;

export interface DayState {
  /** Days the person opened by hand. */
  expanded: string[];
  /** Days the person closed by hand. */
  collapsed: string[];
  /** When it was last written, for pruning. */
  at: number;
}

type Stored = Record<string, DayState>;

const EMPTY: DayState = { expanded: [], collapsed: [], at: 0 };

function isDayState(value: unknown): value is DayState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<DayState>;
  return (
    Array.isArray(s.expanded) &&
    s.expanded.every((d) => typeof d === "string") &&
    Array.isArray(s.collapsed) &&
    s.collapsed.every((d) => typeof d === "string") &&
    typeof s.at === "number"
  );
}

function readAll(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Stored = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (isDayState(value)) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Stored) {
  try {
    const entries = Object.entries(all).sort((a, b) => b[1].at - a[1].at);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries.slice(0, MAX_PROJECTS))),
    );
  } catch {
    // Not worth telling anyone about.
  }
}

/** What was remembered for one project; empty lists when nothing was. */
export function readDayState(projectId: string): DayState {
  return readAll()[projectId] ?? EMPTY;
}

export function writeDayState(projectId: string, state: Omit<DayState, "at">): void {
  if (!projectId) return;
  const all = readAll();
  all[projectId] = { ...state, at: Date.now() };
  writeAll(all);
}

/**
 * The days actually open: the view's own defaults, plus what was opened by
 * hand, minus what was closed by hand.
 */
export function effectiveExpanded(defaults: string[], state: DayState): Set<string> {
  const open = new Set([...defaults, ...state.expanded]);
  for (const day of state.collapsed) open.delete(day);
  return open;
}

/**
 * Record a day being opened or closed. Both lists are kept exclusive, so the
 * last thing done to a day is what is remembered about it.
 */
export function toggleDay(state: DayState, day: string, open: boolean): Omit<DayState, "at"> {
  return {
    expanded: open
      ? [...state.expanded.filter((d) => d !== day), day]
      : state.expanded.filter((d) => d !== day),
    collapsed: open
      ? state.collapsed.filter((d) => d !== day)
      : [...state.collapsed.filter((d) => d !== day), day],
  };
}
