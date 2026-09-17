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
  /** Lay a transcript's speaker labels out in a gutter beside the text
   * instead of leaving them inline where they are stored. */
  showSpeakerGutter: boolean;
  /** Recorded as the actor in the activity log, and the local coder's name;
   * empty means the OS user name. */
  coderName?: string | null;
  /** This install's coder id: a UUID generated once and never changed. It is
   * what tells two people's copies of a project apart. Absent until the app
   * has needed it once. */
  coderId?: string | null;
  /** The colour this coder's work is drawn in; absent means "pick one". */
  coderColor?: string | null;
  /** Colour the document view's underline lanes by who applied the code
   * rather than by the code itself. */
  lanesByCoder: boolean;
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
  /** The speakers this document's transcript format finds, in first-seen
   * order; empty for anything that is not a transcript. */
  speakers: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Document extends DocumentSummary {
  text: string | null;
}

/** A numeric scale a code's applications can be rated on ("code weights" in
 * Dedoose's terms): intensity 1..5, a -2..+2 sentiment, and so on.
 * `min < max`, `step > 0`, `default` within `[min, max]`. `labels` keys are
 * the value formatted the same way the value itself displays (usually just
 * the two ends, e.g. `{"1": "weak", "5": "strong"}`). */
export interface WeightScale {
  min: number;
  max: number;
  step: number;
  default: number;
  labels?: Record<string, string>;
}

export interface Code {
  id: string;
  parentId: string | null;
  name: string;
  color: string;
  /** What the code means. */
  description: string;
  /** When to apply it. */
  inclusion: string;
  /** When not to apply it, and what to use instead. */
  exclusion: string;
  /** One already-coded excerpt held up as the canonical instance; cleared if
   * that excerpt is deleted. */
  exampleExcerptId: string | null;
  shortcut: string | null;
  /** The rating scale this code's codings can carry a weight on, if any. */
  weightScale?: WeightScale | null;
  sortOrder: number;
  excerptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewCode {
  name: string;
  color?: string;
  description?: string;
  inclusion?: string;
  exclusion?: string;
  parentId?: string | null;
  shortcut?: string | null;
}

export interface CodePatch {
  name?: string;
  color?: string;
  description?: string;
  inclusion?: string;
  exclusion?: string;
  /** `null` clears the shortcut; omit to leave unchanged. */
  shortcut?: string | null;
  /** `null` clears the example excerpt; omit to leave unchanged. */
  exampleExcerptId?: string | null;
  /** `null` clears the weight scale (nulling every weight under this code);
   * omit to leave it unchanged. */
  weightScale?: WeightScale | null;
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
  /** Every code on this excerpt, once, whoever applied it. */
  codeIds: string[];
  /** The same codings with their coders, one entry per `excerpt_codes` row:
   * two people who applied the same code are two codings and one `codeIds`
   * entry. Absent in a payload from before coder identity. */
  codings?: Coding[];
  memoCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One code applied to one excerpt by one coder. */
export interface Coding {
  codeId: string;
  coderId: string;
  /** This coder's value on the code's scale, or absent/null if the code has
   * no scale or this coding has not been rated. */
  weight?: number | null;
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

/** One coder: an install of Misket, identified by a UUID kept in its settings. */
export interface Coder {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

/** A coder with how much of the project is theirs. */
export interface CoderSummary {
  id: string;
  name: string;
  color: string;
  /** `excerpt_codes` rows, not distinct excerpts. */
  codingCount: number;
  memoCount: number;
  /** Whether this is the coder this install writes as. */
  isLocal: boolean;
}

export interface Memo {
  id: string;
  documentId: string | null;
  codeId: string | null;
  excerptId: string | null;
  title: string;
  body: string;
  /** Who wrote it; empty in a payload from before coder identity. */
  coderId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoTarget {
  documentId?: string | null;
  codeId?: string | null;
  excerptId?: string | null;
}

/** What in vivo coding produced: the new code and the excerpt it tagged. */
export interface InVivoResult {
  code: Code;
  excerpt: ExcerptWithCodes;
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
  /** The excerpt's tags with their own timestamps; absent in older snapshots. */
  tags?: TagRow[];
}

/** One `excerpt_codes` row, with the coder it belongs to. */
export interface TagRow {
  excerptId: string;
  codeId: string;
  coderId?: string;
  createdAt: string;
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
  /** Only what these speakers said. Answered from each document's transcript
   * format before paging, like `query`; an empty list is no filter. */
  speakers?: string[] | null;
  /** Only excerpts carrying a coding by one of these coders. Absent or empty
   * means everyone, which is the default. It narrows which excerpts come
   * back, not which codes they show. */
  coderIds?: string[] | null;
  /** Only excerpts with a coding of `codeId` whose weight falls in
   * `[min, max]` (inclusive). A coding with no weight never matches. */
  weightRange?: WeightRangeFilter | null;
  limit?: number;
  offset?: number;
}

export interface WeightRangeFilter {
  codeId: string;
  min: number;
  max: number;
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

/** What `setWeightsToExcerpts` actually changed: only codings that existed
 * and really had a different weight, each with the value it carried before
 * — undo is the same call with those values put back. */
export interface BulkWeightReport {
  /** `[excerptId, coderId, previousWeight]`. */
  changed: [string, string, number | null][];
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
  /** Who was speaking where this excerpt starts, in a transcript. */
  speaker: string | null;
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

/** What text to count words over: see `WordFrequencyScope` in
 * `crates/misket-core/src/models.rs`. */
export interface WordFrequencyScope {
  documentIds?: string[] | null;
  /** Document sets; unioned into `documentIds`. */
  documentSetIds?: string[] | null;
  /** When set, only text inside excerpts carrying one of these codes (or a
   * descendant) is counted, not whole documents. */
  codeIds?: string[] | null;
}

export interface WordFrequencyOptions {
  /** Words shorter than this many code points are dropped. Default 3. */
  minLength: number;
  /** Drop the built-in English stop words plus the project's own list. Default true. */
  stopWords: boolean;
  /** Group word forms by stem, reporting the most frequent surface form. Default false. */
  stem: boolean;
  limit: number;
}

export const DEFAULT_WORD_FREQUENCY_OPTIONS: WordFrequencyOptions = {
  minLength: 3,
  stopWords: true,
  stem: false,
  limit: 200,
};

export interface WordFrequency {
  /** The word itself, or (when `stem` is on) the most frequent surface form. */
  term: string;
  count: number;
  /** Distinct documents this term (or stem) appears in, within the scope. */
  documents: number;
}

export type TimelineBucket = "day" | "week" | "month";

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
  /** One mean weight per column, present only when the request's `measure`
   * is `"meanWeight"`. `null` in a cell means the code has no scale, or no
   * weighted coding fell in that column. */
  weightCells?: (number | null)[] | null;
}

/** What a cell counts: excerpts (the default) or distinct documents. */
export type CrosstabMode = "excerpts" | "documents";

/** What a cell holds: a `count` (the default) or `meanWeight` (on top of the
 * count, in `weightCells`). */
export type CrosstabMeasure = "count" | "meanWeight";

export interface CrosstabRequest {
  fieldId: string;
  /** Rows; every code when absent or empty. */
  codeIds?: string[] | null;
  includeDescendants?: boolean;
  documentIds?: string[] | null;
  documentSetIds?: string[] | null;
  /** Whose coding to count; everyone when absent or empty. */
  coderIds?: string[] | null;
  /** Number fields only: equal-width bins between min and max (default 4). */
  bins?: number | null;
  mode?: CrosstabMode | null;
  measure?: CrosstabMeasure | null;
}

export interface CodeByDescriptor {
  field: DescriptorField;
  columns: CrosstabColumn[];
  rows: CrosstabRow[];
  /** Documents in scope per column, whether or not anything in them is coded. */
  documentsPerColumn: number[];
  mode: CrosstabMode;
}

/** One value on a weight scale and how many codings carry it, in
 * `WeightSummary.histogram`, ascending by value. */
export interface WeightHistogramBin {
  value: number;
  count: number;
}

/** Summary statistics for one weighted code's codings, over whatever
 * `ExcerptFilter` scoped them to. */
export interface WeightSummary {
  /** How many codings of this code, in scope, carry a weight. */
  count: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  histogram: WeightHistogramBin[];
}

// ------------------------------------------- inter-rater reliability (IRR)

/**
 * The unit of analysis an agreement figure counts over. Mirrors `IrrUnit` in
 * `crates/misket-core/src/models.rs`; `crates/misket-core/src/db/irr.rs` has
 * the rules.
 */
export type IrrUnit = "paragraph" | "turn" | "excerpt";

export interface IrrRequest {
  coderA: string;
  coderB: string;
  /** Absent or empty: every document both coders have coded in. */
  documentIds?: string[] | null;
  /** Document sets; unioned into `documentIds`, as everywhere else. */
  documentSetIds?: string[] | null;
  unit?: IrrUnit;
  /** How much of a unit an excerpt must cover, or vice versa (0..1). Ignored
   * for `excerpt` units, which match ranges exactly. */
  overlapThreshold?: number;
  /** Absent or empty: every code either coder applied in those documents. */
  codeIds?: string[] | null;
}

export interface IrrCodeRow {
  codeId: string;
  codeName: string;
  codePath: string;
  color: string;
  units: number;
  both: number;
  aOnly: number;
  bOnly: number;
  neither: number;
  percentAgreement: number;
  /** Null where kappa is undefined — never 0 standing in for "no idea". */
  kappa: number | null;
  /** The Landis & Koch band, or "" when kappa is null. */
  interpretation: string;
}

export interface IrrDocumentRow {
  documentId: string;
  documentName: string;
  units: number;
  percentAgreement: number;
  disagreements: number;
}

export interface IrrDisagreement {
  documentId: string;
  documentName: string;
  unitIndex: number;
  kind: "text" | "image_region";
  /** Code points, end-exclusive; both 0 for an image region. */
  start: number;
  end: number;
  snippet: string;
  codeId: string;
  codeName: string;
  color: string;
  /** Which coder applied it. */
  who: "a" | "b";
  coderId: string;
  /** The excerpt whose range is this unit, when there is one. */
  unitExcerptId: string | null;
  /** The excerpts carrying the coding, for "remove mine". */
  excerptIds: string[];
}

export interface IrrReport {
  coderA: string;
  coderB: string;
  coderAName: string;
  coderBName: string;
  unit: IrrUnit;
  overlapThreshold: number;
  documents: IrrDocumentRow[];
  units: number;
  /** units x codes. */
  decisions: number;
  codes: IrrCodeRow[];
  pooledKappa: number | null;
  pooledInterpretation: string;
  meanKappa: number | null;
  percentAgreement: number;
  /** Capped; `disagreementCount` is the real total. */
  disagreements: IrrDisagreement[];
  disagreementCount: number;
}

export interface SearchHit {
  documentId: string;
  documentName: string;
  startPos: number;
  endPos: number;
  /** The exact matched text — not always the query text verbatim (case, a
   * regex capture, or a different word form when matched by stem). */
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
  /** `[rowKey, codeId, summary, updatedAt]`. */
  cells: [string, string, string, string][];
}

/**
 * One speaker's turn in a transcript. Code points, end-exclusive, mirroring
 * `misket_core::text::Turn`.
 *
 * `[labelStart, labelEnd)` is the whole speaker label — leading spaces, name,
 * timestamp, delimiter and the spaces after it — and `[start, end)` is what
 * was said, trailing whitespace already trimmed.
 */
export interface SpeakerTurn {
  speaker: string;
  /** The timestamp the label carried, verbatim, when the format captures one. */
  time: string | null;
  labelStart: number;
  labelEnd: number;
  start: number;
  end: number;
}

/** Which shapes of speaker label a document's turns are written in. */
export type TranscriptPreset =
  "name_colon" | "bracket_name" | "name_paren_time" | "bracket_time_name" | "time_name";

/**
 * How a document marks who is speaking: one of the built-in presets, a custom
 * regular expression with named `speaker` (and optional `time`) groups, or
 * `none` — "this is not a transcript".
 */
export interface TranscriptFormat {
  kind: "preset" | "regex" | "none";
  preset?: TranscriptPreset | null;
  pattern?: string | null;
}

/** A speaker and how many turns they take in one document. */
export interface SpeakerCount {
  name: string;
  turns: number;
}

/** A document's transcript: the format in force and what it finds. */
export interface TranscriptInfo {
  format: TranscriptFormat;
  turns: SpeakerTurn[];
  speakers: SpeakerCount[];
}

// ------------------------------------------------------------------ backups

export interface BackupInfo {
  path: string;
  /** RFC 3339 UTC. */
  createdAt: string;
  reason: string;
  sizeBytes: number;
}

// ----------------------------------------------------------------- history

/**
 * One node of the history tree, read as a log entry: something that happened
 * to the project.
 */
export interface ActivityEntry {
  id: number;
  /** The node this one follows; null for a root. */
  parentId: number | null;
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
  /** Whether this step carries an inverse and can be taken back. */
  undoable: boolean;
  /** The name "fork here" gave this node, if any. */
  branchName: string | null;
  /** Whether this is the step undo would take back next. */
  isHead: boolean;
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

/** One operation in the undo tree, with the payloads that replay it. */
export interface HistoryNode {
  id: number;
  parentId: number | null;
  at: string;
  actor: string;
  kind: string;
  targetKind: string;
  targetId: string | null;
  summary: string;
  detail: Record<string, unknown>;
  /** The operation, and its opposite; null when it cannot be replayed. */
  forward: unknown | null;
  inverse: unknown | null;
  branchName: string | null;
  preferredChild: number | null;
  /** The compound step this node belongs to, named by its leading node's id. */
  groupId: number | null;
  /** Set on a group's leading node: the label shown instead of its steps. */
  groupSummary: string | null;
}

/** A node as the history view draws it: no payloads, but the shape around it. */
export interface HistoryNodeSummary {
  id: number;
  parentId: number | null;
  at: string;
  actor: string;
  /** Which coder made this edit; empty for a node from before coder identity. */
  coderId?: string;
  kind: string;
  summary: string;
  branchName: string | null;
  undoable: boolean;
  isHead: boolean;
  /** Which child redo would follow from here; null on a leaf. */
  preferredChild: number | null;
  /** How many writes this node stands for; more than 1 for a compound step. */
  stepCount: number;
  /** Oldest first; more than one means the tree branches here. */
  children: number[];
}

/** What compacting threw away. */
export interface CompactReport {
  droppedNodes: number;
  droppedBranches: string[];
}

// ---------------------------------------------------- pulling another copy

/** How much of one kind of thing a pull found, and what it would do with it. */
export interface MergeCount {
  matched: number;
  /** Matched by something other than the id: a hash, a name, a range. */
  byName: number;
  new: number;
}

/** One coder in the other copy, and how much of it is theirs. */
export interface MergeCoder {
  id: string;
  name: string;
  color: string;
  /** Codings of theirs in the other file. */
  codingCount: number;
  /** Codings of theirs this pull would bring over. */
  incomingCount: number;
  /** Whether this is the coder that copy writes as. */
  isTheirs: boolean;
  /** Whether this is us, coming back through their copy. */
  isLocal: boolean;
}

/** Something only the user can settle: both copies changed the same thing. */
export interface MergeConflict {
  id: string;
  /** `code.scalar` | `code.deletedHere` | `memo` | `descriptor.value` | `framework.cell` */
  kind: string;
  title: string;
  /** Which fields disagree, when the title alone is ambiguous. */
  field: string;
  ours: string;
  theirs: string;
  /** `[id, label]` for every way out, in the order to show them. */
  choices: [string, string][];
  default: string;
}

export interface MergeDecision {
  conflictId: string;
  choice: string;
}

/** What pulling from another copy would do, before anything is written. */
export interface MergePlan {
  otherName: string;
  otherPath: string;
  otherProjectId: string;
  sameProject: boolean;
  /** No sync point yet, so ours wins for anything you have both edited. */
  firstPull: boolean;
  otherCoders: MergeCoder[];
  documents: MergeCount;
  codes: MergeCount;
  excerpts: MergeCount;
  codings: MergeCount;
  memos: MergeCount;
  descriptorFields: MergeCount;
  descriptorValues: MergeCount;
  sets: MergeCount;
  filters: MergeCount;
  frameworkMatrices: MergeCount;
  frameworkCells: MergeCount;
  conflicts: MergeConflict[];
  notes: string[];
}

/** What a pull did. */
export interface MergeReport {
  otherName: string;
  documents: number;
  codes: number;
  excerpts: number;
  codings: number;
  memos: number;
  descriptorFields: number;
  descriptorValues: number;
  sets: number;
  filters: number;
  frameworkMatrices: number;
  frameworkCells: number;
  conflictsResolved: number;
  byCoder: MergeCoder[];
  summary: string;
}
