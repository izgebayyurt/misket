import type { DescriptorFilter, ExcerptFilter, Query } from "@/api/types";

/**
 * The excerpt browser's filter state: every field an `ExcerptFilter` can set,
 * with no optionals, so applying a saved filter is a plain assignment rather
 * than a merge into whatever happened to be there.
 */
export interface FilterState {
  codeIds: string[];
  codeSetIds: string[];
  includeDescendants: boolean;
  requireAllCodes: boolean;
  documentIds: string[];
  documentSetIds: string[];
  uncodedOnly: boolean;
  /** Restrict to excerpts overlapping one carrying this code (the analysis
   * click-through sets this; no filter control edits it directly). */
  overlapsCodeId: string | null;
  descriptors: DescriptorFilter[];
  /** A Boolean/proximity expression over codes; `null` when none is set. */
  query: Query | null;
  /** Only what these speakers said; empty is no filter. */
  speakers: string[];
  /** Only excerpts coded by these coders; empty means everyone. */
  coderIds: string[];
}

export const emptyFilterState: FilterState = {
  codeIds: [],
  codeSetIds: [],
  includeDescendants: true,
  requireAllCodes: false,
  documentIds: [],
  documentSetIds: [],
  uncodedOnly: false,
  overlapsCodeId: null,
  descriptors: [],
  query: null,
  speakers: [],
  coderIds: [],
};

/** Read a filter (a saved one, or the analysis views' click-through). */
export function filterState(f: ExcerptFilter | undefined | null): FilterState {
  return {
    codeIds: f?.codeIds ?? [],
    codeSetIds: f?.codeSetIds ?? [],
    includeDescendants: f?.includeDescendants ?? true,
    requireAllCodes: f?.requireAllCodes ?? false,
    documentIds: f?.documentIds ?? [],
    documentSetIds: f?.documentSetIds ?? [],
    uncodedOnly: f?.uncodedOnly ?? false,
    overlapsCodeId: f?.overlapsCodeId ?? null,
    descriptors: f?.descriptors ?? [],
    query: f?.query ?? null,
    speakers: f?.speakers ?? [],
    coderIds: f?.coderIds ?? [],
  };
}

/** The other direction: what goes to `query_excerpts` (and into a saved filter). */
export function toFilter(state: FilterState, limit: number, offset = 0): ExcerptFilter {
  return {
    codeIds: state.codeIds.length ? state.codeIds : null,
    codeSetIds: state.codeSetIds.length ? state.codeSetIds : null,
    includeDescendants: state.includeDescendants,
    requireAllCodes: state.requireAllCodes,
    documentIds: state.documentIds.length ? state.documentIds : null,
    documentSetIds: state.documentSetIds.length ? state.documentSetIds : null,
    uncodedOnly: state.uncodedOnly,
    overlapsCodeId: state.overlapsCodeId,
    descriptors: state.descriptors.length ? state.descriptors : null,
    query: state.query,
    speakers: state.speakers.length ? state.speakers : null,
    coderIds: state.coderIds.length ? state.coderIds : null,
    limit,
    offset,
  };
}

/** How many codes the filter names, counting a code set as one pick. */
export function codePickCount(state: FilterState): number {
  return state.codeIds.length + state.codeSetIds.length;
}

export function documentPickCount(state: FilterState): number {
  return state.documentIds.length + state.documentSetIds.length;
}

/** Is anything narrowing the result set? Drives the empty-state wording. */
export function isFiltered(state: FilterState): boolean {
  return (
    codePickCount(state) > 0 ||
    documentPickCount(state) > 0 ||
    state.descriptors.length > 0 ||
    state.uncodedOnly ||
    state.overlapsCodeId !== null ||
    state.query !== null ||
    state.speakers.length > 0 ||
    state.coderIds.length > 0
  );
}
