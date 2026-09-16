// Pure helpers for the excerpt browser's Boolean/proximity query: how a
// query reads as a sentence, what makes one valid, and the small edits the
// builder makes. No React, no Tauri. The semantics live in Rust
// (`crates/misket-core/src/db/query_expr.rs`); this file only describes them.

import type { CodeRef, Query, QueryOp, QueryTerm, QueryWithin } from "@/api/types";

/** How deep a query may nest; mirrors `MAX_DEPTH` in Rust. */
const MAX_DEPTH = 8;
/** The largest `within N characters`; mirrors `MAX_CHARS` in Rust. */
export const MAX_NEAR_CHARS = 10_000_000;

export const QUERY_OPS: QueryOp[] = ["and", "or", "not", "near"];

/** What each operator does, for the builder's help text. */
export const OP_HELP: Record<QueryOp, string> = {
  and: "both, on the same or overlapping passages",
  or: "either one",
  not: "the first, where the second does not overlap it",
  near: "the first, close to the second",
};

export function isCodeRef(term: QueryTerm): term is CodeRef {
  return (term as CodeRef).codeId !== undefined;
}

export function codeRef(codeId: string, includeDescendants = true): CodeRef {
  return { codeId, includeDescendants };
}

/** A fresh two-code query, what the "Query" chip starts you with. */
export function emptyQuery(op: QueryOp = "and"): Query {
  return {
    op,
    terms: [codeRef(""), codeRef("")],
    within: op === "near" ? { kind: "paragraph" } : null,
  };
}

/** How many terms an operator needs at minimum. */
export function minTerms(op: QueryOp): number {
  return op === "and" || op === "or" ? 1 : 2;
}

/** `near` is the only operator with a scope, and it always has one. */
export function withinFor(op: QueryOp, within: QueryWithin | null | undefined): QueryWithin | null {
  if (op !== "near") return null;
  return within ?? { kind: "paragraph" };
}

/**
 * Why this query cannot run, or `null` when it can. The same rules Rust
 * enforces, checked early so the builder can grey out "Apply" instead of
 * bouncing off an error toast.
 */
export function validate(query: Query, depth = 0): string | null {
  if (depth > MAX_DEPTH) return "This query nests too deeply.";
  if (!QUERY_OPS.includes(query.op)) return `Unknown operator “${query.op}”.`;
  const need = minTerms(query.op);
  if (query.terms.length < need) {
    return `“${query.op}” needs at least ${need} code${need === 1 ? "" : "s"}.`;
  }
  const within = query.within;
  if (query.op === "near" && within?.kind === "chars") {
    if (!Number.isFinite(within.n) || within.n < 0 || within.n > MAX_NEAR_CHARS) {
      return `A distance of ${within.n} characters is out of range.`;
    }
  }
  for (const term of query.terms) {
    if (isCodeRef(term)) {
      if (!term.codeId.trim()) return "Every row needs a code.";
    } else {
      const inner = validate(term, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

/** The scope as it reads in a sentence: "(same paragraph)". */
function describeWithin(within: QueryWithin | null | undefined): string {
  if (within?.kind === "chars") {
    return ` (within ${within.n} character${within.n === 1 ? "" : "s"})`;
  }
  return " (same paragraph)";
}

function describeTerm(term: QueryTerm, codeName: (id: string) => string, depth: number): string {
  if (isCodeRef(term)) {
    const name = codeName(term.codeId) || "?";
    return term.includeDescendants ? name : `${name} (no sub-codes)`;
  }
  const inner = describe(term, codeName, depth + 1);
  return depth === 0 && term.terms.length > 1 ? `(${inner})` : inner;
}

function describe(query: Query, codeName: (id: string) => string, depth: number): string {
  const parts = query.terms.map((t) => describeTerm(t, codeName, depth));
  const joined = parts.join(` ${query.op} `);
  return query.op === "near" ? joined + describeWithin(query.within) : joined;
}

/**
 * The query as a sentence: "A and B", "A near B (same paragraph)",
 * "A and (B or C)". Used for the filter chip, the saved-filter list and the
 * builder's own heading, so all three read the same.
 */
export function describeQuery(
  query: Query | null | undefined,
  codeName: (id: string) => string,
): string {
  if (!query) return "";
  return describe(query, codeName, 0);
}

// ------------------------------------------------------------ small edits

/** Replace the term at `index`, returning a new query. */
export function setTerm(query: Query, index: number, term: QueryTerm): Query {
  return { ...query, terms: query.terms.map((t, i) => (i === index ? term : t)) };
}

export function addTerm(query: Query, term: QueryTerm): Query {
  return { ...query, terms: [...query.terms, term] };
}

/** Drop a term, keeping at least the minimum the operator needs. */
export function removeTerm(query: Query, index: number): Query {
  const terms = query.terms.filter((_, i) => i !== index);
  while (terms.length < minTerms(query.op)) terms.push(codeRef(""));
  return { ...query, terms };
}

/** Change the operator, fixing up the term count and the `near` scope. */
export function setOp(query: Query, op: QueryOp): Query {
  const terms = [...query.terms];
  while (terms.length < minTerms(op)) terms.push(codeRef(""));
  return { ...query, op, terms, within: withinFor(op, query.within) };
}
