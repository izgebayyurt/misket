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

// Mirrors AppSettings in src-tauri/src/settings.rs (app-level, not project data).
export type Theme = "system" | "light" | "dark";

export interface AppSettings {
  theme: Theme;
  editorFontSize: number;
  editorLineHeight: number;
  confirmDeleteExcerpt: boolean;
  /** How many timestamped backups to keep per project. */
  keepBackups: number;
}

export type DocumentKind = "text" | "image" | "video";

/** Size and MIME of an image (later: video) document's stored media. */
export interface MediaInfo {
  width: number;
  height: number;
  mime: string;
}

/**
 * An image import. The bytes are copied into the project file; when they are
 * omitted the backend reads them from `sourcePath`, which keeps megabytes off
 * the IPC bridge.
 */
export interface NewImageDocument {
  name: string;
  sourcePath?: string | null;
  mime: string;
  width: number;
  height: number;
  bytes?: number[] | null;
  allowDuplicate?: boolean;
}

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
  /** Image and video documents only. */
  media: MediaInfo | null;
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

/** `merge` matches existing codes by full name path; `add-under` grafts
 * everything fresh under `parentId` (root if omitted/null), unmatched. */
export type CodebookImportMode = "merge" | "add-under";

export interface ImportReport {
  created: number;
  matched: number;
  skippedShortcuts: string[];
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

/** A region of an image, as fractions of its width and height (0..1). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `kind` defaults to `text`, which uses `startPos`/`endPos`; `image_region` uses `geometry`. */
export interface ApplyCodesInput {
  documentId: string;
  kind?: ExcerptKind;
  startPos?: number | null;
  endPos?: number | null;
  geometry?: Rect | null;
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

/** The two halves left by `split_excerpt`; `left` keeps the original id. */
export interface SplitResult {
  left: ExcerptWithCodes;
  right: ExcerptWithCodes;
}

/**
 * The outcome of `merge_excerpts`, with everything needed to invert it: the
 * surviving excerpt, a snapshot of the one that was removed, the survivor's
 * range before the merge and the codes the merge added to it.
 */
export interface MergeResult {
  excerpt: ExcerptWithCodes;
  removed: ExcerptSnapshot;
  previousStartPos: number;
  previousEndPos: number;
  addedCodeIds: string[];
}

export interface ExcerptFilter {
  codeIds?: string[] | null;
  includeDescendants?: boolean;
  /** All listed codes must be present (default: any of them). */
  requireAllCodes?: boolean;
  documentIds?: string[] | null;
  uncodedOnly?: boolean;
  /** Descriptor conditions, ANDed together. */
  descriptors?: DescriptorFilter[] | null;
  limit?: number;
  offset?: number;
}

/** `[excerptId, codeId]`. */
export type ExcerptCodePair = [string, string];

/**
 * What a bulk code change actually did. `affected` counts the excerpts that
 * really changed; `pairs` holds every tag inserted (by `addCodesToExcerpts`)
 * or deleted (by `removeCodesFromExcerpts`), which is exactly what undo has
 * to reverse.
 */
export interface BulkCodeReport {
  affected: number;
  pairs: ExcerptCodePair[];
}

export interface RetagReport {
  /** Excerpts that gained the target code and lost the source code. */
  moved: string[];
  /** Excerpts that already carried the target, so they only lost the source. */
  alreadyHad: string[];
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

// ------------------------------------------------------------------ backups

export interface BackupInfo {
  path: string;
  /** RFC 3339 UTC. */
  createdAt: string;
  reason: string;
  sizeBytes: number;
}
