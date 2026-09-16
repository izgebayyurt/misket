import type { ExcerptFilter, MemoTarget } from "@/api/types";

export const keys = {
  project: ["project"] as const,
  recent: ["recent"] as const,
  documents: ["documents"] as const,
  document: (id: string) => ["document", id] as const,
  codes: ["codes"] as const,
  documentExcerpts: (documentId: string) => ["excerpts", documentId] as const,
  excerpt: (id: string) => ["excerpt", id] as const,
  excerptQuery: (filter: ExcerptFilter) => ["excerptQuery", filter] as const,
  excerptQueries: ["excerptQuery"] as const,
  memos: (target: MemoTarget) => ["memos", target] as const,
  allMemos: ["memos"] as const,
  search: (query: string) => ["search", query] as const,
};
