//! Import a codebook (a `misket-codebook` JSON export, or CSV with header
//! `name,parent,color,description,inclusion,exclusion,shortcut`) into the
//! current project. The pre-schema-5 header without `inclusion,exclusion`
//! is still accepted, so codebooks written by older builds keep importing.

use std::collections::HashMap;

use rusqlite::Connection;
use serde_json::json;

use super::{activity, codes, export::code_paths, util};
use crate::error::{AppError, Result};
use crate::models::{
    CodePatch, CodebookImport, CodebookJsonCode, ImportMode, ImportReport, NewCode,
};

/// A code reduced to its full path (`["Parent", "Child"]`) plus the fields
/// its own entry carries. Both input formats parse down to this.
struct ParsedCode {
    path: Vec<String>,
    color: Option<String>,
    description: String,
    inclusion: String,
    exclusion: String,
    shortcut: Option<String>,
}

fn is_valid_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Resolve every code's full name path by walking `parentId` references.
fn parse_json(codes: &[CodebookJsonCode]) -> Result<Vec<ParsedCode>> {
    let by_id: HashMap<&str, &CodebookJsonCode> =
        codes.iter().map(|c| (c.id.as_str(), c)).collect();
    let mut out = Vec::with_capacity(codes.len());
    for c in codes {
        let mut parts = vec![c.name.clone()];
        let mut cur = c.parent_id.as_deref();
        let mut guard = 0;
        while let Some(pid) = cur {
            guard += 1;
            if guard > 64 {
                return Err(AppError::Validation(
                    "codebook JSON has a cycle in parentId references".into(),
                ));
            }
            match by_id.get(pid) {
                Some(p) => {
                    parts.push(p.name.clone());
                    cur = p.parent_id.as_deref();
                }
                None => break,
            }
        }
        parts.reverse();
        out.push(ParsedCode {
            path: parts,
            color: Some(c.color.clone()).filter(|s| !s.is_empty()),
            description: c.description.clone(),
            inclusion: c.inclusion.clone(),
            exclusion: c.exclusion.clone(),
            shortcut: c.shortcut.clone().filter(|s| !s.is_empty()),
        });
    }
    Ok(out)
}

const CSV_HEADER: [&str; 7] = [
    "name",
    "parent",
    "color",
    "description",
    "inclusion",
    "exclusion",
    "shortcut",
];
/// The header this file used before schema 5; still read, with the two new
/// fields left empty.
const CSV_HEADER_LEGACY: [&str; 5] = ["name", "parent", "color", "description", "shortcut"];

fn parse_csv(text: &str) -> Result<Vec<ParsedCode>> {
    let mut rdr = csv::ReaderBuilder::new().from_reader(text.as_bytes());
    let headers = rdr
        .headers()
        .map_err(|e| AppError::Validation(format!("row 1: {e}")))?
        .clone();
    let got: Vec<String> = headers
        .iter()
        .map(|h| h.trim().to_ascii_lowercase())
        .collect();
    let legacy = got == CSV_HEADER_LEGACY;
    if !legacy && got != CSV_HEADER {
        return Err(AppError::Validation(format!(
            "expected CSV header \"{}\", found \"{}\"",
            CSV_HEADER.join(","),
            got.join(",")
        )));
    }
    let mut out = vec![];
    for (i, result) in rdr.records().enumerate() {
        let row = i + 2; // header is row 1, data starts at row 2
        let record = result.map_err(|e| AppError::Validation(format!("row {row}: {e}")))?;
        let get = |idx: usize| record.get(idx).unwrap_or("").trim();
        let name = get(0);
        if name.is_empty() {
            return Err(AppError::Validation(format!("row {row}: name is required")));
        }
        let parent = get(1);
        let mut path: Vec<String> = if parent.is_empty() {
            vec![]
        } else {
            parent.split(" / ").map(|s| s.trim().to_string()).collect()
        };
        path.push(name.to_string());
        let color = get(2);
        let shortcut = if legacy { get(4) } else { get(6) };
        out.push(ParsedCode {
            path,
            color: if color.is_empty() {
                None
            } else {
                Some(color.to_string())
            },
            description: get(3).to_string(),
            inclusion: if legacy { "" } else { get(4) }.to_string(),
            exclusion: if legacy { "" } else { get(5) }.to_string(),
            shortcut: if shortcut.is_empty() {
                None
            } else {
                Some(shortcut.to_string())
            },
        });
    }
    Ok(out)
}

/// Create a leaf code, dropping (and reporting) a shortcut that is invalid
/// or already taken rather than failing the whole import.
fn create_leaf(
    conn: &Connection,
    segment: &str,
    parent_id: Option<&str>,
    pc: &ParsedCode,
    label: &str,
    report: &mut ImportReport,
) -> Result<String> {
    let color = pc
        .color
        .as_deref()
        .filter(|c| is_valid_hex_color(c))
        .map(String::from);
    let input = NewCode {
        name: segment.to_string(),
        color,
        description: Some(pc.description.clone()),
        inclusion: Some(pc.inclusion.clone()),
        exclusion: Some(pc.exclusion.clone()),
        parent_id: parent_id.map(String::from),
        shortcut: pc.shortcut.clone(),
    };
    if input.shortcut.is_some() {
        match codes::create(conn, input.clone()) {
            Ok(c) => return Ok(c.id),
            Err(AppError::Conflict(_)) | Err(AppError::Validation(_)) => {
                report.skipped_shortcuts.push(label.to_string());
                let mut retry = input;
                retry.shortcut = None;
                return Ok(codes::create(conn, retry)?.id);
            }
            Err(e) => return Err(e),
        }
    }
    Ok(codes::create(conn, input)?.id)
}

/// Fill empty fields on an already-existing (matched, or created bare
/// earlier in this import) code from a leaf's parsed data. Never overwrites
/// a non-empty value.
fn fill_leaf(
    conn: &Connection,
    id: &str,
    pc: &ParsedCode,
    label: &str,
    report: &mut ImportReport,
) -> Result<()> {
    let current = codes::get(conn, id)?;
    let mut patch = CodePatch::default();
    if current.description.trim().is_empty() && !pc.description.trim().is_empty() {
        patch.description = Some(pc.description.clone());
    }
    if current.inclusion.trim().is_empty() && !pc.inclusion.trim().is_empty() {
        patch.inclusion = Some(pc.inclusion.clone());
    }
    if current.exclusion.trim().is_empty() && !pc.exclusion.trim().is_empty() {
        patch.exclusion = Some(pc.exclusion.clone());
    }
    if current.color.trim().is_empty() {
        if let Some(c) = pc.color.as_deref().filter(|c| is_valid_hex_color(c)) {
            patch.color = Some(c.to_string());
        }
    }
    if current.shortcut.is_none() {
        if let Some(sc) = pc.shortcut.as_deref() {
            patch.shortcut = Some(Some(sc.to_string()));
        }
    }
    let has_patch = patch.color.is_some()
        || patch.description.is_some()
        || patch.inclusion.is_some()
        || patch.exclusion.is_some()
        || patch.shortcut.is_some();
    if !has_patch {
        return Ok(());
    }
    match codes::update(conn, id, patch.clone()) {
        Ok(_) => Ok(()),
        Err(AppError::Conflict(_)) | Err(AppError::Validation(_)) if patch.shortcut.is_some() => {
            report.skipped_shortcuts.push(label.to_string());
            let mut retry = patch;
            retry.shortcut = None;
            if retry.color.is_some()
                || retry.description.is_some()
                || retry.inclusion.is_some()
                || retry.exclusion.is_some()
            {
                codes::update(conn, id, retry)?;
            }
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// Import a codebook. One transaction: either everything lands, or nothing does.
pub fn import_codebook(
    conn: &Connection,
    input: CodebookImport,
    mode: ImportMode,
) -> Result<ImportReport> {
    let mut parsed = match input {
        CodebookImport::Json { codes } => parse_json(&codes)?,
        CodebookImport::Csv { text } => parse_csv(&text)?,
    };
    // Shallowest paths first, so a code is always created/matched via its
    // own entry before some descendant gets a chance to auto-create it bare.
    parsed.sort_by_key(|pc| pc.path.len());

    let tx = util::tx(conn)?;
    let mut report = ImportReport::default();

    let base_parent_id = match &mode {
        ImportMode::Merge => None,
        ImportMode::AddUnder { parent_id } => parent_id.clone(),
    };
    if let Some(pid) = &base_parent_id {
        codes::get(&tx, pid)?; // NotFound bubbles up if the chosen parent doesn't exist
    }

    // Existing codes to match against, by lowercase full path. Frozen to
    // the pre-import state: codes created during this import are tracked
    // separately in `resolved`.
    let by_lower_path: HashMap<String, String> = if matches!(mode, ImportMode::Merge) {
        let existing = codes::list(&tx)?;
        let paths = code_paths(&existing);
        existing
            .iter()
            .map(|c| (paths[&c.id].to_lowercase(), c.id.clone()))
            .collect()
    } else {
        HashMap::new()
    };

    let mut resolved: HashMap<String, String> = HashMap::new();

    for pc in &parsed {
        let mut parent_id = base_parent_id.clone();
        let mut acc: Vec<String> = Vec::with_capacity(pc.path.len());
        let last = pc.path.len().saturating_sub(1);
        let label = pc.path.join(" / ");
        for (depth, segment) in pc.path.iter().enumerate() {
            acc.push(segment.clone());
            let key = acc.join(" / ").to_lowercase();
            let is_leaf = depth == last;

            if let Some(id) = resolved.get(&key).cloned() {
                if is_leaf {
                    fill_leaf(&tx, &id, pc, &label, &mut report)?;
                }
                parent_id = Some(id);
                continue;
            }
            if let Some(id) = by_lower_path.get(&key).cloned() {
                report.matched += 1;
                if is_leaf {
                    fill_leaf(&tx, &id, pc, &label, &mut report)?;
                }
                resolved.insert(key, id.clone());
                parent_id = Some(id);
                continue;
            }
            let id = if is_leaf {
                create_leaf(&tx, segment, parent_id.as_deref(), pc, &label, &mut report)?
            } else {
                codes::create(
                    &tx,
                    NewCode {
                        name: segment.clone(),
                        parent_id: parent_id.clone(),
                        ..Default::default()
                    },
                )?
                .id
            };
            report.created += 1;
            resolved.insert(key, id.clone());
            parent_id = Some(id);
        }
    }

    // The codes themselves each logged a `code.created`/`code.updated`; this
    // is the one entry that says they arrived together, and from where.
    activity::record(
        &tx,
        "codebook.imported",
        "codebook",
        None,
        format!(
            "Imported a codebook: {} code{} created, {} matched",
            report.created,
            if report.created == 1 { "" } else { "s" },
            report.matched
        ),
        json!({
            "mode": match &mode {
                ImportMode::Merge => "merge",
                ImportMode::AddUnder { .. } => "add-under",
            },
            "parentId": base_parent_id,
            "created": report.created,
            "matched": report.matched,
            "skippedShortcuts": report.skipped_shortcuts,
        }),
    )?;
    tx.commit()?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::codes::tests::mk;
    use crate::db::export;
    use crate::db::OpenProject;

    fn json_of(p: &OpenProject) -> CodebookImport {
        let mut buf = vec![];
        export::codebook_json(&p.conn, &mut buf).unwrap();
        let doc: serde_json::Value = serde_json::from_slice(&buf).unwrap();
        let codes: Vec<CodebookJsonCode> = serde_json::from_value(doc["codes"].clone()).unwrap();
        CodebookImport::Json { codes }
    }

    /// name -> (description, color, shortcut, parent name) for easy assertions.
    fn by_name(codes: &[crate::models::Code]) -> HashMap<String, &crate::models::Code> {
        codes.iter().map(|c| (c.name.clone(), c)).collect()
    }

    #[test]
    fn json_round_trip_into_empty_project_matches_source_tree() {
        let src = OpenProject::in_memory("src").unwrap();
        let a = mk(&src.conn, "Attitudes", None);
        let b = mk(&src.conn, "Positive", Some(&a.id));
        codes::update(
            &src.conn,
            &a.id,
            CodePatch {
                description: Some("Top-level theme".into()),
                shortcut: Some(Some("a".into())),
                ..Default::default()
            },
        )
        .unwrap();
        codes::update(
            &src.conn,
            &b.id,
            CodePatch {
                description: Some("Positive framing".into()),
                color: Some("#123456".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let input = json_of(&src);

        let dst = OpenProject::in_memory("dst").unwrap();
        let report = import_codebook(&dst.conn, input, ImportMode::Merge).unwrap();
        assert_eq!(report.created, 2);
        assert_eq!(report.matched, 0);
        assert!(report.skipped_shortcuts.is_empty());

        let dst_codes = codes::list(&dst.conn).unwrap();
        let by_name = by_name(&dst_codes);
        let got_a = by_name["Attitudes"];
        let got_b = by_name["Positive"];
        assert_eq!(got_a.parent_id, None);
        assert_eq!(got_a.description, "Top-level theme");
        assert_eq!(got_a.shortcut.as_deref(), Some("a"));
        assert_eq!(got_b.parent_id.as_deref(), Some(got_a.id.as_str()));
        assert_eq!(got_b.description, "Positive framing");
        assert_eq!(got_b.color, "#123456");
    }

    #[test]
    fn merge_matches_existing_by_path_and_only_fills_empty_fields() {
        let p = OpenProject::in_memory("t").unwrap();
        // Target already has "Greeting" (no description) and "Greeting / Formal" (has one).
        let greeting = mk(&p.conn, "Greeting", None);
        let formal = mk(&p.conn, "Formal", Some(&greeting.id));
        codes::update(
            &p.conn,
            &formal.id,
            CodePatch {
                description: Some("Already documented".into()),
                ..Default::default()
            },
        )
        .unwrap();

        let input = CodebookImport::Csv {
            text: "name,parent,color,description,shortcut\n\
                   Greeting,,,Talking about hi and bye,\n\
                   Formal,Greeting,,Overwrite attempt,\n\
                   Casual,Greeting,,Slang and abbreviations,\n"
                .to_string(),
        };
        let report = import_codebook(&p.conn, input, ImportMode::Merge).unwrap();
        // Greeting and Formal matched; Casual is new.
        assert_eq!(report.matched, 2);
        assert_eq!(report.created, 1);

        let all = codes::list(&p.conn).unwrap();
        let by_name = by_name(&all);
        // Greeting's description was empty, so it got filled in.
        assert_eq!(by_name["Greeting"].description, "Talking about hi and bye");
        // Formal already had a description: never overwritten.
        assert_eq!(by_name["Formal"].description, "Already documented");
        // Casual is new, under the matched "Greeting".
        assert_eq!(
            by_name["Casual"].parent_id.as_deref(),
            Some(by_name["Greeting"].id.as_str())
        );
        assert_eq!(by_name["Casual"].description, "Slang and abbreviations");
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn csv_with_nested_paths_builds_the_tree() {
        let p = OpenProject::in_memory("t").unwrap();
        let input = CodebookImport::Csv {
            text: "name,parent,color,description,shortcut\n\
                   Theme,,#5CB85C,A top theme,t\n\
                   Sub,Theme,,,\n\
                   Leaf,Theme / Sub,#ABCDEF,Deepest level,\n"
                .to_string(),
        };
        let report = import_codebook(&p.conn, input, ImportMode::Merge).unwrap();
        assert_eq!(report.created, 3);
        assert_eq!(report.matched, 0);

        let all = codes::list(&p.conn).unwrap();
        let by_name = by_name(&all);
        let theme = by_name["Theme"];
        let sub = by_name["Sub"];
        let leaf = by_name["Leaf"];
        assert_eq!(theme.parent_id, None);
        assert_eq!(theme.color, "#5CB85C");
        assert_eq!(theme.shortcut.as_deref(), Some("t"));
        assert_eq!(sub.parent_id.as_deref(), Some(theme.id.as_str()));
        assert_eq!(leaf.parent_id.as_deref(), Some(sub.id.as_str()));
        assert_eq!(leaf.color, "#ABCDEF");
        assert_eq!(leaf.description, "Deepest level");
    }

    #[test]
    fn csv_carries_inclusion_and_exclusion_and_still_reads_the_legacy_header() {
        let p = OpenProject::in_memory("t").unwrap();
        let input = CodebookImport::Csv {
            text: "name,parent,color,description,inclusion,exclusion,shortcut\n\
                   Trust,,,Trusting the service,Names trust or reliance,Mere satisfaction,t\n"
                .to_string(),
        };
        import_codebook(&p.conn, input, ImportMode::Merge).unwrap();
        let all = codes::list(&p.conn).unwrap();
        let first = by_name(&all);
        assert_eq!(first["Trust"].inclusion, "Names trust or reliance");
        assert_eq!(first["Trust"].exclusion, "Mere satisfaction");

        // The header older builds wrote still imports, with both rules empty.
        let legacy = CodebookImport::Csv {
            text: "name,parent,color,description,shortcut\nDoubt,,,Hesitation,d\n".to_string(),
        };
        import_codebook(&p.conn, legacy, ImportMode::Merge).unwrap();
        let after = codes::list(&p.conn).unwrap();
        let by_name = by_name(&after);
        assert_eq!(by_name["Doubt"].description, "Hesitation");
        assert_eq!(by_name["Doubt"].inclusion, "");
        assert_eq!(by_name["Doubt"].exclusion, "");
    }

    #[test]
    fn merge_fills_empty_rules_without_overwriting_written_ones() {
        let p = OpenProject::in_memory("t").unwrap();
        let trust = mk(&p.conn, "Trust", None);
        codes::update(
            &p.conn,
            &trust.id,
            CodePatch {
                inclusion: Some("Mine, already written".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let input = CodebookImport::Csv {
            text: "name,parent,color,description,inclusion,exclusion,shortcut\n\
                   Trust,,,,Theirs,Not satisfaction,\n"
                .to_string(),
        };
        import_codebook(&p.conn, input, ImportMode::Merge).unwrap();
        let all = codes::list(&p.conn).unwrap();
        let by_name = by_name(&all);
        assert_eq!(by_name["Trust"].inclusion, "Mine, already written");
        assert_eq!(by_name["Trust"].exclusion, "Not satisfaction");
    }

    #[test]
    fn json_round_trip_carries_the_definition_fields() {
        let src = OpenProject::in_memory("src").unwrap();
        let a = mk(&src.conn, "Trust", None);
        codes::update(
            &src.conn,
            &a.id,
            CodePatch {
                inclusion: Some("Names trust".into()),
                exclusion: Some("Not satisfaction".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let input = json_of(&src);
        let dst = OpenProject::in_memory("dst").unwrap();
        import_codebook(&dst.conn, input, ImportMode::Merge).unwrap();
        let all = codes::list(&dst.conn).unwrap();
        let by_name = by_name(&all);
        assert_eq!(by_name["Trust"].inclusion, "Names trust");
        assert_eq!(by_name["Trust"].exclusion, "Not satisfaction");
    }

    #[test]
    fn invalid_csv_rows_report_row_numbers() {
        let p = OpenProject::in_memory("t").unwrap();
        let missing_name = CodebookImport::Csv {
            text: "name,parent,color,description,shortcut\nAlpha,,,,\n,Alpha,,,\n".to_string(),
        };
        let err = import_codebook(&p.conn, missing_name, ImportMode::Merge).unwrap_err();
        match err {
            AppError::Validation(msg) => assert!(msg.contains("row 3"), "{msg}"),
            other => panic!("expected Validation, got {other:?}"),
        }

        let bad_header = CodebookImport::Csv {
            text: "name,parent\nAlpha,\n".to_string(),
        };
        assert!(matches!(
            import_codebook(&p.conn, bad_header, ImportMode::Merge),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn add_under_grafts_everything_under_the_chosen_parent_without_matching() {
        let p = OpenProject::in_memory("t").unwrap();
        let existing = mk(&p.conn, "Alpha", None);
        let base = mk(&p.conn, "Imported", None);
        let input = CodebookImport::Csv {
            text: "name,parent,color,description,shortcut\nAlpha,,,,\n".to_string(),
        };
        let report = import_codebook(
            &p.conn,
            input,
            ImportMode::AddUnder {
                parent_id: Some(base.id.clone()),
            },
        )
        .unwrap();
        // Even though "Alpha" already exists at the root, add-under never
        // matches: a second, distinct "Alpha" is created under the base.
        assert_eq!(report.created, 1);
        assert_eq!(report.matched, 0);

        let all = codes::list(&p.conn).unwrap();
        let alphas: Vec<_> = all.iter().filter(|c| c.name == "Alpha").collect();
        assert_eq!(alphas.len(), 2);
        assert!(alphas
            .iter()
            .any(|c| c.id == existing.id && c.parent_id.is_none()));
        assert!(alphas
            .iter()
            .any(|c| c.id != existing.id && c.parent_id.as_deref() == Some(base.id.as_str())));
    }

    #[test]
    fn taken_shortcut_is_dropped_and_reported() {
        let p = OpenProject::in_memory("t").unwrap();
        mk_with_shortcut(&p, "Existing", "q");
        let input = CodebookImport::Csv {
            text: "name,parent,color,description,shortcut\nNew,,,,q\n".to_string(),
        };
        let report = import_codebook(&p.conn, input, ImportMode::Merge).unwrap();
        assert_eq!(report.created, 1);
        assert_eq!(report.skipped_shortcuts, vec!["New".to_string()]);
        let all = codes::list(&p.conn).unwrap();
        let new_code = all.iter().find(|c| c.name == "New").unwrap();
        assert_eq!(new_code.shortcut, None);
    }

    fn mk_with_shortcut(p: &OpenProject, name: &str, shortcut: &str) -> crate::models::Code {
        codes::create(
            &p.conn,
            NewCode {
                name: name.into(),
                shortcut: Some(shortcut.into()),
                ..Default::default()
            },
        )
        .unwrap()
    }
}
