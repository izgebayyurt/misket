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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub source_path: Option<String>,
    pub source_format: Option<String>,
    pub text_length: Option<i64>,
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

// ----------------------------------------------------------------- excerpts

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyCodesInput {
    pub document_id: String,
    pub start_pos: i64,
    pub end_pos: i64,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExcerptFilter {
    #[serde(default)]
    pub code_ids: Option<Vec<String>>,
    #[serde(default = "default_true")]
    pub include_descendants: bool,
    #[serde(default)]
    pub document_ids: Option<Vec<String>>,
    #[serde(default)]
    pub uncoded_only: bool,
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
            include_descendants: true,
            document_ids: None,
            uncoded_only: false,
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

// ------------------------------------------------------------------- search

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub document_id: String,
    pub document_name: String,
    /// Code points, end-exclusive.
    pub start_pos: i64,
    pub end_pos: i64,
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
