import type { Coding, ExcerptWithCodes } from "@/api/types";

/**
 * Who has coded this excerpt, once each, in the order their codings appear.
 *
 * `codings` is absent in a payload from before coder identity; an excerpt
 * from one of those simply has nobody on it, which is what the rest of the
 * UI treats as "not a shared project".
 */
export function coderIdsOf(excerpt: { codings?: Coding[] }): string[] {
  const out: string[] = [];
  for (const c of excerpt.codings ?? []) {
    if (c.coderId && !out.includes(c.coderId)) out.push(c.coderId);
  }
  return out;
}

/** Who applied one particular code to this excerpt, in `codings` order. */
export function codersOfCode(excerpt: { codings?: Coding[] }, codeId: string): string[] {
  return (excerpt.codings ?? []).filter((c) => c.codeId === codeId).map((c) => c.coderId);
}

/** A coder's initials, for the little avatar beside a coding. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/** Narrower type than `ExcerptWithCodes` so these work on any coded thing. */
export type WithCodings = Pick<ExcerptWithCodes, "codings">;
