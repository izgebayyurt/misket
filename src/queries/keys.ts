import type { ExcerptFilter, MemoTarget } from "@/api/types";

export const keys = {
  project: ["project"] as const,
  recent: ["recent"] as const,
  documents: ["documents"] as const,
  document: (id: string) => ["document", id] as const,
  codes: ["codes"] as const,
  descriptorFields: ["descriptorFields"] as const,
  descriptorValues: (documentId: string) => ["descriptorValues", documentId] as const,
  allDescriptorValues: ["descriptorValues"] as const,
  descriptorMatrix: ["descriptorMatrix"] as const,
  importableFiles: (dir: string, recursive: boolean) =>
    ["importableFiles", dir, recursive] as const,
  documentExcerpts: (documentId: string) => ["excerpts", documentId] as const,
  excerpt: (id: string) => ["excerpt", id] as const,
  excerptQuery: (filter: ExcerptFilter) => ["excerptQuery", filter] as const,
  excerptQueries: ["excerptQuery"] as const,
  analysis: ["analysis"] as const,
  codeFrequencies: (documentIds: string[]) => ["analysis", "frequencies", documentIds] as const,
  coOccurrence: (documentIds: string[]) => ["analysis", "cooccurrence", documentIds] as const,
  codeByDocument: ["analysis", "codeByDocument"] as const,
  memos: (target: MemoTarget) => ["memos", target] as const,
  allMemos: ["memos"] as const,
  search: (query: string) => ["search", query] as const,
  backups: ["backups"] as const,
};
