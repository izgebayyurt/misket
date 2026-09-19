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

/**
 * This module is pure (no react/i18next import — see CLAUDE.md), but the
 * sentences it builds ("A and B", "“and” needs at least 1 code") are
 * user-visible, so every function that assembles one takes a translator and
 * hands back already-localized text rather than English. The caller passes
 * `useTranslation()`'s `t` — see `src/components/excerpts/QueryBuilder.tsx`.
 */
export type QueryT = (key: string, params?: Record<string, unknown>) => string;

/** The translation key for how each operator reads (the picker, and the
 * word joining terms in a sentence). */
export const OP_LABEL_KEY: Record<QueryOp, string> = {
  and: "excerpts.query.op.and",
  or: "excerpts.query.op.or",
  not: "excerpts.query.op.not",
  near: "excerpts.query.op.near",
};

/** What each operator does, for the builder's help text. */
export const OP_HELP_KEY: Record<QueryOp, string> = {
  and: "excerpts.query.help.and",
  or: "excerpts.query.help.or",
  not: "excerpts.query.help.not",
  near: "excerpts.query.help.near",
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
export function validate(query: Query, t: QueryT, depth = 0): string | null {
  if (depth > MAX_DEPTH) return t("excerpts.query.errors.tooDeep");
  if (!QUERY_OPS.includes(query.op)) return t("excerpts.query.errors.unknownOp", { op: query.op });
  const need = minTerms(query.op);
  if (query.terms.length < need) {
    return t("excerpts.query.errors.needsAtLeast", { op: t(OP_LABEL_KEY[query.op]), count: need });
  }
  const within = query.within;
  if (query.op === "near" && within?.kind === "chars") {
    if (!Number.isFinite(within.n) || within.n < 0 || within.n > MAX_NEAR_CHARS) {
      return t("excerpts.query.errors.outOfRange", { n: within.n });
    }
  }
  for (const term of query.terms) {
    if (isCodeRef(term)) {
      if (!term.codeId.trim()) return t("excerpts.query.errors.needsCode");
    } else {
      const inner = validate(term, t, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

/** The scope as it reads in a sentence: "(same paragraph)". */
function describeWithin(within: QueryWithin | null | undefined, t: QueryT): string {
  if (within?.kind === "chars") {
    return ` ${t("excerpts.query.withinChars", { count: within.n })}`;
  }
  return ` ${t("excerpts.query.withinParagraph")}`;
}

function describeTerm(
  term: QueryTerm,
  codeName: (id: string) => string,
  t: QueryT,
  depth: number,
): string {
  if (isCodeRef(term)) {
    const name = codeName(term.codeId) || t("excerpts.query.unknownCode");
    return term.includeDescendants ? name : t("excerpts.query.termNoSubcodes", { name });
  }
  const inner = describe(term, codeName, t, depth + 1);
  return depth === 0 && term.terms.length > 1 ? `(${inner})` : inner;
}

function describe(
  query: Query,
  codeName: (id: string) => string,
  t: QueryT,
  depth: number,
): string {
  const parts = query.terms.map((term) => describeTerm(term, codeName, t, depth));
  const joined = parts.join(` ${t(OP_LABEL_KEY[query.op])} `);
  return query.op === "near" ? joined + describeWithin(query.within, t) : joined;
}

/**
 * The query as a sentence: "A and B", "A near B (same paragraph)",
 * "A and (B or C)". Used for the filter chip, the saved-filter list and the
 * builder's own heading, so all three read the same.
 */
export function describeQuery(
  query: Query | null | undefined,
  codeName: (id: string) => string,
  t: QueryT,
): string {
  if (!query) return "";
  return describe(query, codeName, t, 0);
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
