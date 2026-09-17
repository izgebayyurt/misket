//! Data transfer objects shared with the frontend (camelCase JSON).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub project_id: String,
    pub schema_version: i64,
    pub counts: ProjectCounts,
    /// Set when the project file lives inside a folder a cloud sync client
    /// manages (Dropbox, OneDrive, iCloud Drive, ...); see `crate::sync`.
    /// The message is ready to show as-is.
    #[serde(default)]
    pub sync_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCounts {
    pub documents: i64,
    pub codes: i64,
    pub excerpts: i64,
    pub memos: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_opened_at: String,
}

/// Everything the overview screen shows. See `db::stats::project_stats`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub documents: i64,
    pub text_documents: i64,
    pub image_documents: i64,
    pub codes: i64,
    pub excerpts: i64,
    /// Excerpts tagged with at least one code.
    pub coded_excerpts: i64,
    pub memos: i64,
    pub descriptor_fields: i64,
    /// Code points, summed over text documents.
    pub total_text_length: i64,
    /// Latest `updated_at` across documents, codes, excerpts and memos.
    pub last_activity_at: Option<String>,
    /// `(date "YYYY-MM-DD", count)`, one entry per of the last 30 days
    /// (oldest first), zero-filled, based on `excerpts.created_at`.
    pub excerpts_per_day: Vec<(String, i64)>,
    /// `(codeId, count)`, direct tags only, highest first, top 8.
    pub top_codes: Vec<(String, i64)>,
}

// ---------------------------------------------------------------- documents

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NewDocument {
    pub name: String,
    #[serde(default)]
    pub source_path: Option<String>,
    pub source_format: String,
    pub text: String,
    #[serde(default)]
    pub allow_duplicate: bool,
}

/// An image document. The bytes are stored inside the project file so a
/// `.misket` stays self-contained; `source_path` is kept as a reference to
/// where the file came from. When `bytes` is absent they are read from
/// `source_path` instead.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewImageDocument {
    pub name: String,
    #[serde(default)]
    pub source_path: Option<String>,
    /// `image/png`, `image/jpeg` or `image/webp`.
    pub mime: String,
    pub width: i64,
    pub height: i64,
    #[serde(default)]
    pub bytes: Option<Vec<u8>>,
    #[serde(default)]
    pub allow_duplicate: bool,
}

/// `documents.media_json` for an image (and, later, a video) document.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub width: i64,
    pub height: i64,
    pub mime: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub source_path: Option<String>,
    pub source_format: Option<String>,
    pub text_length: Option<i64>,
    /// Image and video documents only: size and MIME of the stored media.
    pub media: Option<MediaInfo>,
    pub sort_order: i64,
    pub excerpt_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    #[serde(flatten)]
    pub summary: DocumentSummary,
    pub text: Option<String>,
}

// -------------------------------------------------------------------- codes

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Code {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub color: String,
    /// What the code means.
    pub description: String,
    /// When to apply it.
    pub inclusion: String,
    /// When not to apply it, and what to use instead.
    pub exclusion: String,
    /// One already-coded excerpt held up as the canonical instance. Deleting
    /// that excerpt clears the pointer (`ON DELETE SET NULL`).
    pub example_excerpt_id: Option<String>,
    pub shortcut: Option<String>,
    pub sort_order: i64,
    pub excerpt_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewCode {
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub inclusion: Option<String>,
    #[serde(default)]
    pub exclusion: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub shortcut: Option<String>,
}

/// Partial update. `shortcut` and `example_excerpt_id` use a double option so
/// the frontend can clear them (`{"shortcut": null}`) or leave them untouched
/// (field absent).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodePatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub inclusion: Option<String>,
    #[serde(default)]
    pub exclusion: Option<String>,
    #[serde(default, with = "double_option")]
    pub shortcut: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub example_excerpt_id: Option<Option<String>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ChildrenStrategy {
    Delete,
    Promote,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCodeReport {
    pub deleted_code_ids: Vec<String>,
    pub affected_excerpt_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodeImpact {
    pub descendant_count: i64,
    pub excerpt_count: i64,
}

// ------------------------------------------------------------ codebook i/o

/// One code in a `misket-codebook` JSON export (see `db::export::codebook_json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodebookJsonCode {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub description: String,
    /// Added in schema 5; absent in codebooks written by older builds.
    #[serde(default)]
    pub inclusion: String,
    #[serde(default)]
    pub exclusion: String,
    #[serde(default)]
    pub shortcut: Option<String>,
    #[serde(default)]
    pub sort_order: i64,
}

/// What `db::codebook_import::import_codebook` should read: either the
/// parsed contents of a `misket-codebook` JSON file, or raw CSV text with
/// header `name,parent,color,description,inclusion,exclusion,shortcut`
/// (`parent` is a full path with ` / ` separators, the same convention as the
/// codebook CSV export). The pre-schema-5 header without `inclusion,exclusion`
/// is still accepted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CodebookImport {
    #[serde(rename = "json")]
    Json { codes: Vec<CodebookJsonCode> },
    #[serde(rename = "csv")]
    Csv { text: String },
}

/// `Merge` matches existing codes by full name path (case-insensitively) and
/// only fills empty fields; `AddUnder` creates everything fresh under
/// `parent_id` (root-level if `None`), without matching.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImportMode {
    #[serde(rename = "merge")]
    Merge,
    #[serde(rename = "add-under")]
    AddUnder {
        #[serde(default)]
        parent_id: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub created: i64,
    pub matched: i64,
    pub skipped_shortcuts: Vec<String>,
}

// ----------------------------------------------------------------- excerpts

/// A normalized rectangle on an image document: fractions of the image's
/// width and height, so it survives any zoom level or re-export.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Apply codes to a range of a document, creating the excerpt if needed.
///
/// `kind` defaults to `text`, which uses `start_pos`/`end_pos` (code points,
/// end-exclusive); `image_region` uses `geometry` instead.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplyCodesInput {
    pub document_id: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub start_pos: Option<i64>,
    #[serde(default)]
    pub end_pos: Option<i64>,
    #[serde(default)]
    pub geometry: Option<Rect>,
    pub code_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExcerptWithCodes {
    pub id: String,
    pub document_id: String,
    pub kind: String,
    pub start_pos: Option<i64>,
    pub end_pos: Option<i64>,
    pub geometry: Option<String>,
    pub snapshot: Option<String>,
    pub code_ids: Vec<String>,
    pub memo_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub excerpt: ExcerptWithCodes,
    pub created: bool,
    pub added_code_ids: Vec<String>,
}

/// What in vivo coding produced: the code named after the selected text, and
/// the excerpt it was applied to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InVivoResult {
    pub code: Code,
    pub excerpt: ExcerptWithCodes,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExcerptDetail {
    #[serde(flatten)]
    pub excerpt: ExcerptWithCodes,
    pub document_name: String,
    pub context_before: String,
    pub context_after: String,
    pub memos: Vec<Memo>,
}

/// Everything a deleted document took with it, so undo can put it back with
/// its original id: the row itself, the excerpts cut from it with their codes
/// and memos, the descriptor values that described it, the sets it belonged
/// to, the framework summaries written against its row, and its own memos.
///
/// The text and the image bytes are *not* here: they go in `history_blobs`
/// beside the node, because a JSON payload is not the place for a megabyte of
/// interview transcript.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DocumentSnapshot {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub source_path: Option<String>,
    pub source_format: Option<String>,
    pub content_hash: String,
    pub media_json: Option<String>,
    /// The MIME of the bytes stored under the node's `media` blob.
    pub media_mime: Option<String>,
    pub text_length: Option<i64>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub excerpts: Vec<ExcerptSnapshot>,
    /// `(fieldId, value)`.
    pub descriptor_values: Vec<(String, String)>,
    /// The ids of the document sets this document was a member of.
    pub set_members: Vec<String>,
    pub framework_cells: Vec<FrameworkCellRow>,
    /// Memos written about the document itself.
    pub memos: Vec<Memo>,
}

/// Everything needed to restore a deleted excerpt with its original ids.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExcerptSnapshot {
    pub excerpt: ExcerptWithCodes,
    pub memos: Vec<Memo>,
    /// The `excerpt_codes` rows with their own timestamps. Empty in a
    /// snapshot written before those were kept, in which case a restore falls
    /// back to `excerpt.code_ids`.
    #[serde(default)]
    pub tags: Vec<TagRow>,
}

/// The two halves left by [`crate::db::excerpts::split`]; `left` keeps the original id.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SplitResult {
    pub left: ExcerptWithCodes,
    pub right: ExcerptWithCodes,
}

/// The outcome of [`crate::db::excerpts::merge_adjacent`], with everything the
/// frontend needs to invert it: the survivor as it is now, a snapshot of the
/// excerpt that was removed, the survivor's range before the merge and the
/// codes the merge added to it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub excerpt: ExcerptWithCodes,
    pub removed: ExcerptSnapshot,
    pub previous_start_pos: i64,
    pub previous_end_pos: i64,
    pub added_code_ids: Vec<String>,
}

/// One code in a [`Query`], with the same "include sub-codes" choice the
/// rest of the browser offers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodeRef {
    pub code_id: String,
    #[serde(default = "default_true")]
    pub include_descendants: bool,
}

/// A [`Query`] operand: a code, or a nested query.
///
/// Untagged, because the two are told apart by their fields: a code has
/// `codeId`, a group has `op`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum QueryTerm {
    Code(CodeRef),
    Group(Box<Query>),
}

/// How close `near` counts as near.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Within {
    /// The same paragraph, paragraphs being the document text split on `\n`.
    Paragraph,
    /// At most `n` code points apart.
    Chars { n: i64 },
}

/// A Boolean/proximity retrieval expression over coded excerpts.
///
/// `op` is `and`, `or`, `not` or `near`; `within` only applies to `near` and
/// defaults to the same paragraph. See
/// [`crate::db::query_expr`] for the semantics, which are "co-located":
/// an excerpt satisfies a term when it carries the code itself *or* overlaps
/// an excerpt that does.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub op: String,
    pub terms: Vec<QueryTerm>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub within: Option<Within>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExcerptFilter {
    #[serde(default)]
    pub code_ids: Option<Vec<String>>,
    /// Code sets; each one stands for all of its members, as if every member
    /// had been ticked in `code_ids`.
    #[serde(default)]
    pub code_set_ids: Option<Vec<String>>,
    #[serde(default = "default_true")]
    pub include_descendants: bool,
    /// All listed codes must be present (default: any of them).
    #[serde(default)]
    pub require_all_codes: bool,
    #[serde(default)]
    pub document_ids: Option<Vec<String>>,
    /// Document sets; unioned into `document_ids`.
    #[serde(default)]
    pub document_set_ids: Option<Vec<String>>,
    #[serde(default)]
    pub uncoded_only: bool,
    /// Restrict results to excerpts that overlap at least one excerpt
    /// carrying this code (subject to `include_descendants`, same as the
    /// main code filter). Matches how `analysis::co_occurrence` counts
    /// pairs: text ranges only, half-open overlap
    /// `a.start < b.end AND b.start < a.end` within the same document (or,
    /// for the excerpt itself, sharing both codes).
    #[serde(default)]
    pub overlaps_code_id: Option<String>,
    /// Descriptor conditions, ANDed together.
    #[serde(default)]
    pub descriptors: Option<Vec<DescriptorFilter>>,
    /// A Boolean/proximity expression over codes ("A and B", "A not near B").
    /// Unlike every other field it cannot be expressed in SQL, so it is
    /// applied in Rust to the excerpts the rest of the filter leaves, before
    /// paging. Text excerpts only.
    #[serde(default)]
    pub query: Option<Query>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_true() -> bool {
    true
}
fn default_limit() -> i64 {
    200
}

impl Default for ExcerptFilter {
    fn default() -> Self {
        Self {
            code_ids: None,
            code_set_ids: None,
            include_descendants: true,
            require_all_codes: false,
            document_ids: None,
            document_set_ids: None,
            uncoded_only: false,
            overlaps_code_id: None,
            descriptors: None,
            query: None,
            limit: default_limit(),
            offset: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExcerptRow {
    #[serde(flatten)]
    pub excerpt: ExcerptWithCodes,
    pub document_name: String,
    pub context_before: String,
    pub context_after: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExcerptPage {
    pub rows: Vec<ExcerptRow>,
    pub total: i64,
}

// ------------------------------------------------------- bulk operations

/// What a bulk code change actually did.
///
/// `affected` counts the excerpts that really changed; `pairs` holds every
/// `(excerptId, codeId)` tag that was inserted (by `add_codes_many`) or
/// deleted (by `remove_codes_many`), skipping the ones that were already in
/// the wanted state. Undo is the opposite operation over exactly those pairs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BulkCodeReport {
    pub affected: i64,
    pub pairs: Vec<(String, String)>,
}

/// Moving every excerpt from one code to another.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RetagReport {
    /// Excerpts that gained the target code and lost the source code.
    pub moved: Vec<String>,
    /// Excerpts that already carried the target code, so they only lost the
    /// source. Undo must not take the target away from these.
    pub already_had: Vec<String>,
}

/// One text range to auto-code: a search match, or a match already expanded
/// to its enclosing sentence or paragraph by the caller. Code points,
/// end-exclusive, same convention as everywhere else.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutoCodeHit {
    pub document_id: String,
    pub start_pos: i64,
    pub end_pos: i64,
}

/// What `db::bulk::auto_code` actually did, with everything undo needs.
///
/// Each hit's `[start, end)` either creates a fresh excerpt (`created_excerpt_ids`)
/// or reuses an excerpt that already covered that exact range: if that
/// excerpt did not yet carry `code_id`, the id goes into `reused_excerpt_ids`
/// (undo removes just the code); if it already did, nothing changes and the
/// hit only counts toward `already_coded`. Undo therefore deletes exactly
/// `created_excerpt_ids` and removes `code_id` from exactly
/// `reused_excerpt_ids`, leaving everything else untouched.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutoCodeReport {
    pub created_excerpt_ids: Vec<String>,
    pub reused_excerpt_ids: Vec<String>,
    pub already_coded: i64,
}

// ----------------------------------------------------------------- analysis

/// One row of the code frequency table. `own` counts excerpts tagged with the
/// code itself; `with_descendants`, `document_count` and `per_document`
/// describe the excerpts tagged with the code or any of its descendants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodeFrequency {
    pub code_id: String,
    pub own: i64,
    pub with_descendants: i64,
    pub document_count: i64,
    /// `(document_id, excerpt count)`, in project document order.
    pub per_document: Vec<(String, i64)>,
}

/// Square, symmetric matrix of codes that share overlapping text. `cells` is
/// sparse (`(row code, column code, count)`, both orientations present) and the
/// diagonal holds each code's own frequency.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoOccurrence {
    pub code_ids: Vec<String>,
    pub cells: Vec<(String, String, i64)>,
}

/// Excerpts per document and code (direct tags only). `cells` is sparse:
/// `(document_id, code_id, count)`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodeByDocument {
    pub document_ids: Vec<String>,
    pub code_ids: Vec<String>,
    pub cells: Vec<(String, String, i64)>,
}

/// What text to count words over: every document by default, narrowed by
/// document/set (unioned, same as the other analysis views) and/or by code
/// — when `code_ids` is set, only text inside excerpts carrying one of
/// those codes (or a descendant) is counted, not whole documents.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WordFrequencyScope {
    pub document_ids: Option<Vec<String>>,
    pub document_set_ids: Option<Vec<String>>,
    pub code_ids: Option<Vec<String>>,
}

/// See `db::analysis::word_frequencies`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WordFrequencyOptions {
    /// Words shorter than this many code points are dropped.
    pub min_length: i64,
    /// Drop the built-in English stop words plus the project's own list
    /// (`db::analysis::stop_words`).
    pub stop_words: bool,
    /// Group word forms by stem (`text::stem`), reporting the most frequent
    /// surface form as `term`.
    pub stem: bool,
    pub limit: usize,
}

impl Default for WordFrequencyOptions {
    fn default() -> Self {
        Self {
            min_length: 3,
            stop_words: true,
            stem: false,
            limit: 200,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WordFrequency {
    /// The word itself, or (when `stem` is on) the most frequent surface
    /// form of the stem it represents.
    pub term: String,
    pub count: i64,
    /// Distinct documents this term (or, stemmed, any of its surface forms)
    /// appears in, within the scope.
    pub documents: i64,
}

/// What a code-by-descriptor cross-tab should show. One struct rather than a
/// row of positional arguments, because the frontend sends it as one object
/// and it will grow (normalized percentages, a second field) before long.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CrosstabRequest {
    pub field_id: String,
    /// The codes to make rows from; every code when absent or empty.
    #[serde(default)]
    pub code_ids: Option<Vec<String>>,
    /// Count a code's descendants towards it, de-duplicated per excerpt.
    #[serde(default = "default_true")]
    pub include_descendants: bool,
    #[serde(default)]
    pub document_ids: Option<Vec<String>>,
    /// Document sets; unioned into `document_ids`, as everywhere else.
    #[serde(default)]
    pub document_set_ids: Option<Vec<String>>,
    /// Number fields only: how many equal-width bins to cut the range into
    /// (default [`crate::db::analysis::DEFAULT_NUMBER_BINS`]).
    #[serde(default)]
    pub bins: Option<i64>,
    /// What a cell counts: `excerpts` (the default) or `documents`.
    #[serde(default)]
    pub mode: Option<String>,
}

impl Default for CrosstabRequest {
    fn default() -> Self {
        Self {
            field_id: String::new(),
            code_ids: None,
            include_descendants: true,
            document_ids: None,
            document_set_ids: None,
            bins: None,
            mode: None,
        }
    }
}

/// One column of the code-by-descriptor cross-tab: a descriptor value, a bin
/// of a number field or a month of a date field, plus the descriptor
/// condition that reproduces it in the excerpt browser.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CrosstabColumn {
    /// What the column header shows: the value, `"18 – 30.5"`, `"2026-09"`
    /// or `"(no value)"`.
    pub label: String,
    /// `eq`, `between` or `empty` — a [`DescriptorFilter`] operator, so a
    /// cell click can open the excerpt browser on exactly this column.
    pub op: String,
    pub values: Vec<String>,
}

/// One row of the code-by-descriptor cross-tab: a code and one count per
/// column, in `columns` order.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CrosstabRow {
    pub code_id: String,
    pub cells: Vec<i64>,
}

/// Codes against the values of one descriptor field. See
/// [`crate::db::analysis::code_by_descriptor`] for how the columns are built
/// and what a cell counts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodeByDescriptor {
    pub field: DescriptorField,
    pub columns: Vec<CrosstabColumn>,
    pub rows: Vec<CrosstabRow>,
    /// How many documents in scope fall in each column, whether or not
    /// anything in them is coded; the denominator for a column.
    pub documents_per_column: Vec<i64>,
    /// `excerpts` or `documents`, echoing what the cells count.
    pub mode: String,
}

// -------------------------------------------------------------- descriptors

/// A document attribute: "Age group", "Site", "Interview wave", "Gender".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorField {
    pub id: String,
    pub name: String,
    /// `text` | `number` | `choice` | `date`
    pub kind: String,
    /// The allowed values of a `choice` field; empty for every other kind.
    pub options: Vec<String>,
    pub sort_order: i64,
    /// How many documents have a value for this field.
    pub value_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewDescriptorField {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub options: Option<Vec<String>>,
}

/// Partial update; absent fields are left alone.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorFieldPatch {
    #[serde(default)]
    pub name: Option<String>,
    /// Changing it converts the values documents already have where the new
    /// kind can hold them, and drops the rest. Undo restores them.
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub options: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorValue {
    pub document_id: String,
    pub field_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorMatrixRow {
    pub document_id: String,
    pub document_name: String,
    /// field id -> value, only for fields this document has a value for.
    pub values: std::collections::BTreeMap<String, String>,
}

/// All documents x all fields, for a table view.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorMatrix {
    pub fields: Vec<DescriptorField>,
    pub rows: Vec<DescriptorMatrixRow>,
}

/// One condition on a document attribute in the excerpt browser.
///
/// `op` is `eq`, `neq`, `contains`, `gt`, `lt`, `between`, `in`, `empty` or
/// `notEmpty`; `values` holds as many operands as the operator needs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DescriptorFilter {
    pub field_id: String,
    pub op: String,
    #[serde(default)]
    pub values: Vec<String>,
}

// --------------------------------------------------------------------- sets

/// A named group of codes or of documents.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetInfo {
    pub id: String,
    /// `code` | `document`
    pub kind: String,
    pub name: String,
    pub sort_order: i64,
    pub member_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// A deleted set plus its members, so undo can recreate it unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetWithMembers {
    pub set: SetInfo,
    pub member_ids: Vec<String>,
}

/// A named [`ExcerptFilter`], stored as JSON in `saved_filters.filter_json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedFilter {
    pub id: String,
    pub name: String,
    pub filter: ExcerptFilter,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

// -------------------------------------------------------------------- memos

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemoTarget {
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub code_id: Option<String>,
    #[serde(default)]
    pub excerpt_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Memo {
    pub id: String,
    pub document_id: Option<String>,
    pub code_id: Option<String>,
    pub excerpt_id: Option<String>,
    pub title: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

// ------------------------------------------------------------------- backups

/// One timestamped backup file next to the project.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    /// RFC 3339 UTC, derived from the timestamp encoded in the file name.
    pub created_at: String,
    pub reason: String,
    pub size_bytes: u64,
}

// ------------------------------------------------------------- activity log

/// One row of `activity_log`: something that happened to the project.
///
/// `detail` is `detail_json` parsed back into a JSON object (an empty object
/// when the stored text cannot be parsed), so the frontend never has to
/// double-decode a string.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub id: i64,
    /// The node this one follows in the history tree; `None` for a root.
    pub parent_id: Option<i64>,
    pub at: String,
    pub actor: String,
    /// A dotted verb: `code.created`, `excerpt.split`, `undo`, …
    pub kind: String,
    /// `code`, `excerpt`, `document`, `memo`, `descriptor_field`, `set`,
    /// `saved_filter`, `codebook` or `project`.
    pub target_kind: String,
    pub target_id: Option<String>,
    pub summary: String,
    pub detail: serde_json::Value,
    /// Whether this step carries an inverse payload. Entries written before
    /// history existed, and kinds no inverse has been written for, do not.
    pub undoable: bool,
    /// The name "fork here" gave this node, if any.
    pub branch_name: Option<String>,
    /// Whether this is the node undo would take back next.
    pub is_head: bool,
}

/// What `db::activity::list` should return. Every field narrows the result;
/// `limit`/`offset` page through what is left, newest first.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFilter {
    #[serde(default)]
    pub target_kind: Option<String>,
    #[serde(default)]
    pub target_id: Option<String>,
    /// Keep only these kinds (exact matches).
    #[serde(default)]
    pub kinds: Option<Vec<String>>,
    /// Only entries at or after this timestamp (RFC 3339, as stored).
    #[serde(default)]
    pub since: Option<String>,
    #[serde(default = "default_activity_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_activity_limit() -> i64 {
    100
}

impl Default for ActivityFilter {
    fn default() -> Self {
        Self {
            target_kind: None,
            target_id: None,
            kinds: None,
            since: None,
            limit: default_activity_limit(),
            offset: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPage {
    pub entries: Vec<ActivityEntry>,
    /// How many entries match the filter, ignoring `limit`/`offset`.
    pub total: i64,
    /// Every `kind` present in the log, sorted, so the UI can offer a filter
    /// without a second round trip.
    pub kinds: Vec<String>,
}

// ------------------------------------------------------------------ history

/// One operation in the undo tree, with the payloads that replay it.
///
/// `forward` and `inverse` are self-contained JSON carrying the original ids,
/// so a node can be applied in either direction long after the closure that
/// produced it is gone. `None` means the step cannot be replayed that way.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryNode {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub at: String,
    pub actor: String,
    pub kind: String,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub summary: String,
    pub detail: serde_json::Value,
    pub forward: Option<serde_json::Value>,
    pub inverse: Option<serde_json::Value>,
    pub branch_name: Option<String>,
    pub preferred_child: Option<i64>,
    /// The compound step this node belongs to, named by the id of the node
    /// that leads it. `None` for a write that stands on its own.
    pub group_id: Option<i64>,
    /// Set on the leading node of a group only: the label the history view
    /// shows in place of the steps inside it.
    pub group_summary: Option<String>,
}

/// A node as the history view draws it: no payloads, but the shape of the
/// tree around it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryNodeSummary {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub at: String,
    pub actor: String,
    pub kind: String,
    pub summary: String,
    pub branch_name: Option<String>,
    pub undoable: bool,
    pub is_head: bool,
    /// How many writes this node stands for: 1 normally, more when it is a
    /// compound step (a merge, an import of several files) shown as one.
    pub step_count: i64,
    /// Oldest first; more than one means the tree branches here.
    pub children: Vec<i64>,
}

/// What [`crate::db::history::compact_before`] threw away.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompactReport {
    pub dropped_nodes: i64,
    /// The names of the forks that went with them, so the confirmation can
    /// say what is being lost.
    pub dropped_branches: Vec<String>,
}

/// A code exactly as it sits in the table, so it can be put back with its own
/// id, place and timestamps. `example_excerpt_id` is not here: it lives in
/// [`CodeTreeSnapshot::example_refs`], because it can only be restored once
/// the excerpt it points at is known to exist.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodeRow {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub color: String,
    pub description: String,
    pub inclusion: String,
    pub exclusion: String,
    pub shortcut: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// The order of one group of siblings, so a restore lands a code back between
/// the same two neighbours rather than wherever a renumber puts it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SiblingGroup {
    pub parent_id: Option<String>,
    pub ids: Vec<String>,
}

/// One `excerpt_codes` row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagRow {
    pub excerpt_id: String,
    pub code_id: String,
    pub created_at: String,
}

/// One `framework_cells` row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameworkCellRow {
    pub matrix_id: String,
    pub row_key: String,
    pub code_id: String,
    pub summary: String,
    pub updated_at: String,
}

/// Everything deleting a branch of the codebook would take with it: the code
/// rows themselves, where they sat among their siblings, the excerpts they
/// tagged, their memos, the sets and framework cells that named them, and the
/// example excerpts they pointed at.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CodeTreeSnapshot {
    /// Parents before children, so the foreign key holds on the way back in.
    pub codes: Vec<CodeRow>,
    pub sibling_order: Vec<SiblingGroup>,
    pub excerpt_codes: Vec<TagRow>,
    pub memos: Vec<Memo>,
    /// `(setId, codeId)`.
    pub set_members: Vec<(String, String)>,
    pub framework_cells: Vec<FrameworkCellRow>,
    /// `(codeId, excerptId)`.
    pub example_refs: Vec<(String, String)>,
}

// ------------------------------------------------------------------- search

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub document_id: String,
    pub document_name: String,
    /// Code points, end-exclusive.
    pub start_pos: i64,
    pub end_pos: i64,
    /// The exact matched text (not the query/pattern), so a regex, stemmed
    /// or case-folded hit displays what actually matched rather than the
    /// query itself.
    pub matched_text: String,
    pub context_before: String,
    pub context_after: String,
}

// ---------------------------------------------------------------- framework

/// A saved framework matrix (Ritchie & Spencer): cases down the side, themes
/// across the top, a written summary in every cell.
///
/// Only the configuration is stored. The rows are recomputed on every read
/// from `row_kind` (one row per document, or one per distinct value of a
/// descriptor field) so importing a document or filling in a descriptor
/// changes the grid without touching this row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameworkMatrix {
    pub id: String,
    pub name: String,
    /// `document` | `descriptor_value`
    pub row_kind: String,
    /// The descriptor field the rows group by, when `row_kind` is
    /// `descriptor_value`.
    pub row_field_id: Option<String>,
    /// Restrict the rows to this document set's members; `None` means every
    /// document.
    pub row_set_id: Option<String>,
    /// Take the columns from this code set; `None` means use `code_ids`.
    pub code_set_id: Option<String>,
    /// The columns, in column order, when `code_set_id` is `None`.
    pub code_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// What `create_matrix` and `update_matrix` take: a whole configuration, so
/// undo is "apply the previous one".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FrameworkMatrixInput {
    pub name: String,
    /// `document` | `descriptor_value`
    pub row_kind: String,
    pub row_field_id: Option<String>,
    pub row_set_id: Option<String>,
    pub code_set_id: Option<String>,
    pub code_ids: Vec<String>,
}

/// One computed row of a matrix: the key its summaries are stored under, what
/// to show in the row header, and the documents it stands for.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameworkRow {
    /// The document id, or the descriptor value (empty for "no value").
    pub row_key: String,
    pub label: String,
    pub document_ids: Vec<String>,
}

/// One cell: the written summary plus how much evidence sits behind it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameworkCell {
    pub row_key: String,
    pub code_id: String,
    pub summary: String,
    /// Distinct excerpts in the row's documents carrying this code or any of
    /// its descendants.
    pub excerpt_count: i64,
}

/// A matrix ready to render: the configuration, the computed rows, the
/// resolved columns and one cell per (row, column) pair.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameworkMatrixView {
    pub matrix: FrameworkMatrix,
    pub rows: Vec<FrameworkRow>,
    /// Code ids, in column order.
    pub columns: Vec<String>,
    pub cells: Vec<FrameworkCell>,
}

/// A deleted matrix with every summary it held, so undo can put it back.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameworkMatrixWithCells {
    pub matrix: FrameworkMatrix,
    /// `(rowKey, codeId, summary, updatedAt)` — the timestamp too, so undo
    /// puts the grid back exactly as it stood rather than touching every cell.
    pub cells: Vec<(String, String, String, String)>,
}

/// serde helper: distinguishes "absent" from "present but null".
mod double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S, T>(v: &Option<Option<T>>, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
        T: Serialize,
    {
        match v {
            Some(inner) => inner.serialize(s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        Option::<T>::deserialize(d).map(Some)
    }
}
