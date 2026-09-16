/** RFC 4180 CSV writing. Pure: callers hand in rows, get a string back. */

export type CsvValue = string | number | null | undefined;

const NEEDS_QUOTES = /[",\r\n]/;

/** Quote a single field, doubling any embedded quotes. */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "number" ? String(value) : value;
  return NEEDS_QUOTES.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Rows to CSV text with CRLF terminators (what spreadsheets expect). */
export function toCsv(rows: CsvValue[][]): string {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
}

export interface MatrixRow {
  label: string;
  values: CsvValue[];
}

/**
 * A labelled matrix: `corner` is the top-left header cell, `columns` the
 * column headers, and every row contributes its label plus one cell per column.
 */
export function matrixCsv(corner: string, columns: string[], rows: MatrixRow[]): string {
  return toCsv([[corner, ...columns], ...rows.map((r) => [r.label, ...r.values])]);
}
