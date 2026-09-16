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

export type DescriptorKind = "text" | "number" | "choice" | "date";

export interface DescriptorField {
  id: string;
  name: string;
  kind: DescriptorKind;
  /** The allowed values of a `choice` field; empty for every other kind. */
  options: string[];
  sortOrder: number;
  /** How many documents have a value for this field. */
  valueCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewDescriptorField {
  name: string;
  kind: DescriptorKind;
  options?: string[] | null;
}

export interface DescriptorFieldPatch {
  name?: string;
  /** Only allowed while no document has a value for the field. */
  kind?: DescriptorKind;
  options?: string[];
}

export interface DescriptorValue {
  documentId: string;
  fieldId: string;
  value: string;
}

export interface DescriptorMatrixRow {
  documentId: string;
  documentName: string;
  /** field id -> value, only for fields this document has a value for. */
  values: Record<string, string>;
}

export interface DescriptorMatrix {
  fields: DescriptorField[];
  rows: DescriptorMatrixRow[];
}

export type DescriptorOp =
  "eq" | "neq" | "contains" | "gt" | "lt" | "between" | "in" | "empty" | "notEmpty";

export interface DescriptorFilter {
  fieldId: string;
  op: DescriptorOp;
  values: string[];
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
  documentIds?: string[] | null;
  uncodedOnly?: boolean;
  /** Descriptor conditions, ANDed together. */
  descriptors?: DescriptorFilter[] | null;
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
