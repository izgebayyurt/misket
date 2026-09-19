/**
 * Pure parsing for the codebook import dialog's preview: sniff JSON vs CSV,
 * reduce either to a flat list of full name paths, and count how many
 * already exist in the current project. The actual import runs in Rust
 * (`db::codebook_import`); this only powers the confirmation preview.
 */
import { parseCsv } from "./csv";

/** A translator, so this module can hand back a localized error message
 * without importing react/i18next itself (src/core stays framework-free —
 * see CLAUDE.md). The caller passes `useTranslation()`'s `t`. */
export type CodebookImportT = (key: string, params?: Record<string, unknown>) => string;

export interface ParsedCodebookEntry {
  path: string[];
  color?: string;
  description: string;
  /** Empty for codebooks written before the definition fields existed. */
  inclusion: string;
  exclusion: string;
  shortcut?: string;
}

export type CodebookFileFormat = "json" | "csv";

export interface CodebookParseResult {
  format: CodebookFileFormat;
  entries: ParsedCodebookEntry[];
}

/** A `misket-codebook` JSON export starts with `{`; anything else is CSV. */
export function sniffCodebookFormat(text: string): CodebookFileFormat {
  return text.trimStart().startsWith("{") ? "json" : "csv";
}

interface JsonCode {
  id: string;
  parentId: string | null;
  name: string;
  color?: string;
  description?: string;
  inclusion?: string;
  exclusion?: string;
  shortcut?: string | null;
}

function parseCodebookJson(text: string, t: CodebookImportT): ParsedCodebookEntry[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new Error(
      t("codebook.import.errorInvalidJson", {
        message: e instanceof Error ? e.message : String(e),
      }),
      { cause: e },
    );
  }
  const obj = doc as { format?: unknown; codes?: unknown };
  if (!obj || obj.format !== "misket-codebook" || !Array.isArray(obj.codes)) {
    throw new Error(t("codebook.import.errorNotCodebook"));
  }
  const codes = obj.codes as JsonCode[];
  const byId = new Map(codes.map((c) => [c.id, c]));
  return codes.map((c) => {
    const parts = [c.name];
    let cur: string | null = c.parentId ?? null;
    let guard = 0;
    while (cur) {
      guard++;
      if (guard > 64) break;
      const parent = byId.get(cur);
      if (!parent) break;
      parts.push(parent.name);
      cur = parent.parentId ?? null;
    }
    parts.reverse();
    return {
      path: parts,
      color: c.color || undefined,
      description: c.description ?? "",
      inclusion: c.inclusion ?? "",
      exclusion: c.exclusion ?? "",
      shortcut: c.shortcut ?? undefined,
    };
  });
}

const CSV_HEADER = ["name", "parent", "color", "description", "inclusion", "exclusion", "shortcut"];
/** The header Misket wrote before the definition fields existed. */
const CSV_HEADER_LEGACY = ["name", "parent", "color", "description", "shortcut"];

function parseCodebookCsv(text: string, t: CodebookImportT): ParsedCodebookEntry[] {
  const rows = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ""));
  if (rows.length === 0) throw new Error(t("codebook.import.errorEmptyCsv"));
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const legacy = header.join(",") === CSV_HEADER_LEGACY.join(",");
  if (!legacy && header.join(",") !== CSV_HEADER.join(",")) {
    throw new Error(
      t("codebook.import.errorBadHeader", {
        expected: CSV_HEADER.join(","),
        found: header.join(","),
      }),
    );
  }
  const entries: ParsedCodebookEntry[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 1;
    const get = (idx: number) => (row[idx] ?? "").trim();
    const name = get(0);
    if (!name) throw new Error(t("codebook.import.errorNameRequired", { row: rowNum }));
    const parent = get(1);
    const path = parent ? [...parent.split(" / ").map((s) => s.trim()), name] : [name];
    entries.push({
      path,
      color: get(2) || undefined,
      description: get(3),
      inclusion: legacy ? "" : get(4),
      exclusion: legacy ? "" : get(5),
      shortcut: (legacy ? get(4) : get(6)) || undefined,
    });
  }
  return entries;
}

/** Parse a codebook file's text, sniffing its format first. */
export function parseCodebookFile(text: string, t: CodebookImportT): CodebookParseResult {
  const format = sniffCodebookFormat(text);
  return {
    format,
    entries: format === "json" ? parseCodebookJson(text, t) : parseCodebookCsv(text, t),
  };
}

export interface CodebookImportPreview {
  format: CodebookFileFormat;
  totalCodes: number;
  matchedCount: number;
  newCount: number;
}

/**
 * How many parsed entries would match an existing code by full path
 * (case-insensitively) versus be created new. `existingPaths` are full
 * " / "-joined paths of the codes already in the project.
 */
export function previewCodebookImport(
  text: string,
  existingPaths: string[],
  t: CodebookImportT,
): CodebookImportPreview {
  const { format, entries } = parseCodebookFile(text, t);
  const known = new Set(existingPaths.map((p) => p.toLowerCase()));
  let matched = 0;
  for (const e of entries) {
    if (known.has(e.path.join(" / ").toLowerCase())) matched++;
  }
  return {
    format,
    totalCodes: entries.length,
    matchedCount: matched,
    newCount: entries.length - matched,
  };
}
