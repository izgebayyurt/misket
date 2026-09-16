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

/**
 * RFC 4180 CSV reading: quoted fields (with embedded commas, newlines and
 * doubled quotes), CRLF or LF line endings, and a trailing blank line
 * ignored. Every row has the same number of fields as the widest row seen
 * so far is not enforced here; callers check column counts themselves.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Trailing content (no final newline) becomes one more row; a lone
  // trailing newline should not add an empty row.
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
