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
    pub description: String,
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
    pub parent_id: Option<String>,
    #[serde(default)]
    pub shortcut: Option<String>,
}

/// Partial update. `shortcut` uses a double option so the frontend can clear
/// it (`{"shortcut": null}`) or leave it untouched (field absent).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodePatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, with = "double_option")]
    pub shortcut: Option<Option<String>>,
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
    #[serde(default)]
    pub shortcut: Option<String>,
    #[serde(default)]
    pub sort_order: i64,
}

/// What `db::codebook_import::import_codebook` should read: either the
/// parsed contents of a `misket-codebook` JSON file, or raw CSV text with
/// header `name,parent,color,description,shortcut` (`parent` is a full path
/// with ` / ` separators, the same convention as the codebook CSV export).
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

/// Everything needed to restore a deleted excerpt with its original ids.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExcerptSnapshot {
    pub excerpt: ExcerptWithCodes,
    pub memos: Vec<Memo>,
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
    /// Only allowed while no document has a value for the field.
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

// ------------------------------------------------------------------- search

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub document_id: String,
    pub document_name: String,
    /// Code points, end-exclusive.
    pub start_pos: i64,
    pub end_pos: i64,
    /// The actual matched text, which is not always the query text verbatim:
    /// a plain search can match a different case, and a stemmed search can
    /// match an altogether different word form.
    pub match_text: String,
    pub context_before: String,
    pub context_after: String,
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
