import type {
  ActivityFilter,
  CrosstabRequest,
  ExcerptFilter,
  MemoTarget,
  SetKind,
  TimelineBucket,
  WordFrequencyOptions,
  WordFrequencyScope,
} from "@/api/types";

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
  wordFrequencies: (scope: WordFrequencyScope, options: WordFrequencyOptions) =>
    ["analysis", "wordFrequencies", scope, options] as const,
  stopWords: ["analysis", "stopWords"] as const,
  codeTimeline: (codeId: string, includeDescendants: boolean, bucket: TimelineBucket) =>
    ["analysis", "codeTimeline", codeId, includeDescendants, bucket] as const,
  /** The saved matrix configurations. */
  frameworkMatrices: ["framework", "matrices"] as const,
  /** One rendered grid. Under "analysis" so a coding change refetches it. */
  frameworkMatrix: (id: string) => ["analysis", "framework", id] as const,
  codeByDescriptor: (request: CrosstabRequest) =>
    ["analysis", "codeByDescriptor", request] as const,
  memos: (target: MemoTarget) => ["memos", target] as const,
  allMemos: ["memos"] as const,
  sets: (kind: SetKind) => ["sets", kind] as const,
  allSets: ["sets"] as const,
  setMembers: (setId: string) => ["setMembers", setId] as const,
  allSetMembers: ["setMembers"] as const,
  savedFilters: ["savedFilters"] as const,
  search: (query: string, regex: boolean, stem: boolean) => ["search", query, regex, stem] as const,
  backups: ["backups"] as const,
  activity: ["activity"] as const,
  activityList: (filter: ActivityFilter) => ["activity", "list", filter] as const,
  codeHistory: (id: string) => ["activity", "code", id] as const,
  excerptHistory: (id: string) => ["activity", "excerpt", id] as const,
  speakerTurns: (documentId: string) => ["speakerTurns", documentId] as const,
  /** One document's transcript: format, turns and speakers. */
  transcript: (documentId: string) => ["transcript", documentId] as const,
  allTranscripts: ["transcript"] as const,
  transcriptDefault: ["transcriptDefault"] as const,
  projectSpeakers: ["projectSpeakers"] as const,
};
