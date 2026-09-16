/**
 * Markdown table writing. Pure: callers hand in rows, get a string back.
 *
 * A framework matrix is written up as a table as often as it is opened in a
 * spreadsheet, so the grid exports both ways.
 */

/**
 * Escape one cell: `|` would end the cell, and a line break would end the
 * row, so a multi-line summary keeps its breaks as `<br>` (which every
 * Markdown renderer that understands tables also understands).
 */
export function mdCell(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("<br>");
}

export interface MarkdownRow {
  label: string;
  values: string[];
}

/**
 * A labelled matrix as a GitHub-flavoured pipe table: `corner` is the
 * top-left header cell, `columns` the column headers, and every row
 * contributes its label plus one cell per column. Short cells are padded so
 * the source is readable on its own.
 */
export function markdownTable(corner: string, columns: string[], rows: MarkdownRow[]): string {
  const header = [corner, ...columns].map(mdCell);
  const body = rows.map((r) => [r.label, ...r.values].map(mdCell));
  const widths = header.map((h, i) =>
    Math.max(3, h.length, ...body.map((cells) => (cells[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    `| ${widths.map((w, i) => (cells[i] ?? "").padEnd(w)).join(" | ")} |`;
  return [
    line(header),
    `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`,
    ...body.map(line),
  ].join("\n");
}
