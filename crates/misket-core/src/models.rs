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
    /// Audio and video documents (`kind = 'video'`).
    #[serde(default)]
    pub media_documents: i64,
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
    /// Audio and video documents whose file is not where it was imported
    /// from; the overview lists them with a Relink action.
    #[serde(default)]
    pub missing_media: Vec<MissingMedia>,
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

/// An audio or video document. The file is **not** copied into the project
/// file: `source_path` points at it on disk and `media` records what the
/// frontend measured by loading it in a hidden media element. With
/// `copy_into_project` the file is first copied next to the `.misket` (into
/// `<project>.media/`) and `source_path` points at the copy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewMediaDocument {
    pub name: String,
    pub source_path: String,
    /// `audio/mpeg`, `video/mp4`, … — see `db::media::MEDIA_MIMES`.
    pub mime: String,
    /// What the webview read off the file: duration, pixel size, size on disk.
    pub media: MediaInfo,
    #[serde(default)]
    pub copy_into_project: bool,
    #[serde(default)]
    pub allow_duplicate: bool,
}

/// `documents.media_json`: what is known about an image, audio or video
/// document's media without opening the file again.
///
/// Only `mime` is always present. An image has `width`/`height`; a recording
/// has `duration_ms` and, for video, a pixel size too. `size_bytes` and
/// `file_hash` describe the file the document was imported from, so a
/// relinked file can be recognised as the same recording.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<i64>,
    pub mime: String,
    /// Playing time in milliseconds; the upper bound on a `video_range`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<i64>,
    /// A cheap content fingerprint: see `db::media::file_hash`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_hash: Option<String>,
    /// Waveform peaks in 0..1, one per equal slice of the recording. A
    /// rendering cache computed once by the viewer (`set_media_peaks`), like
    /// the transcript format cache in `documents.transcript_json`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peaks: Option<Vec<f64>>,
}

/// A candidate media file, staged so the webview can measure it before it
/// becomes a document (`stage_media_probe`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    /// Opaque token the media protocol serves this file under.
    pub token: String,
    pub mime: String,
    pub size_bytes: i64,
}

/// An audio or video document whose file is no longer where it was imported
/// from, for the warning badges and the project overview.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MissingMedia {
    pub document_id: String,
    pub name: String,
    pub source_path: Option<String>,
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
    /// True when this is an audio or video document whose file is not at
    /// `source_path` any more — the row shows a badge and the viewer offers
    /// to relink. Always false for text and image documents, whose bytes are
    /// inside the project file.
    #[serde(default)]
    pub media_missing: bool,
    pub sort_order: i64,
    pub excerpt_count: i64,
    /// The speakers the document's transcript format finds, in first-seen
    /// order; empty for anything that is not a transcript. Read from the
    /// cache in `documents.transcript_json`, so a listing never re-scans the
    /// text (see `db::transcripts`).
    #[serde(default)]
    pub speakers: Vec<String>,
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

/// A numeric scale a code's applications can be rated on: intensity 1..5, a
/// -2..+2 sentiment, and so on ("code weights" in Dedoose's terms). Validated
/// by `db::codes::validate_weight_scale`: `min < max`, `step > 0`, `default`
/// within `[min, max]`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeightScale {
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub default: f64,
    /// Labels for particular values (usually just the two ends: `"1" ->
    /// "weak"`, `"5" -> "strong"`), keyed by the value formatted the same way
    /// `db::codes::format_weight` would. A `BTreeMap` so the JSON serializes
    /// in a stable, numerically sorted order.
    #[serde(default)]
    pub labels: std::collections::BTreeMap<String, String>,
}

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
    /// The rating scale this code's codings can carry a weight on, if any.
    #[serde(default)]
    pub weight_scale: Option<WeightScale>,
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
    /// Double option: absent leaves the scale alone, `null` clears it
    /// (nulling every weight recorded under this code), and a value replaces
    /// it (see `db::codes::update` for what happens to weights that no
    /// longer fit).
    #[serde(default, with = "double_option")]
    pub weight_scale: Option<Option<WeightScale>>,
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

/// One `excerpt_codes` row as the frontend reads it: a code applied to this
/// excerpt by one coder. Two coders who applied the same code are two
/// codings and one entry in `code_ids`.
///
/// No longer `Eq`/`Hash` since `weight` joined the row: nothing needs a
/// `Coding` as a hash key, and comparing two codings by identity (same code,
/// same coder) rather than by their current weight is what callers that used
/// to `contains`/`==` a `Coding` actually want (see `excerpts::merge_adjacent`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Coding {
    pub code_id: String,
    pub coder_id: String,
    /// This coder's value on the code's scale, or `None` if the code has no
    /// scale or this coding has not been rated.
    #[serde(default)]
    pub weight: Option<f64>,
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
    /// Every code on this excerpt, once, whoever applied it. Rendering and
    /// the document view's lanes read this, so they do not change when a
    /// second coder agrees.
    pub code_ids: Vec<String>,
    /// The same codings with their coders, one entry per `excerpt_codes` row.
    /// Absent in a payload written before schema 11.
    #[serde(default)]
    pub codings: Vec<Coding>,
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
    /// How the document marks who is speaking (`db::transcripts`), verbatim,
    /// so a restore keeps a format the user chose rather than re-detecting
    /// one. `None` means it had never been looked at.
    #[serde(default)]
    pub transcript_json: Option<String>,
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
    /// The frame captured for a `video_range` excerpt, so deleting and
    /// undoing puts the thumbnail back with everything else.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<MediaThumbnail>,
}

/// A small image stored in `media_blobs` beside an excerpt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaThumbnail {
    pub mime: String,
    pub bytes: Vec<u8>,
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
    /// Only excerpts spoken by one of these speakers. Like `query`, this is
    /// not a SQL condition: it is answered from each document's transcript
    /// format (`db::transcripts`) before paging. Text excerpts only; an empty
    /// list is no filter at all.
    #[serde(default)]
    pub speakers: Option<Vec<String>>,
    /// Only excerpts that carry a coding by one of these coders
    /// (`db::coders`). `None` or empty means everyone, which is the default:
    /// the browser shows the whole project's coding unless asked otherwise.
    /// It narrows which excerpts come back, not which codes they show.
    #[serde(default)]
    pub coder_ids: Option<Vec<String>>,
    /// Only excerpts with a coding of `code_id` whose weight falls in
    /// `[min, max]` (inclusive). A coding with no weight never matches.
    #[serde(default)]
    pub weight_range: Option<WeightRangeFilter>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

/// See [`ExcerptFilter::weight_range`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeightRangeFilter {
    pub code_id: String,
    pub min: f64,
    pub max: f64,
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
            speakers: None,
            coder_ids: None,
            weight_range: None,
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
    /// Who was speaking where this excerpt starts, when the document is a
    /// transcript (`db::transcripts`); `None` otherwise.
    #[serde(default)]
    pub speaker: Option<String>,
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

/// What `db::bulk::set_weights_many` actually changed: only the codings that
/// existed and really had a different weight, each with the value it carried
/// before, so undo is the same call with those values put back.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BulkWeightReport {
    /// `(excerpt_id, coder_id, previous_weight)`, one entry per coding this
    /// call actually changed.
    pub changed: Vec<(String, String, Option<f64>)>,
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

/// One value on a weight scale and how many codings carry it. `histogram` in
/// [`WeightSummary`] has one entry per distinct value actually recorded, in
/// ascending order, so a scale nobody has used at the low end simply has no
/// bin there.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeightHistogramBin {
    pub value: f64,
    pub count: i64,
}

/// Summary statistics for one weighted code's codings, over whatever
/// [`ExcerptFilter`] scoped them to. See `db::analysis::weight_summary`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WeightSummary {
    /// How many codings of this code, in scope, carry a weight.
    pub count: i64,
    pub mean: Option<f64>,
    pub median: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub histogram: Vec<WeightHistogramBin>,
}

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
    /// Whose coding to count (`db::coders`); everyone when absent or empty.
    #[serde(default)]
    pub coder_ids: Option<Vec<String>>,
    /// Number fields only: how many equal-width bins to cut the range into
    /// (default [`crate::db::analysis::DEFAULT_NUMBER_BINS`]).
    #[serde(default)]
    pub bins: Option<i64>,
    /// What a cell counts: `excerpts` (the default) or `documents`.
    #[serde(default)]
    pub mode: Option<String>,
    /// What a cell holds: `count` (the default, `mode` above) or
    /// `meanWeight` — the mean of the row code's weights among the excerpts
    /// that column would otherwise count. A row whose code has no scale, or
    /// no weighted codings in a column, gets `null` there.
    #[serde(default)]
    pub measure: Option<String>,
}

impl Default for CrosstabRequest {
    fn default() -> Self {
        Self {
            field_id: String::new(),
            code_ids: None,
            include_descendants: true,
            document_ids: None,
            document_set_ids: None,
            coder_ids: None,
            bins: None,
            mode: None,
            measure: None,
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
    /// One mean weight per column, present (and non-empty) only when the
    /// request's `measure` is `"meanWeight"`. `None` in a cell means the
    /// code has no scale, or no weighted coding fell in that column.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight_cells: Option<Vec<Option<f64>>>,
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

// -------------------------------------------------- inter-rater reliability

/// The unit of analysis an inter-rater comparison counts over. See
/// [`crate::db::irr`] for how each one is built and what "present" means.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum IrrUnit {
    /// The document text split on `\n`, exactly as the viewer shows it; each
    /// non-blank paragraph, trimmed, is one unit.
    #[default]
    Paragraph,
    /// Speaker turns, for documents that have a transcript format; documents
    /// that do not fall back to paragraphs.
    Turn,
    /// The union of both coders' excerpt ranges — one unit per distinct
    /// range, and the strictest of the three.
    Excerpt,
}

impl IrrUnit {
    pub fn label(self) -> &'static str {
        match self {
            IrrUnit::Paragraph => "Paragraph",
            IrrUnit::Turn => "Speaker turn",
            IrrUnit::Excerpt => "Excerpt",
        }
    }
}

fn default_overlap_threshold() -> f64 {
    0.5
}

/// What to compare: two coders, over which documents, in which unit, with
/// which codes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IrrRequest {
    pub coder_a: String,
    pub coder_b: String,
    /// `None` (or empty) means every document both coders have at least one
    /// coding in — the documents they actually double-coded.
    #[serde(default)]
    pub document_ids: Option<Vec<String>>,
    /// Document sets; unioned into `document_ids`, as everywhere else.
    #[serde(default)]
    pub document_set_ids: Option<Vec<String>>,
    #[serde(default)]
    pub unit: IrrUnit,
    /// How much of a unit an excerpt must cover (or vice versa) for its code
    /// to count as present, `0..=1`. Ignored by [`IrrUnit::Excerpt`], which
    /// matches ranges exactly.
    #[serde(default = "default_overlap_threshold")]
    pub overlap_threshold: f64,
    /// `None` (or empty) means every code either coder applied anywhere in
    /// the documents being compared.
    #[serde(default)]
    pub code_ids: Option<Vec<String>>,
}

impl Default for IrrRequest {
    fn default() -> Self {
        Self {
            coder_a: String::new(),
            coder_b: String::new(),
            document_ids: None,
            document_set_ids: None,
            unit: IrrUnit::default(),
            overlap_threshold: default_overlap_threshold(),
            code_ids: None,
        }
    }
}

/// One code's 2×2 table and the two figures that come out of it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IrrCodeRow {
    pub code_id: String,
    pub code_name: String,
    pub code_path: String,
    pub color: String,
    /// The denominator: every unit in scope, coded or not.
    pub units: i64,
    pub both: i64,
    pub a_only: i64,
    pub b_only: i64,
    pub neither: i64,
    /// `(both + neither) / units`, `0..=1`.
    pub percent_agreement: f64,
    /// Cohen's kappa, or `None` where it is undefined (no units, or expected
    /// agreement of exactly 1 — e.g. neither coder ever applied the code).
    pub kappa: Option<f64>,
    /// The Landis & Koch band for `kappa`, or `""` when it is undefined.
    pub interpretation: String,
}

/// One document's share of the comparison.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IrrDocumentRow {
    pub document_id: String,
    pub document_name: String,
    pub units: i64,
    /// `(both + neither) / (units × codes)` for this document alone.
    pub percent_agreement: f64,
    pub disagreements: i64,
}

/// One unit one coder coded and the other did not.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IrrDisagreement {
    pub document_id: String,
    pub document_name: String,
    /// The unit's position in its document, from 0.
    pub unit_index: i64,
    /// `text` or `image_region`, matching `excerpts.kind`.
    pub kind: String,
    /// Code points, end-exclusive; both `0` for an image region.
    pub start: i64,
    pub end: i64,
    /// The unit's text, truncated for display.
    pub snippet: String,
    pub code_id: String,
    pub code_name: String,
    pub color: String,
    /// `a` or `b` — which of the two coders applied it.
    pub who: String,
    /// The coder id behind `who`, so the frontend can tell whether this is
    /// the local coder's own coding without re-deriving it.
    pub coder_id: String,
    /// The excerpt whose range *is* this unit, when one exists: what "adopt"
    /// reuses and what a jump focuses.
    pub unit_excerpt_id: Option<String>,
    /// The excerpts carrying the coding, in document order: what "remove
    /// mine" takes the code off.
    pub excerpt_ids: Vec<String>,
}

/// Everything the reliability view shows.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IrrReport {
    pub coder_a: String,
    pub coder_b: String,
    pub coder_a_name: String,
    pub coder_b_name: String,
    pub unit: IrrUnit,
    pub overlap_threshold: f64,
    /// The documents actually compared, in project order.
    pub documents: Vec<IrrDocumentRow>,
    /// Units summed over those documents.
    pub units: i64,
    /// `units × codes`: the number of yes/no decisions each coder made.
    pub decisions: i64,
    pub codes: Vec<IrrCodeRow>,
    /// Cohen's kappa over every (code × unit) decision pooled together.
    pub pooled_kappa: Option<f64>,
    pub pooled_interpretation: String,
    /// The unweighted mean of the per-code kappas that are defined.
    pub mean_kappa: Option<f64>,
    /// `(both + neither) / decisions` over everything.
    pub percent_agreement: f64,
    /// The first [`crate::db::irr::MAX_DISAGREEMENTS`], in document order.
    pub disagreements: Vec<IrrDisagreement>,
    /// How many there are in total, which `disagreements` may have truncated.
    pub disagreement_count: i64,
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

// ------------------------------------------------------------------- coders

/// One coder: an install of Misket, identified by a UUID generated once and
/// kept in the app's settings. See `db::coders`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Coder {
    pub id: String,
    pub name: String,
    /// A hex colour, so codings can be told apart at a glance.
    pub color: String,
    pub created_at: String,
}

/// A coder with how much of the project is theirs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoderSummary {
    pub id: String,
    pub name: String,
    pub color: String,
    /// `excerpt_codes` rows, not distinct excerpts.
    pub coding_count: i64,
    pub memo_count: i64,
    /// Whether this is the coder this connection writes as.
    pub is_local: bool,
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
    /// Who wrote it (`db::coders`). Empty in a payload written before
    /// schema 11.
    #[serde(default)]
    pub coder_id: String,
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
    /// Which coder made this edit (`db::coders`); empty before schema 11.
    #[serde(default)]
    pub coder_id: String,
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
    /// Which coder made this edit (`db::coders`); empty for a node recorded
    /// before schema 11.
    #[serde(default)]
    pub coder_id: String,
    pub kind: String,
    pub summary: String,
    pub branch_name: Option<String>,
    pub undoable: bool,
    pub is_head: bool,
    /// Which child redo would follow from here; the graph view uses it to
    /// tell the branch a checkout is "on" from a side branch that merely
    /// passes through the same node.
    pub preferred_child: Option<i64>,
    /// How many writes this node stands for: 1 normally, more when it is a
    /// compound step (a merge, an import of several files) shown as one.
    pub step_count: i64,
    /// Oldest first; more than one means the tree branches here.
    pub children: Vec<i64>,
}

/// Something a history step points at, named as it reads *now*.
///
/// The step's own `detail` carries the names things had when it was recorded;
/// this is the same thing looked up again, so the detail panel can offer to
/// open it — and say plainly when it cannot, because the target has since been
/// deleted (`exists` false, and `label` says so too).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRef {
    /// `excerpt`, `code`, `document` or `memo`.
    pub kind: String,
    pub id: String,
    /// What to show: the code's name, the document's name, the excerpt's
    /// text — with `(since deleted)` appended when it is gone.
    pub label: String,
    /// Whether the target is still in the project.
    pub exists: bool,
    /// A code's colour, when it still exists.
    #[serde(default)]
    pub color: Option<String>,
    /// A code's path through the codebook (`Parent › Child`), when it exists.
    #[serde(default)]
    pub path: Option<String>,
    /// An excerpt's `kind`, so the panel knows whether its offsets are code
    /// points or milliseconds — and whether "show me" means a passage or a
    /// stretch of tape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excerpt_kind: Option<String>,
    /// Where an excerpt sits, so the panel can open the document there.
    #[serde(default)]
    pub document_id: Option<String>,
    #[serde(default)]
    pub start_pos: Option<i64>,
    #[serde(default)]
    pub end_pos: Option<i64>,
}

/// One write inside a compound step, for the detail panel's list of members.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryStepMember {
    pub id: i64,
    pub kind: String,
    pub summary: String,
}

/// One history step, with everything the detail panel needs to describe it:
/// the stored `detail`, the references it points at resolved against the
/// project as it is now, and — for a compound step — the writes it stands for.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryNodeDetail {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub at: String,
    pub actor: String,
    #[serde(default)]
    pub coder_id: String,
    pub kind: String,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub summary: String,
    pub detail: serde_json::Value,
    pub branch_name: Option<String>,
    pub undoable: bool,
    pub is_head: bool,
    /// Whether this step is in force: the project sits at it or below it.
    /// A step the project has undone past, or one on a branch it is not on,
    /// is not applied, and a reference of its that cannot be found says so
    /// rather than claiming the target was deleted.
    pub applied: bool,
    /// How many writes this step stands for: 1 normally, more for a group.
    pub step_count: i64,
    /// Resolved references, the step's own target first.
    pub refs: Vec<HistoryRef>,
    /// The writes of a compound step, oldest first; empty for a plain one.
    pub members: Vec<HistoryStepMember>,
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
    /// The scale this code carries, if any, as `Code::weightScale` — kept as
    /// its own field (rather than reusing `Code`) so a snapshot round-trips
    /// exactly what was in `codes.weight_scale_json`.
    #[serde(default)]
    pub weight_scale: Option<WeightScale>,
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

/// One `excerpt_codes` row, with the coder it belongs to, so undo and redo
/// put a coding back under the name that made it. `coder_id` is empty in a
/// payload written before schema 11; replaying one of those stamps the local
/// coder, which is who wrote it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagRow {
    pub excerpt_id: String,
    pub code_id: String,
    #[serde(default)]
    pub coder_id: String,
    pub created_at: String,
    /// Absent (rather than `None`) in a payload written before schema 13,
    /// which is exactly what should happen when replaying it: the coding had
    /// no weight yet.
    #[serde(default)]
    pub weight: Option<f64>,
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

// -------------------------------------------------------- pulling a copy

/// How much of one kind of thing a pull found, split by what happened to it.
///
/// `matched` is "the same row, recognised by its id"; `renamed` is the softer
/// match the rules allow (a document by its content hash, a code by its place
/// and name, a set or a field by its name); `new` is what only the other copy
/// has and the pull would bring over.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MergeCount {
    pub matched: i64,
    /// Matched by something other than the id — a hash, a name, a range.
    pub by_name: i64,
    pub new: i64,
}

/// One coder in the other copy, and how much of it is theirs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MergeCoder {
    pub id: String,
    pub name: String,
    pub color: String,
    /// `excerpt_codes` rows in the other file.
    pub coding_count: i64,
    /// Codings of theirs this pull would actually bring over.
    pub incoming_count: i64,
    /// Whether this is the coder the other file writes as.
    pub is_theirs: bool,
    /// Whether this is *us*: our own work coming back through their copy.
    pub is_local: bool,
}

/// A question only the user can answer: both copies changed the same thing.
///
/// `ours` and `theirs` are the two values as prose, ready to show side by
/// side. `choice` ids are stable strings (`ours`, `theirs`, `both`,
/// `restore`, `drop`) and `default` is the one the dialog preselects.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeConflict {
    /// Stable within one plan, and the same across a preview and the apply
    /// that follows it: `<kind>:<target>`.
    pub id: String,
    /// `code.scalar` | `code.deletedHere` | `memo` | `descriptor.value` |
    /// `framework.cell`
    pub kind: String,
    /// What the conflict is about, for the dialog's heading.
    pub title: String,
    /// The field or cell in question, when the title alone is ambiguous.
    pub field: String,
    pub ours: String,
    pub theirs: String,
    /// `(id, label)` for every way out, in the order to show them.
    pub choices: Vec<(String, String)>,
    pub default: String,
}

/// The user's answer to one [`MergeConflict`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MergeDecision {
    pub conflict_id: String,
    pub choice: String,
}

/// What pulling from another copy would do, shown before anything is written.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MergePlan {
    /// The other file's own name for itself, falling back to its file name.
    pub other_name: String,
    pub other_path: String,
    pub other_project_id: String,
    /// Whether that is the same project this file is a copy of.
    pub same_project: bool,
    /// Nothing has ever been pulled from this copy before, so there is no
    /// base to merge scalars against and ours stand.
    pub first_pull: bool,
    pub other_coders: Vec<MergeCoder>,
    pub documents: MergeCount,
    pub codes: MergeCount,
    pub excerpts: MergeCount,
    pub codings: MergeCount,
    pub memos: MergeCount,
    pub descriptor_fields: MergeCount,
    pub descriptor_values: MergeCount,
    pub sets: MergeCount,
    pub filters: MergeCount,
    pub framework_matrices: MergeCount,
    pub framework_cells: MergeCount,
    pub conflicts: Vec<MergeConflict>,
    /// Plain sentences worth reading before confirming.
    pub notes: Vec<String>,
}

impl MergePlan {
    /// Whether the pull would write anything at all.
    pub fn is_empty(&self) -> bool {
        self.conflicts.is_empty()
            && [
                &self.documents,
                &self.codes,
                &self.excerpts,
                &self.codings,
                &self.memos,
                &self.descriptor_fields,
                &self.descriptor_values,
                &self.sets,
                &self.filters,
                &self.framework_matrices,
                &self.framework_cells,
            ]
            .iter()
            .all(|c| c.new == 0)
    }
}

/// What a pull did, once it has been done.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    pub other_name: String,
    pub documents: i64,
    pub codes: i64,
    pub excerpts: i64,
    pub codings: i64,
    pub memos: i64,
    pub descriptor_fields: i64,
    pub descriptor_values: i64,
    pub sets: i64,
    pub filters: i64,
    pub framework_matrices: i64,
    pub framework_cells: i64,
    /// Conflicts that were answered, however they were answered.
    pub conflicts_resolved: i64,
    /// Codings brought over, by coder id, biggest first.
    pub by_coder: Vec<MergeCoder>,
    /// The sentence the history shows for the whole pull.
    pub summary: String,
}

/// One row of `sync_points`: what we knew of another copy last time we pulled.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncPoint {
    pub other_project_id: String,
    pub other_coder_id: String,
    pub at: String,
    pub our_node_id: Option<i64>,
    pub their_node_id: Option<i64>,
    /// The mergeable scalar state as it stood after that pull, written and
    /// read only by `db::merge`.
    pub base_json: String,
}

// ---------------------------------------------------------------- REFI-QDA

/// What `db::refi::export_refi` wrote, for the toast and the tests.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RefiExportReport {
    pub path: String,
    pub text_sources: i64,
    pub picture_sources: i64,
    /// Sources carried by reference rather than by content (video).
    pub other_sources: i64,
    pub codes: i64,
    /// `PlainTextSelection` / `PictureSelection` elements written.
    pub selections: i64,
    pub codings: i64,
    pub users: i64,
    pub notes: i64,
    pub variables: i64,
    pub sets: i64,
    /// What REFI-QDA has no room for, in sentences ready to show.
    pub skipped: Vec<String>,
}

/// What importing a `.qdpx` would bring in (`db::refi::preview_refi`). Reads
/// the file and writes nothing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RefiPreview {
    pub project_name: String,
    /// The `origin` attribute: which tool wrote the file.
    pub origin: String,
    pub text_sources: i64,
    pub picture_sources: i64,
    pub codes: i64,
    pub codings: i64,
    pub users: i64,
    pub notes: i64,
    pub variables: i64,
    pub sets: i64,
    /// Sources and elements Misket has no place for, ready to show.
    pub unsupported: Vec<String>,
    /// Whether the open project already holds documents or codes, in which
    /// case `replace` is not on offer.
    pub project_has_content: bool,
}

/// What `db::refi::import_refi` brought in.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RefiImportReport {
    pub project_name: String,
    pub documents: i64,
    /// Documents the file and the project turned out to share.
    pub matched_documents: i64,
    pub excerpts: i64,
    pub codes: i64,
    pub matched_codes: i64,
    pub codings: i64,
    pub coders: i64,
    pub memos: i64,
    pub descriptor_fields: i64,
    pub descriptor_values: i64,
    pub sets: i64,
    /// The sentence the history and the toast show.
    pub summary: String,
    pub unsupported: Vec<String>,
}

/// `Merge` matches documents by content and codes by their full name path,
/// the way a codebook import does; `Replace` brings everything in under the
/// file's own identities and is only allowed into a project that holds no
/// documents and no codes.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RefiImportMode {
    Merge,
    Replace,
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
