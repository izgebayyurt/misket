/**
 * Whitespace analysis and cleanup for text about to be imported. Runs before
 * `create_document` since document text is immutable after import; the Rust
 * side still normalizes BOM, line endings and NFC on its own.
 */

export interface WhitespaceReport {
  /** Runs of 2 or more consecutive blank lines. */
  blankLineRuns: number;
  /** The longest run of consecutive blank lines found. */
  maxBlankRun: number;
  /** Lines with trailing spaces or tabs. */
  trailingSpaceLines: number;
  /** Lines containing a tab character. */
  tabLines: number;
  /** Lines that look hard-wrapped (see the heuristic in `isHardWrapPair`). */
  hardWrappedLines: number;
  /** Occurrences of U+00A0 (non-breaking space) anywhere in the text. */
  nonBreakingSpaces: number;
  /** Whether any of the above was found. */
  needsTidy: boolean;
}

export interface TidyOptions {
  /** Collapse runs of 2+ blank lines to one, and drop leading/trailing blanks. */
  collapseBlankLines: boolean;
  /** Strip trailing spaces/tabs from every line. */
  trimTrailingSpaces: boolean;
  /** Join a hard-wrapped line with the next one using a single space. */
  unwrapHardBreaks: boolean;
  /** Replace non-breaking spaces and tabs with a normal space and collapse runs of spaces. */
  normalizeSpaces: boolean;
}

// A line ending in one of these (optionally followed by trailing whitespace)
// reads as a finished sentence, so it is not a hard-wrap candidate.
const SENTENCE_END = /[.!?:"”’)…]\s*$/;
const LOWERCASE_START = /^[a-z]/;

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/**
 * True when `line` looks hard-wrapped and should continue onto `next`: both
 * are non-empty, `line` does not end with sentence punctuation, and `next`
 * starts with a lowercase letter.
 */
function isHardWrapPair(line: string, next: string): boolean {
  return (
    !isBlank(line) &&
    !isBlank(next) &&
    !SENTENCE_END.test(line) &&
    LOWERCASE_START.test(next.trimStart())
  );
}

export function analyzeWhitespace(text: string): WhitespaceReport {
  const lines = splitLines(text);
  // A single trailing newline just terminates the last line; it is not a
  // blank line the coder wrote, so don't count it as one.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  let blankLineRuns = 0;
  let maxBlankRun = 0;
  let run = 0;
  const closeRun = () => {
    if (run > 0) {
      maxBlankRun = Math.max(maxBlankRun, run);
      if (run >= 2) blankLineRuns++;
    }
    run = 0;
  };
  for (const line of lines) {
    if (isBlank(line)) run++;
    else closeRun();
  }
  closeRun();

  const trailingSpaceLines = lines.filter((l) => /[ \t]$/.test(l)).length;
  const tabLines = lines.filter((l) => l.includes("\t")).length;
  const nonBreakingSpaces = (text.match(/\u00A0/g) ?? []).length;

  let hardWrappedLines = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (line !== undefined && next !== undefined && isHardWrapPair(line, next)) hardWrappedLines++;
  }

  const needsTidy =
    blankLineRuns > 0 ||
    trailingSpaceLines > 0 ||
    tabLines > 0 ||
    hardWrappedLines > 0 ||
    nonBreakingSpaces > 0;

  return {
    blankLineRuns,
    maxBlankRun,
    trailingSpaceLines,
    tabLines,
    hardWrappedLines,
    nonBreakingSpaces,
    needsTidy,
  };
}

/** Default options: safe cleanups on, line-merging off (it can be surprising). */
export const DEFAULT_TIDY_OPTIONS: TidyOptions = {
  collapseBlankLines: true,
  trimTrailingSpaces: true,
  unwrapHardBreaks: false,
  normalizeSpaces: true,
};

/**
 * Clean up whitespace per `options`. Idempotent for a fixed set of options:
 * `tidyText(tidyText(t, o), o) === tidyText(t, o)`.
 */
export function tidyText(text: string, options: TidyOptions): string {
  let lines = splitLines(text);

  if (options.normalizeSpaces) {
    lines = lines.map((l) => l.replace(/[\t\u00A0]/g, " ").replace(/ {2,}/g, " "));
  }

  if (options.trimTrailingSpaces) {
    lines = lines.map((l) => l.replace(/[ \t]+$/, ""));
  }

  if (options.unwrapHardBreaks) {
    const merged: string[] = [];
    for (const line of lines) {
      const prev = merged.length > 0 ? merged[merged.length - 1] : undefined;
      if (prev !== undefined && isHardWrapPair(prev, line)) {
        merged[merged.length - 1] = `${prev.replace(/[ \t]+$/, "")} ${line.replace(/^[ \t]+/, "")}`;
      } else {
        merged.push(line);
      }
    }
    lines = merged;
  }

  if (options.collapseBlankLines) {
    const collapsed: string[] = [];
    for (const line of lines) {
      if (isBlank(line)) {
        const last = collapsed[collapsed.length - 1];
        if (last === undefined) continue; // drop leading blanks
        if (isBlank(last)) continue; // collapse the run
        collapsed.push("");
      } else {
        collapsed.push(line);
      }
    }
    while (collapsed.length > 0 && isBlank(collapsed[collapsed.length - 1] ?? "")) collapsed.pop();
    lines = collapsed;
  }

  return lines.join("\n");
}

/** Short phrases describing what a report found, for a compact summary in the UI. */
export function summarizeWhitespace(report: WhitespaceReport): string[] {
  const parts: string[] = [];
  if (report.blankLineRuns > 0) {
    parts.push(
      `${report.blankLineRuns} run${report.blankLineRuns === 1 ? "" : "s"} of blank lines (up to ${report.maxBlankRun} in a row)`,
    );
  }
  if (report.trailingSpaceLines > 0) {
    parts.push(
      `${report.trailingSpaceLines} line${report.trailingSpaceLines === 1 ? "" : "s"} with trailing spaces`,
    );
  }
  if (report.tabLines > 0) {
    parts.push(`${report.tabLines} line${report.tabLines === 1 ? "" : "s"} with tabs`);
  }
  if (report.hardWrappedLines > 0) {
    parts.push(
      `${report.hardWrappedLines} hard-wrapped line${report.hardWrappedLines === 1 ? "" : "s"}`,
    );
  }
  if (report.nonBreakingSpaces > 0) {
    parts.push(
      `${report.nonBreakingSpaces} non-breaking space${report.nonBreakingSpaces === 1 ? "" : "s"}`,
    );
  }
  return parts;
}

export interface DiffPreview {
  before: string[];
  after: string[];
  /** 0-based index of `before`/`after` where the shown window starts. */
  startLine: number;
}

/**
 * Find the first region where `before` and `after` differ and return a
 * window of lines around it (a few lines of context, up to `maxLines`) for a
 * side-by-side preview. Returns empty arrays when the texts are identical.
 */
export function previewDiffLines(before: string, after: string, maxLines = 40): DiffPreview {
  const a = splitLines(before);
  const b = splitLines(after);
  const minLen = Math.min(a.length, b.length);
  let i = 0;
  while (i < minLen && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) {
    return { before: [], after: [], startLine: i };
  }
  const context = 3;
  const start = Math.max(0, i - context);
  return {
    before: a.slice(start, start + maxLines),
    after: b.slice(start, start + maxLines),
    startLine: start,
  };
}
