import type { ExcerptFilter, MemoTarget, SetKind } from "@/api/types";

export const keys = {
  project: ["project"] as const,
  stats: ["stats"] as const,
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
  codeFrequencies: (documentIds: string[], documentSetIds: string[]) =>
    ["analysis", "frequencies", documentIds, documentSetIds] as const,
  coOccurrence: (documentIds: string[], documentSetIds: string[]) =>
    ["analysis", "cooccurrence", documentIds, documentSetIds] as const,
  codeByDocument: ["analysis", "codeByDocument"] as const,
  memos: (target: MemoTarget) => ["memos", target] as const,
  allMemos: ["memos"] as const,
  sets: (kind: SetKind) => ["sets", kind] as const,
  allSets: ["sets"] as const,
  setMembers: (setId: string) => ["setMembers", setId] as const,
  allSetMembers: ["setMembers"] as const,
  savedFilters: ["savedFilters"] as const,
  search: (query: string) => ["search", query] as const,
  backups: ["backups"] as const,
  speakerTurns: (documentId: string) => ["speakerTurns", documentId] as const,
};
