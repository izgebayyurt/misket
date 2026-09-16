//! The bundled sample project ("Try Misket with sample data"): three
//! synthetic interview transcripts on a fictional study, a small codebook,
//! pre-coded excerpts, two memos and two descriptor fields.
//!
//! Everything here goes through the ordinary domain functions
//! (`documents::create`, `codes::create`, `excerpts::apply_codes`,
//! `memos::create`, `descriptors::*`) rather than raw SQL, so the sample
//! always matches the current schema and validation rules. The spec lives in
//! `sample/sample_project.json`: excerpts are expressed as exact substrings
//! of a transcript (`{ document, quote, codes }`), and this module finds
//! each quote's code-point offsets at build time.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::Connection;
use serde::Deserialize;

use crate::db::{codes, descriptors, documents, excerpts, memos, text, OpenProject};
use crate::error::{AppError, Result};
use crate::models::{ApplyCodesInput, MemoTarget, NewCode, NewDescriptorField, NewDocument};

const SPEC: &str = include_str!("../sample/sample_project.json");
const P1_ENGINEER: &str = include_str!("../sample/p1_engineer.txt");
const P2_DESIGNER: &str = include_str!("../sample/p2_designer.txt");
const P3_MANAGER: &str = include_str!("../sample/p3_manager.txt");

#[derive(Deserialize)]
struct Spec {
    name: String,
    documents: Vec<SpecDocument>,
    #[serde(rename = "descriptorFields")]
    descriptor_fields: Vec<SpecField>,
    codes: Vec<SpecCode>,
    excerpts: Vec<SpecExcerpt>,
    memos: Vec<SpecMemo>,
}

#[derive(Deserialize)]
struct SpecDocument {
    key: String,
    name: String,
    file: String,
    #[serde(default)]
    descriptors: HashMap<String, String>,
}

#[derive(Deserialize)]
struct SpecField {
    key: String,
    name: String,
    kind: String,
    #[serde(default)]
    options: Vec<String>,
}

#[derive(Deserialize)]
struct SpecCode {
    key: String,
    name: String,
    color: String,
    description: String,
    #[serde(default)]
    children: Vec<SpecCode>,
}

#[derive(Deserialize)]
struct SpecExcerpt {
    document: String,
    quote: String,
    codes: Vec<String>,
}

#[derive(Deserialize)]
struct SpecMemo {
    target: String,
    #[serde(default)]
    code: Option<String>,
    title: String,
    body: String,
}

/// The bundled transcript text for a spec document's `file` key. The set of
/// files is fixed at compile time (embedded with `include_str!`), so an
/// unknown name means the spec and this module have drifted apart.
fn transcript_text(file: &str) -> Result<&'static str> {
    match file {
        "p1_engineer.txt" => Ok(P1_ENGINEER),
        "p2_designer.txt" => Ok(P2_DESIGNER),
        "p3_manager.txt" => Ok(P3_MANAGER),
        other => Err(AppError::Validation(format!(
            "sample spec: no bundled transcript named {other:?}"
        ))),
    }
}

/// Find `quote` as an exact substring of `doc_text` and return its `[start,
/// end)` range in Unicode code points. Errors if the quote is missing or
/// ambiguous, since the sample's excerpts must map onto the text unambiguously.
fn find_quote(doc_text: &str, quote: &str) -> Result<(i64, i64)> {
    let mut matches = doc_text.match_indices(quote);
    let (byte_start, _) = matches
        .next()
        .ok_or_else(|| AppError::Validation(format!("sample spec: quote not found: {quote:?}")))?;
    if matches.next().is_some() {
        return Err(AppError::Validation(format!(
            "sample spec: quote appears more than once, so its offset is ambiguous: {quote:?}"
        )));
    }
    let start = doc_text[..byte_start].chars().count() as i64;
    let end = start + text::cp_len(quote);
    Ok((start, end))
}

/// Create codes for `specs` under `parent_id`, recording each spec key's
/// generated id in `out` so excerpts and memos can refer to codes by name.
fn create_codes(
    conn: &Connection,
    specs: &[SpecCode],
    parent_id: Option<&str>,
    out: &mut HashMap<String, String>,
) -> Result<()> {
    for c in specs {
        let code = codes::create(
            conn,
            NewCode {
                name: c.name.clone(),
                color: Some(c.color.clone()),
                description: Some(c.description.clone()),
                parent_id: parent_id.map(str::to_string),
                shortcut: None,
            },
        )?;
        out.insert(c.key.clone(), code.id.clone());
        create_codes(conn, &c.children, Some(&code.id), out)?;
    }
    Ok(())
}

/// Create a fresh project file at `path` and fill it with the bundled sample.
/// Fails if `path` already exists (`OpenProject::create` does the same).
pub fn create_sample_project(path: &Path) -> Result<()> {
    let spec: Spec = serde_json::from_str(SPEC)?;
    let project = OpenProject::create(path, &spec.name, env!("CARGO_PKG_VERSION"))?;
    let conn = &project.conn;

    // Documents, keyed by the spec's short key so excerpts and descriptor
    // values below can refer to them without generated ids.
    let mut doc_ids: HashMap<String, String> = HashMap::new();
    let mut doc_texts: HashMap<String, String> = HashMap::new();
    for d in &spec.documents {
        let raw = transcript_text(&d.file)?;
        let doc = documents::create(
            conn,
            NewDocument {
                name: d.name.clone(),
                source_path: None,
                source_format: "txt".into(),
                text: raw.to_string(),
                allow_duplicate: false,
            },
        )?;
        doc_texts.insert(d.key.clone(), doc.text.unwrap_or_default());
        doc_ids.insert(d.key.clone(), doc.summary.id);
    }

    // Descriptor fields, then each document's values.
    let mut field_ids: HashMap<String, String> = HashMap::new();
    for f in &spec.descriptor_fields {
        let field = descriptors::create_field(
            conn,
            NewDescriptorField {
                name: f.name.clone(),
                kind: f.kind.clone(),
                options: if f.options.is_empty() {
                    None
                } else {
                    Some(f.options.clone())
                },
            },
        )?;
        field_ids.insert(f.key.clone(), field.id);
    }
    for d in &spec.documents {
        let doc_id = &doc_ids[&d.key];
        for (field_key, value) in &d.descriptors {
            let field_id = field_ids.get(field_key).ok_or_else(|| {
                AppError::Validation(format!(
                    "sample spec: unknown descriptor field {field_key:?}"
                ))
            })?;
            descriptors::set_value(conn, doc_id, field_id, Some(value))?;
        }
    }

    // The codebook: parents first, then their children.
    let mut code_ids: HashMap<String, String> = HashMap::new();
    create_codes(conn, &spec.codes, None, &mut code_ids)?;

    // Excerpts: locate each quote in its document and apply the listed codes.
    for e in &spec.excerpts {
        let doc_text = doc_texts.get(&e.document).ok_or_else(|| {
            AppError::Validation(format!("sample spec: unknown document {:?}", e.document))
        })?;
        let (start, end) = find_quote(doc_text, &e.quote)?;
        let ids =
            e.codes
                .iter()
                .map(|k| {
                    code_ids.get(k).cloned().ok_or_else(|| {
                        AppError::Validation(format!("sample spec: unknown code {k:?}"))
                    })
                })
                .collect::<Result<Vec<_>>>()?;
        excerpts::apply_codes(
            conn,
            ApplyCodesInput {
                document_id: doc_ids[&e.document].clone(),
                start_pos: Some(start),
                end_pos: Some(end),
                code_ids: ids,
                ..Default::default()
            },
        )?;
    }

    // Memos: one project memo, one code memo.
    for m in &spec.memos {
        let target = match m.target.as_str() {
            "project" => MemoTarget::default(),
            "code" => {
                let key = m.code.as_deref().ok_or_else(|| {
                    AppError::Validation("sample spec: a code memo needs a code key".into())
                })?;
                let code_id = code_ids.get(key).cloned().ok_or_else(|| {
                    AppError::Validation(format!("sample spec: unknown code {key:?}"))
                })?;
                MemoTarget {
                    code_id: Some(code_id),
                    ..Default::default()
                }
            }
            other => {
                return Err(AppError::Validation(format!(
                    "sample spec: unknown memo target {other:?}"
                )))
            }
        };
        memos::create(conn, target, &m.title, &m.body)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_consistent_sample_project() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.misket");
        create_sample_project(&path).unwrap();

        let project = OpenProject::open(&path).unwrap();
        let conn = &project.conn;
        let info = project.info().unwrap();
        assert_eq!(info.counts.documents, 3);
        assert_eq!(info.counts.codes, 10);
        assert_eq!(info.counts.memos, 2);

        let spec: Spec = serde_json::from_str(SPEC).unwrap();
        assert_eq!(info.counts.excerpts as usize, spec.excerpts.len());

        // Every quote in the spec maps to an excerpt whose stored snapshot
        // equals that exact quote (offsets were computed correctly), and
        // every excerpt in the project came from some quote.
        let docs = documents::list(conn).unwrap();
        assert_eq!(docs.len(), 3);
        let mut snapshots: Vec<String> = vec![];
        for d in &docs {
            for ex in excerpts::list_for_document(conn, &d.id).unwrap() {
                snapshots.push(ex.snapshot.unwrap_or_default());
            }
        }
        snapshots.sort();
        let mut quotes: Vec<String> = spec.excerpts.iter().map(|e| e.quote.clone()).collect();
        quotes.sort();
        assert_eq!(snapshots, quotes);

        let fields = descriptors::list_fields(conn).unwrap();
        assert_eq!(fields.len(), 2);
        for d in &docs {
            assert_eq!(
                descriptors::values_for_document(conn, &d.id).unwrap().len(),
                2
            );
        }

        // The project memo and the code memo both landed on their targets.
        let project_memos = memos::list(conn, &MemoTarget::default()).unwrap();
        assert_eq!(project_memos.len(), 1);
        let all_codes = codes::list(conn).unwrap();
        let boundaries = all_codes.iter().find(|c| c.name == "Boundaries").unwrap();
        let code_memos = memos::list(
            conn,
            &MemoTarget {
                code_id: Some(boundaries.id.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(code_memos.len(), 1);
    }

    #[test]
    fn refuses_to_overwrite_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.misket");
        std::fs::write(&path, b"").unwrap();
        assert!(matches!(
            create_sample_project(&path),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn find_quote_rejects_missing_or_ambiguous_matches() {
        assert_eq!(find_quote("a😀bc", "😀b").unwrap(), (1, 3));
        assert!(matches!(
            find_quote("abc", "nope"),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            find_quote("abcabc", "abc"),
            Err(AppError::Validation(_))
        ));
    }
}
