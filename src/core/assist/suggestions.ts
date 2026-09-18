/**
 * Reading an assistant's answer back, defensively.
 *
 * A model asked for JSON returns JSON most of the time. The rest of the time
 * it returns JSON wrapped in a code fence, JSON with a sentence in front of
 * it, an object where an array was asked for, the right shape with the wrong
 * types, or prose. None of that may crash the app or put a code on an
 * excerpt: anything that cannot be read as a suggestion is dropped, and a
 * response with nothing readable in it is an empty list, not an error.
 */

import { MAX_SUGGESTIONS } from "./prompts";

/** One suggestion, after validation: either an existing code or a new name. */
export interface CodeSuggestion {
  /** An id that is really in the codebook, or null for a proposed new code. */
  codeId: string | null;
  /** The proposed name of a code that does not exist yet, or null. */
  newCodeName: string | null;
  /** 0 to 1. Missing or unreadable confidence reads as 0.5. */
  confidence: number;
  rationale: string;
}

/** A definition draft for the code dialog's three fields plus an example. */
export interface DefinitionDraft {
  description: string;
  inclusion: string;
  exclusion: string;
  example: string;
}

const MAX_RATIONALE = 300;
const MAX_NEW_CODE_NAME = 80;
const MAX_FIELD = 2000;

/**
 * The first JSON value in `raw`, whatever it is wrapped in.
 *
 * Tries the whole string, then the contents of a fenced block, then the
 * longest bracketed span. Returns `undefined` rather than throwing.
 */
export function extractJson(raw: string): unknown {
  const attempts: string[] = [];
  const text = raw.trim();
  if (text) attempts.push(text);
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) attempts.push(fence[1].trim());
  for (const [open, close] of [
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) attempts.push(text.slice(start, end + 1));
  }
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as unknown;
    } catch {
      // Next shape.
    }
  }
  return undefined;
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function confidenceOf(value: unknown): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n)) return 0.5;
  // Some models answer 0-100 instead of 0-1.
  const scaled = n > 1 && n <= 100 ? n / 100 : n;
  return Math.min(1, Math.max(0, scaled));
}

/** The array of suggestion-ish objects inside whatever came back. */
function suggestionArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    for (const key of ["suggestions", "codes", "results", "items"]) {
      const value = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
    // A single suggestion returned bare.
    if ("codeId" in parsed || "newCodeName" in parsed) return [parsed];
  }
  return [];
}

/**
 * Every readable suggestion in `raw`, at most `max` of them.
 *
 * A `codeId` that is not in `knownCodeIds` is dropped rather than trusted: a
 * hallucinated id would otherwise show up as a chip that codes the wrong
 * thing. The same code suggested twice is kept once.
 */
export function parseSuggestions(
  raw: string,
  knownCodeIds: ReadonlySet<string>,
  max: number = MAX_SUGGESTIONS,
): CodeSuggestion[] {
  const out: CodeSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of suggestionArray(extractJson(raw))) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const codeId = str(obj.codeId ?? obj.code_id, 200);
    const newCodeName = str(obj.newCodeName ?? obj.new_code_name, MAX_NEW_CODE_NAME);
    const suggestion: CodeSuggestion = {
      codeId: codeId && knownCodeIds.has(codeId) ? codeId : null,
      // An id that does not exist is not quietly turned into a new code.
      newCodeName: codeId ? null : newCodeName || null,
      confidence: confidenceOf(obj.confidence),
      rationale: str(obj.rationale ?? obj.reason, MAX_RATIONALE),
    };
    if (!suggestion.codeId && !suggestion.newCodeName) continue;
    const key = suggestion.codeId ?? `new:${suggestion.newCodeName!.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(suggestion);
    if (out.length >= max) break;
  }
  return out;
}

/** A definition draft from `raw`, or null if there is nothing usable in it. */
export function parseDefinition(raw: string): DefinitionDraft | null {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const draft: DefinitionDraft = {
    description: str(obj.description ?? obj.means, MAX_FIELD),
    inclusion: str(obj.inclusion ?? obj.include_when, MAX_FIELD),
    exclusion: str(obj.exclusion ?? obj.exclude_when, MAX_FIELD),
    example: str(obj.example, MAX_FIELD),
  };
  const empty = !draft.description && !draft.inclusion && !draft.exclusion && !draft.example;
  return empty ? null : draft;
}
