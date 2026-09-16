// Hand-written mirrors of the Rust DTOs in crates/misket-core/src/models.rs (camelCase).

export type AppErrorCode =
  "NoProjectOpen" | "NotFound" | "Conflict" | "Validation" | "NewerSchema" | "Io" | "Db";

export interface ProjectCounts {
  documents: number;
  codes: number;
  excerpts: number;
  memos: number;
}

export interface ProjectInfo {
  path: string;
  name: string;
  projectId: string;
  schemaVersion: number;
  counts: ProjectCounts;
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export type DocumentKind = "text" | "image" | "video";

export interface NewDocument {
  name: string;
  sourcePath?: string | null;
  sourceFormat: string;
  text: string;
  allowDuplicate?: boolean;
}

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  name: string;
  sourcePath: string | null;
  sourceFormat: string | null;
  textLength: number | null;
  sortOrder: number;
  excerptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Document extends DocumentSummary {
  text: string | null;
}

export interface Code {
  id: string;
  parentId: string | null;
  name: string;
  color: string;
  description: string;
  shortcut: string | null;
  sortOrder: number;
  excerptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewCode {
  name: string;
  color?: string;
  description?: string;
  parentId?: string | null;
  shortcut?: string | null;
}

export interface CodePatch {
  name?: string;
  color?: string;
  description?: string;
  /** `null` clears the shortcut; omit to leave unchanged. */
  shortcut?: string | null;
}

export type ChildrenStrategy = "delete" | "promote";

export interface DeleteCodeReport {
  deletedCodeIds: string[];
  affectedExcerptCount: number;
}

export interface CodeImpact {
  descendantCount: number;
  excerptCount: number;
}

export type ExcerptKind = "text" | "image_region" | "video_range";

export interface ExcerptWithCodes {
  id: string;
  documentId: string;
  kind: ExcerptKind;
  startPos: number | null;
  endPos: number | null;
  geometry: string | null;
  snapshot: string | null;
  codeIds: string[];
  memoCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApplyCodesInput {
  documentId: string;
  startPos: number;
  endPos: number;
  codeIds: string[];
}

export interface ApplyResult {
  excerpt: ExcerptWithCodes;
  created: boolean;
  addedCodeIds: string[];
}

export interface Memo {
  id: string;
  documentId: string | null;
  codeId: string | null;
  excerptId: string | null;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoTarget {
  documentId?: string | null;
  codeId?: string | null;
  excerptId?: string | null;
}

export interface ExcerptDetail extends ExcerptWithCodes {
  documentName: string;
  contextBefore: string;
  contextAfter: string;
  memos: Memo[];
}

export interface ExcerptSnapshot {
  excerpt: ExcerptWithCodes;
  memos: Memo[];
}

export interface ExcerptFilter {
  codeIds?: string[] | null;
  includeDescendants?: boolean;
  /** All listed codes must be present (default: any of them). */
  requireAllCodes?: boolean;
  documentIds?: string[] | null;
  uncodedOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ExcerptRow extends ExcerptWithCodes {
  documentName: string;
  contextBefore: string;
  contextAfter: string;
}

export interface ExcerptPage {
  rows: ExcerptRow[];
  total: number;
}

// ----------------------------------------------------------------- analysis

export interface CodeFrequency {
  codeId: string;
  /** Excerpts tagged with this code itself. */
  own: number;
  /** Distinct excerpts tagged with this code or any descendant. */
  withDescendants: number;
  /** Documents holding at least one descendant-inclusive excerpt. */
  documentCount: number;
  /** `[documentId, count]`, descendant-inclusive, in project document order. */
  perDocument: [string, number][];
}

/** `[rowCodeId, columnCodeId, count]`. */
export type MatrixCell = [string, string, number];

export interface CoOccurrence {
  codeIds: string[];
  /** Sparse and symmetric: every non-zero pair appears in both orientations. */
  cells: MatrixCell[];
}

export interface CodeByDocument {
  documentIds: string[];
  codeIds: string[];
  /** Sparse `[documentId, codeId, count]`, direct tags only. */
  cells: MatrixCell[];
}

export interface SearchHit {
  documentId: string;
  documentName: string;
  startPos: number;
  endPos: number;
  contextBefore: string;
  contextAfter: string;
}
