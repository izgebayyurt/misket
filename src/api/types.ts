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
  /** Set when the project file lives inside a cloud-synced folder (Dropbox,
   * OneDrive, iCloud Drive, ...); ready to show as-is. */
  syncWarning: string | null;
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpenedAt: string;
}

/** Everything the overview screen shows. */
export interface ProjectStats {
  documents: number;
  textDocuments: number;
  imageDocuments: number;
  codes: number;
  excerpts: number;
  /** Excerpts tagged with at least one code. */
  codedExcerpts: number;
  memos: number;
  descriptorFields: number;
  /** Code points, summed over text documents. */
  totalTextLength: number;
  /** Latest `updatedAt` across documents, codes, excerpts and memos. */
  lastActivityAt: string | null;
  /** `[date "YYYY-MM-DD", count]`, oldest first, one per of the last 30 days. */
  excerptsPerDay: [string, number][];
  /** `[codeId, count]`, direct tags only, highest first, top 8. */
  topCodes: [string, number][];
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
  /** Show a paragraph number in the document view's left gutter. */
  showParagraphNumbers: boolean;
  /** Recorded as the actor in the activity log; empty means the OS user name. */
  coderName?: string | null;
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

/** One code in a `Query`, with the same "include sub-codes" choice. */
export interface CodeRef {
  codeId: string;
  includeDescendants: boolean;
}

export type QueryOp = "and" | "or" | "not" | "near";

/** How close `near` counts as near; the default is the same paragraph. */
export type QueryWithin = { kind: "paragraph" } | { kind: "chars"; n: number };

/** A `Query` operand: a code, or a nested query. */
export type QueryTerm = CodeRef | Query;

/**
 * A Boolean/proximity expression over codes, applied in Rust to the excerpts
 * the rest of the filter leaves. The semantics are "co-located": an excerpt
 * satisfies a term when it carries the code itself or overlaps an excerpt
 * that does. See `src/core/query.ts` and `docs/DATA_MODEL.md`.
 */
export interface Query {
  op: QueryOp;
  terms: QueryTerm[];
  within?: QueryWithin | null;
}

export interface ExcerptFilter {
  codeIds?: string[] | null;
  /** Code sets; each stands for all of its members, as if every member were
   * ticked in `codeIds`. */
  codeSetIds?: string[] | null;
  includeDescendants?: boolean;
  /** All listed codes must be present (default: any of them). */
  requireAllCodes?: boolean;
  documentIds?: string[] | null;
  /** Document sets; unioned into `documentIds`. */
  documentSetIds?: string[] | null;
  uncodedOnly?: boolean;
  /** Restrict results to excerpts that overlap at least one excerpt carrying
   * this code (subject to `includeDescendants`, same as the main code
   * filter). Matches how `co_occurrence` counts pairs: text ranges only. */
  overlapsCodeId?: string | null;
  /** Descriptor conditions, ANDed together. */
  descriptors?: DescriptorFilter[] | null;
  /** A Boolean/proximity expression over codes ("A and B", "A not near B"),
   * applied to text excerpts before paging. */
  query?: Query | null;
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

/** One range to auto-code (a search match, or one already expanded to its
 * sentence/paragraph). */
export interface AutoCodeHit {
  documentId: string;
  startPos: number;
  endPos: number;
}

/**
 * What `autoCode` did. Each hit either created a fresh excerpt
 * (`createdExcerptIds`) or reused one that already covered that exact range,
 * adding the code only if it was missing (`reusedExcerptIds`); a hit whose
 * excerpt already carried the code only counts toward `alreadyCoded`. Undo
 * deletes `createdExcerptIds` and removes the code from `reusedExcerptIds`.
 */
export interface AutoCodeReport {
  createdExcerptIds: string[];
  reusedExcerptIds: string[];
  alreadyCoded: number;
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

export type SetKind = "code" | "document";

/** A named group of codes or of documents. */
export interface SetInfo {
  id: string;
  kind: SetKind;
  name: string;
  sortOrder: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A deleted set plus its members, so undo can recreate it unchanged. */
export interface SetWithMembers {
  set: SetInfo;
  memberIds: string[];
}

/** A named `ExcerptFilter`. */
export interface SavedFilter {
  id: string;
  name: string;
  filter: ExcerptFilter;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
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

/** One column of the code-by-descriptor cross-tab. */
export interface CrosstabColumn {
  /** The header: a value, `"18 – 30.5"`, `"2026-09"` or `"(no value)"`. */
  label: string;
  /** The `DescriptorFilter` operator that reproduces this column. */
  op: DescriptorOp;
  values: string[];
}

export interface CrosstabRow {
  codeId: string;
  /** One count per column, in `columns` order. */
  cells: number[];
}

/** What a cell counts: excerpts (the default) or distinct documents. */
export type CrosstabMode = "excerpts" | "documents";

export interface CrosstabRequest {
  fieldId: string;
  /** Rows; every code when absent or empty. */
  codeIds?: string[] | null;
  includeDescendants?: boolean;
  documentIds?: string[] | null;
  documentSetIds?: string[] | null;
  /** Number fields only: equal-width bins between min and max (default 4). */
  bins?: number | null;
  mode?: CrosstabMode | null;
}

export interface CodeByDescriptor {
  field: DescriptorField;
  columns: CrosstabColumn[];
  rows: CrosstabRow[];
  /** Documents in scope per column, whether or not anything in them is coded. */
  documentsPerColumn: number[];
  mode: CrosstabMode;
}

export interface SearchHit {
  documentId: string;
  documentName: string;
  startPos: number;
  endPos: number;
  /** The exact matched text (not the query/pattern). */
  matchedText: string;
  contextBefore: string;
  contextAfter: string;
}

// ---------------------------------------------------------------- framework

export type FrameworkRowKind = "document" | "descriptor_value";

/**
 * A saved framework matrix: cases down the side, themes across the top. Only
 * the configuration is stored; `getFrameworkMatrix` recomputes the rows.
 */
export interface FrameworkMatrix {
  id: string;
  name: string;
  rowKind: FrameworkRowKind;
  /** The descriptor field the rows group by, when `rowKind` is `descriptor_value`. */
  rowFieldId: string | null;
  /** Restrict the rows to this document set's members; null means every document. */
  rowSetId: string | null;
  /** Take the columns from this code set; null means use `codeIds`. */
  codeSetId: string | null;
  /** The columns, in column order, when `codeSetId` is null. */
  codeIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** A whole configuration, so undo is "apply the previous one". */
export interface FrameworkMatrixInput {
  name: string;
  rowKind: FrameworkRowKind;
  rowFieldId?: string | null;
  rowSetId?: string | null;
  codeSetId?: string | null;
  codeIds: string[];
}

export interface FrameworkRow {
  /** The document id, or the descriptor value (empty for "no value"). */
  rowKey: string;
  label: string;
  documentIds: string[];
}

export interface FrameworkCell {
  rowKey: string;
  codeId: string;
  summary: string;
  /** Distinct excerpts in the row's documents carrying this code or a descendant. */
  excerptCount: number;
}

export interface FrameworkMatrixView {
  matrix: FrameworkMatrix;
  rows: FrameworkRow[];
  /** Code ids, in column order. */
  columns: string[];
  /** One per (row, column) pair, rows outermost. */
  cells: FrameworkCell[];
}

/** A deleted matrix with every summary it held, so undo can put it back. */
export interface FrameworkMatrixWithCells {
  matrix: FrameworkMatrix;
  /** `[rowKey, codeId, summary]`. */
  cells: [string, string, string][];
}

/** One speaker's turn detected in a document (see `detectSpeakerTurns`).
 * Code points, end-exclusive; the label itself is excluded. */
export interface SpeakerTurn {
  speaker: string;
  start: number;
  end: number;
}

// ------------------------------------------------------------------ backups

export interface BackupInfo {
  path: string;
  /** RFC 3339 UTC. */
  createdAt: string;
  reason: string;
  sizeBytes: number;
}

// ------------------------------------------------------------- activity log

/** One row of `activity_log`: something that happened to the project. */
export interface ActivityEntry {
  id: number;
  at: string;
  /** Whoever was at the keyboard; empty when no name was ever set. */
  actor: string;
  /** A dotted verb: `code.created`, `excerpt.split`, `undo`, … */
  kind: string;
  targetKind: string;
  targetId: string | null;
  summary: string;
  /** `detail_json`, already parsed. Shape depends on `kind`. */
  detail: Record<string, unknown>;
}

export interface ActivityFilter {
  targetKind?: string | null;
  targetId?: string | null;
  kinds?: string[] | null;
  /** Only entries at or after this timestamp. */
  since?: string | null;
  limit?: number;
  offset?: number;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  /** Matches for the filter, ignoring `limit`/`offset`. */
  total: number;
  /** Every kind present in the whole log, sorted. */
  kinds: string[];
}
